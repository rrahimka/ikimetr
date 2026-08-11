import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { BudgetController, BudgetQuoteResult } from './budget.js';
import type {
  CacheCompatibilityContext,
  VerifiedCacheLookup,
} from './cache-runtime.js';
import { canonicalize, sha256 } from './canonical.js';
import type { AccountingLedger } from './ledger.js';
import { parseLedgerEvent } from './ledger-events.js';
import {
  createRoutingDecision,
  PolicyEvaluator,
} from './policy-evaluator.js';
import type { PricingResolver } from './pricing.js';
import {
  approvalScopes,
  hashTaskRoutingRequest,
  parseTaskRoutingRequest,
  routeRank,
  type ApprovalScope,
  type RoutingDecision,
  type RoutingDecisionDraft,
  type RoutingReasonCode,
  type RoutingRoute,
  type RoutingStage,
  type RoutingTransition,
  type TaskRoutingRequest,
} from './routing-contracts.js';
import {
  deriveRoutingState,
  getApprovalState,
  getProviderHealth,
  hasRepeatedFailure,
  hasRouteInsufficiency,
  type RoutingState,
} from './routing-state.js';
import {
  configurationFileNames,
  type ProviderId,
  validateConfigurationFiles,
} from './schemas.js';
import type { ConfigSnapshot } from './snapshot.js';

export interface VerifiedCacheLookupReader {
  lookupVerified(
    context: CacheCompatibilityContext,
    now: Date,
  ): Promise<VerifiedCacheLookup>;
}

export interface RoutingRuntimeContext {
  readonly cache_candidates: readonly CacheCompatibilityContext[];
  readonly estimated_input_tokens: number;
  readonly retry: boolean;
}

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const identifier = z.string().min(1).max(128);
const versionRecord = z.record(z.string().min(1).max(64), z.string().min(1).max(128));
const cacheContextSchema = z
  .object({
    cache_key: sha256Hex,
    task_id: identifier,
    task_type: identifier,
    route: z.enum(['local', 'cheap-cloud', 'strong']),
    provider: z.enum(['local-ai', 'deepseek', 'qwen', 'codex', 'claude']),
    model_revision: identifier,
    prompt_version: identifier,
    policy_version: identifier,
    config_hash: sha256Hex,
    verification_profile_hash: sha256Hex,
    task_spec_hash: sha256Hex,
    input_hashes: z.array(sha256Hex).max(256),
    diff_hash: sha256Hex.nullable(),
    error_fingerprint: sha256Hex.nullable(),
    data_class: z.enum(['public', 'internal', 'sensitive']),
    input_protection: z.enum(['sha256', 'hmac-sha256']),
    data_policy_hash: sha256Hex,
    tool_versions: versionRecord,
    dependency_versions: versionRecord,
  })
  .strict();
const runtimeContextSchema = z
  .object({
    cache_candidates: z.array(cacheContextSchema).max(16),
    estimated_input_tokens: z.number().int().nonnegative().safe(),
    retry: z.boolean(),
  })
  .strict();

const stageByRoute: Readonly<Record<Exclude<RoutingRoute, 'deterministic'>, RoutingStage>> =
  Object.freeze({
    local: 'LOCAL',
    'cheap-cloud': 'CHEAP_CLOUD',
    strong: 'STRONG',
  });

const invalidConfigHash = sha256(
  canonicalize({ schema_version: 1, status: 'invalid-config' }),
);

export class CostRouter {
  private evaluationQueue: Promise<void> = Promise.resolve();
  private readonly evaluator: PolicyEvaluator;
  private readonly configValid: boolean;
  private readonly effectiveConfigHash: string;

  private constructor(
    private readonly ledger: AccountingLedger,
    private readonly config: ConfigSnapshot,
    private readonly pricingResolver: PricingResolver,
    private readonly budgetController: Pick<BudgetController, 'quote'>,
    private readonly cacheRuntime: VerifiedCacheLookupReader,
    private readonly now: () => Date,
  ) {
    this.configValid = validateSnapshot(config, pricingResolver);
    this.effectiveConfigHash = this.configValid
      ? config.configHash
      : invalidConfigHash;
    this.evaluator = new PolicyEvaluator(config);
  }

  public static async initialize(options: {
    readonly ledger: AccountingLedger;
    readonly config: ConfigSnapshot;
    readonly pricingResolver: PricingResolver;
    readonly budgetController: Pick<BudgetController, 'quote'>;
    readonly cacheRuntime: VerifiedCacheLookupReader;
    readonly now?: () => Date;
  }): Promise<CostRouter> {
    return new CostRouter(
      options.ledger,
      options.config,
      options.pricingResolver,
      options.budgetController,
      options.cacheRuntime,
      options.now ?? (() => new Date()),
    );
  }

  public evaluate(
    requestValue: unknown,
    contextValue: unknown,
  ): Promise<RoutingDecision> {
    const request = parseTaskRoutingRequest(requestValue);
    const context = runtimeContextSchema.parse(
      contextValue,
    ) as RoutingRuntimeContext;
    const pending = this.evaluationQueue.then(() =>
      this.evaluateInternal(request, context),
    );
    this.evaluationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async evaluateInternal(
    request: TaskRoutingRequest,
    context: RoutingRuntimeContext,
  ): Promise<RoutingDecision> {
    if (!this.configValid) {
      return this.createStopWithoutAudit(
        request,
        'CONFIG_INVALID',
        'SKIPPED',
        [transition('CACHE', 'DENIED', 'CONFIG_INVALID')],
      );
    }

    let events;
    try {
      events = await this.ledger.replay();
    } catch {
      return this.createStopWithoutAudit(
        request,
        'LEDGER_INVALID',
        'SKIPPED',
        [transition('CACHE', 'DENIED', 'LEDGER_INVALID')],
      );
    }
    const state = deriveRoutingState(events, request.task_id);
    const trace: RoutingTransition[] = [];

    if (request.data_class === 'secret') {
      trace.push(transition('CACHE', 'DENIED', 'SECRET_DATA_DENIED'));
      return this.audit(
        request,
        stopDraft('SECRET_DATA_DENIED', 'SKIPPED', trace),
      );
    }

    const cacheResult = await this.evaluateCache(request, context, trace);
    if (cacheResult.decision !== null) {
      return this.audit(request, cacheResult.decision);
    }
    const cacheStatus = cacheResult.cacheStatus;

    if (this.evaluator.isDeterministicCapability(request)) {
      trace.push(
        transition(
          'DETERMINISTIC',
          'SELECTED',
          'DETERMINISTIC_CAPABILITY',
        ),
      );
      return this.audit(
        request,
        selectedDraft(
          'DETERMINISTIC',
          'deterministic',
          null,
          'DETERMINISTIC_CAPABILITY',
          cacheStatus,
          'NOT_APPLICABLE',
          'NOT_APPLICABLE',
          'ALLOWED',
          'NOT_REQUIRED',
          false,
          trace,
        ),
      );
    }
    trace.push(
      transition(
        'DETERMINISTIC',
        'CONTINUE',
        'DETERMINISTIC_UNRESOLVED',
      ),
    );

    const requestHash = hashTaskRoutingRequest(request);
    if (
      hasRepeatedFailure(state, {
        error_fingerprint: request.error_fingerprint,
        current_diff_hash: request.current_diff_hash,
        request_hash: requestHash,
      })
    ) {
      trace.push(transition('FINAL', 'DENIED', 'REPEATED_REQUEST'));
      return this.audit(
        request,
        stopDraft('REPEATED_REQUEST', cacheStatus, trace, false),
      );
    }

    let lastReason: RoutingReasonCode = 'NO_PROVIDER_AVAILABLE';
    for (const route of ['local', 'cheap-cloud', 'strong'] as const) {
      const stage = stageByRoute[route];
      if (
        route !== 'strong' &&
        hasRouteInsufficiency(state, route, requestHash)
      ) {
        const reason =
          route === 'local' ? 'LOCAL_INSUFFICIENT' : 'CHEAP_INSUFFICIENT';
        trace.push(transition(stage, 'SKIPPED', reason));
        lastReason = reason;
        continue;
      }

      const routePolicy = this.evaluator.evaluateRoutePolicy(request, route);
      if (!routePolicy.allowed) {
        trace.push(transition(stage, 'SKIPPED', routePolicy.reason_code));
        lastReason = routePolicy.reason_code;
        continue;
      }

      const outcome = await this.evaluateProviderRoute(
        request,
        context,
        state,
        route,
        stage,
        cacheStatus,
        trace,
      );
      if (outcome.decision !== null) {
        return this.audit(request, outcome.decision);
      }
      lastReason = outcome.reasonCode;
      if (
        route !== 'local' &&
        (lastReason === 'PRICING_UNKNOWN' || lastReason === 'PRICING_STALE')
      ) {
        trace.push(transition('FINAL', 'DENIED', lastReason));
        return this.audit(
          request,
          stopDraft(
            lastReason,
            cacheStatus,
            trace,
            false,
            outcome.pricingStatus,
          ),
        );
      }
    }

    trace.push(transition('FINAL', 'DENIED', lastReason));
    return this.audit(
      request,
      stopDraft(lastReason, cacheStatus, trace, false),
    );
  }

  private async evaluateCache(
    request: TaskRoutingRequest,
    context: RoutingRuntimeContext,
    trace: RoutingTransition[],
  ): Promise<{
    readonly decision: RoutingDecisionDraft | null;
    readonly cacheStatus: RoutingDecisionDraft['cache_status'];
  }> {
    let cacheStatus: RoutingDecisionDraft['cache_status'] = 'MISS';
    for (const candidate of context.cache_candidates) {
      if (!isCacheContextCompatible(candidate, request, this.config)) {
        trace.push(transition('CACHE', 'DENIED', 'POLICY_CONTRADICTION'));
        return {
          decision: stopDraft(
            'POLICY_CONTRADICTION',
            'INVALIDATED',
            trace,
          ),
          cacheStatus: 'INVALIDATED',
        };
      }
      let lookup: VerifiedCacheLookup;
      try {
        lookup = await this.cacheRuntime.lookupVerified(candidate, this.now());
      } catch {
        trace.push(transition('CACHE', 'DENIED', 'CACHE_UNAVAILABLE'));
        return {
          decision: stopDraft('CACHE_UNAVAILABLE', 'ERROR', trace),
          cacheStatus: 'ERROR',
        };
      }
      if (lookup.status === 'hit' && lookup.entry !== null) {
        trace.push(transition('CACHE', 'SELECTED', 'CACHE_HIT'));
        return {
          decision: selectedDraft(
            'CACHE',
            'cache',
            lookup.entry.provider,
            'CACHE_HIT',
            'HIT',
            'NOT_APPLICABLE',
            'NOT_APPLICABLE',
            'ALLOWED',
            'NOT_REQUIRED',
            false,
            trace,
          ),
          cacheStatus: 'HIT',
        };
      }
      if (lookup.status === 'quarantined') {
        trace.push(transition('CACHE', 'DENIED', 'CACHE_QUARANTINED'));
        return {
          decision: stopDraft('CACHE_QUARANTINED', 'QUARANTINED', trace),
          cacheStatus: 'QUARANTINED',
        };
      }
      if (lookup.status === 'invalidated') {
        cacheStatus = 'INVALIDATED';
      }
    }
    trace.push(
      transition(
        'CACHE',
        'CONTINUE',
        cacheStatus === 'INVALIDATED' ? 'CACHE_INVALIDATED' : 'CACHE_MISS',
      ),
    );
    return { decision: null, cacheStatus };
  }

  private async evaluateProviderRoute(
    request: TaskRoutingRequest,
    context: RoutingRuntimeContext,
    state: RoutingState,
    route: 'local' | 'cheap-cloud' | 'strong',
    stage: RoutingStage,
    cacheStatus: RoutingDecisionDraft['cache_status'],
    trace: RoutingTransition[],
  ): Promise<{
    readonly decision: RoutingDecisionDraft | null;
    readonly reasonCode: RoutingReasonCode;
    readonly pricingStatus: RoutingDecisionDraft['pricing_status'];
  }> {
    const dataClass = request.data_class;
    if (dataClass === 'secret') {
      trace.push(transition(stage, 'DENIED', 'SECRET_DATA_DENIED'));
      return {
        decision: stopDraft(
          'SECRET_DATA_DENIED',
          cacheStatus,
          trace,
        ),
        reasonCode: 'SECRET_DATA_DENIED',
        pricingStatus: 'NOT_APPLICABLE',
      };
    }
    const providers = this.config.configuration.router.routes[route]
      .providers as readonly ProviderId[];
    let lastReason: RoutingReasonCode = unavailableReason(route);
    let pricingStatus: RoutingDecisionDraft['pricing_status'] =
      'NOT_APPLICABLE';
    let sawPricingFailure = false;

    for (const providerId of providers) {
      const provider =
        this.config.configuration.providers.providers[providerId];
      const policy = this.evaluator.evaluateProviderPolicy(request, providerId);
      if (!policy.allowed) {
        trace.push(transition(stage, 'SKIPPED', policy.reason_code));
        lastReason = policy.reason_code;
        continue;
      }
      if (provider.model === null) {
        trace.push(transition(stage, 'SKIPPED', 'PROVIDER_DISABLED'));
        lastReason = 'PROVIDER_DISABLED';
        continue;
      }
      const health = getProviderHealth(state, providerId, provider.model);
      if (health !== 'healthy') {
        const reason = healthReason(health);
        trace.push(transition(stage, 'SKIPPED', reason));
        lastReason = reason;
        continue;
      }

      const pricingSnapshot = this.config.configuration.pricing.snapshots.find(
        (snapshot) => snapshot.provider === providerId,
      );
      if (pricingSnapshot?.status !== 'known') {
        const reason =
          pricingSnapshot?.status === 'stale'
            ? 'PRICING_STALE'
            : 'PRICING_UNKNOWN';
        pricingStatus = pricingSnapshot?.status === 'stale' ? 'STALE' : 'UNKNOWN';
        sawPricingFailure = true;
        trace.push(transition(stage, 'SKIPPED', reason));
        lastReason = reason;
        continue;
      }
      try {
        this.pricingResolver.resolve({
          provider: providerId,
          model: provider.model,
          automatic: provider.invocationMode === 'automatic',
          cloud: providerId !== 'local-ai',
        });
      } catch {
        pricingStatus = 'ERROR';
        sawPricingFailure = true;
        trace.push(transition(stage, 'SKIPPED', 'PRICING_UNKNOWN'));
        lastReason = 'PRICING_UNKNOWN';
        continue;
      }
      pricingStatus = 'KNOWN';

      let quote: BudgetQuoteResult;
      try {
        quote = await this.budgetController.quote({
          taskId: request.task_id,
          provider: providerId,
          model: provider.model,
          route,
          dataClass,
          automatic: provider.invocationMode === 'automatic',
          retry: context.retry,
          estimatedInputTokens: context.estimated_input_tokens,
        });
      } catch {
        trace.push(transition(stage, 'DENIED', 'BUDGET_DENIED'));
        return {
          decision: stopDraft(
            'BUDGET_DENIED',
            cacheStatus,
            trace,
            false,
            pricingStatus,
            'ERROR',
            providerId,
            route,
          ),
          reasonCode: 'BUDGET_DENIED',
          pricingStatus,
        };
      }
      if (quote.status === 'DENIED') {
        const budgetStatus = budgetStatusFor(quote);
        const reason =
          budgetStatus === 'NOT_CONFIGURED'
            ? 'BUDGET_NOT_CONFIGURED'
            : 'BUDGET_DENIED';
        trace.push(transition(stage, 'DENIED', reason));
        return {
          decision: stopDraft(
            reason,
            cacheStatus,
            trace,
            false,
            pricingStatus,
            budgetStatus,
            providerId,
            route,
          ),
          reasonCode: reason,
          pricingStatus,
        };
      }

      const approval = evaluateApproval(
        this.config,
        state,
        request,
        route,
        providerId,
      );
      if (approval === 'DENIED') {
        trace.push(transition(stage, 'DENIED', 'APPROVAL_DENIED'));
        return {
          decision: stopDraft(
            'APPROVAL_DENIED',
            cacheStatus,
            trace,
            false,
            pricingStatus,
            'ALLOWED',
            providerId,
            route,
            'DENIED',
          ),
          reasonCode: 'APPROVAL_DENIED',
          pricingStatus,
        };
      }
      if (approval === 'REQUIRED') {
        trace.push(transition(stage, 'DENIED', 'APPROVAL_REQUIRED'));
        return {
          decision: selectedDraft(
            'APPROVAL_REQUIRED',
            route,
            providerId,
            'APPROVAL_REQUIRED',
            cacheStatus,
            'ALLOWED',
            pricingStatus,
            'ALLOWED',
            'REQUIRED',
            false,
            trace,
          ),
          reasonCode: 'APPROVAL_REQUIRED',
          pricingStatus,
        };
      }

      trace.push(transition(stage, 'SELECTED', 'ROUTE_SELECTED'));
      const decision = {
        local: 'LOCAL',
        'cheap-cloud': 'CHEAP_CLOUD',
        strong: 'STRONG',
      }[route] as 'LOCAL' | 'CHEAP_CLOUD' | 'STRONG';
      return {
        decision: selectedDraft(
          decision,
          route,
          providerId,
          'ROUTE_SELECTED',
          cacheStatus,
          'ALLOWED',
          pricingStatus,
          'ALLOWED',
          approval,
          canEscalate(request, route),
          trace,
        ),
        reasonCode: 'ROUTE_SELECTED',
        pricingStatus,
      };
    }

    if (sawPricingFailure) {
      return { decision: null, reasonCode: lastReason, pricingStatus };
    }
    const reason = unavailableReason(route);
    trace.push(transition(stage, 'SKIPPED', reason));
    return { decision: null, reasonCode: reason, pricingStatus };
  }

  private async audit(
    request: TaskRoutingRequest,
    draft: RoutingDecisionDraft,
  ): Promise<RoutingDecision> {
    const decision = createRoutingDecision(
      request,
      withFinalTransition(draft),
      this.effectiveConfigHash,
    );
    try {
      await this.ledger.append(
        parseLedgerEvent({
          event_version: 1,
          event_id: `routing-${randomUUID()}`,
          event_type: 'RoutingDecisionEvent',
          occurred_at: this.now().toISOString(),
          task_id: request.task_id,
          request_hash: decision.request_hash,
          decision_hash: decision.decision_hash,
          config_hash: decision.config_hash,
          decision: decision.decision,
          route: decision.route,
          provider_candidate: decision.provider_candidate,
          reason_code: decision.reason_code,
          cache_status: decision.cache_status,
          budget_status: decision.budget_status,
          pricing_status: decision.pricing_status,
          data_policy_status: decision.data_policy_status,
          approval_status: decision.approval_status,
          escalation_allowed: decision.escalation_allowed,
          transition_trace_hash: sha256(
            canonicalize(decision.transition_trace),
          ),
        }),
      );
      return decision;
    } catch {
      const trace = decision.transition_trace.filter(
        (value) => value.stage !== 'FINAL',
      );
      trace.push(transition('FINAL', 'DENIED', 'AUDIT_APPEND_FAILED'));
      return createRoutingDecision(
        request,
        {
          decision: 'STOP',
          route: null,
          provider_candidate: null,
          reason_code: 'AUDIT_APPEND_FAILED',
          cache_status: decision.cache_status,
          budget_status: decision.budget_status,
          pricing_status: decision.pricing_status,
          data_policy_status: decision.data_policy_status,
          approval_status: decision.approval_status,
          escalation_allowed: false,
          transition_trace: trace,
        },
        this.effectiveConfigHash,
      );
    }
  }

  private createStopWithoutAudit(
    request: TaskRoutingRequest,
    reason: 'CONFIG_INVALID' | 'LEDGER_INVALID',
    cacheStatus: RoutingDecisionDraft['cache_status'],
    trace: RoutingTransition[],
  ): RoutingDecision {
    return createRoutingDecision(
      request,
      withFinalTransition(stopDraft(reason, cacheStatus, trace)),
      this.effectiveConfigHash,
    );
  }
}

function validateSnapshot(
  snapshot: ConfigSnapshot,
  pricingResolver: PricingResolver,
): boolean {
  try {
    const raw = {
      'router.json': snapshot.configuration.router,
      'providers.json': snapshot.configuration.providers,
      'budgets.json': snapshot.configuration.budgets,
      'pricing.json': snapshot.configuration.pricing,
      'verification.json': snapshot.configuration.verification,
    };
    const configuration = validateConfigurationFiles(raw);
    return (
      snapshot.schemaVersion === 1 &&
      snapshot.configVersion === configuration.router.configVersion &&
      snapshot.configHash === sha256(canonicalize(configuration)) &&
      pricingResolver.getConfigHash() === snapshot.configHash &&
      configurationFileNames.every((fileName) =>
        /^[a-f0-9]{64}$/u.test(snapshot.sourceFileHashes[fileName]),
      )
    );
  } catch {
    return false;
  }
}

function isCacheContextCompatible(
  context: CacheCompatibilityContext,
  request: TaskRoutingRequest,
  config: ConfigSnapshot,
): boolean {
  return (
    context.task_id === request.task_id &&
    context.task_type === request.task_type &&
    context.task_spec_hash === request.task_spec_hash &&
    canonicalize(context.input_hashes) === canonicalize(request.input_hashes) &&
    context.diff_hash === request.current_diff_hash &&
    context.error_fingerprint === request.error_fingerprint &&
    context.data_class === request.data_class &&
    context.config_hash === config.configHash &&
    context.policy_version === config.configuration.router.policyVersion &&
    context.verification_profile_hash ===
      config.sourceFileHashes['verification.json']
  );
}

function evaluateApproval(
  config: ConfigSnapshot,
  state: RoutingState,
  request: TaskRoutingRequest,
  route: 'local' | 'cheap-cloud' | 'strong',
  provider: ProviderId,
): RoutingDecisionDraft['approval_status'] {
  const required = new Set<ApprovalScope>();
  if (config.configuration.router.routes[route].approvalRequired) {
    required.add(route as ApprovalScope);
  }
  if (request.data_class === 'sensitive' && route !== 'local') {
    required.add('sensitive-cloud');
  }
  if (provider === 'claude' && request.manual_primary_agent !== 'claude') {
    required.add('secondary-claude');
  }
  for (const scope of required) {
    if (!approvalScopes.includes(scope)) {
      return 'DENIED';
    }
    const effective = getApprovalState(state, scope);
    if (effective === 'denied' || effective === 'revoked') {
      return 'DENIED';
    }
    if (effective === 'missing') {
      return 'REQUIRED';
    }
  }
  return required.size === 0 ? 'NOT_REQUIRED' : 'APPROVED';
}

function budgetStatusFor(
  quote: Extract<BudgetQuoteResult, { status: 'DENIED' }>,
): Extract<RoutingDecisionDraft['budget_status'], 'DENIED' | 'NOT_CONFIGURED'> {
  return quote.reasonCode === 'NOT_CONFIGURED' ||
    quote.reasonCode === 'PROVIDER_DISABLED' ||
    quote.reasonCode === 'INVALID_REQUEST'
    ? 'NOT_CONFIGURED'
    : 'DENIED';
}

function healthReason(
  health: 'degraded' | 'unavailable' | 'unknown',
): RoutingReasonCode {
  return {
    degraded: 'PROVIDER_DEGRADED',
    unavailable: 'PROVIDER_UNAVAILABLE',
    unknown: 'PROVIDER_HEALTH_UNKNOWN',
  }[health] as RoutingReasonCode;
}

function unavailableReason(
  route: 'local' | 'cheap-cloud' | 'strong',
): RoutingReasonCode {
  return {
    local: 'LOCAL_UNAVAILABLE',
    'cheap-cloud': 'CHEAP_UNAVAILABLE',
    strong: 'STRONG_UNAVAILABLE',
  }[route] as RoutingReasonCode;
}

function canEscalate(
  request: TaskRoutingRequest,
  route: 'local' | 'cheap-cloud' | 'strong',
): boolean {
  return request.allowed_routes.some(
    (candidate) =>
      routeRank(candidate) > routeRank(route) &&
      routeRank(candidate) <= routeRank(request.max_route),
  );
}

function transition(
  stage: RoutingStage,
  outcome: RoutingTransition['outcome'],
  reasonCode: RoutingReasonCode,
): RoutingTransition {
  return Object.freeze({
    stage,
    outcome,
    reason_code: reasonCode,
  });
}

function withFinalTransition(
  draft: RoutingDecisionDraft,
): RoutingDecisionDraft {
  if (draft.transition_trace.at(-1)?.stage === 'FINAL') {
    return draft;
  }
  return {
    ...draft,
    transition_trace: [
      ...draft.transition_trace,
      transition(
        'FINAL',
        draft.decision === 'STOP' ? 'DENIED' : 'SELECTED',
        draft.reason_code,
      ),
    ],
  };
}

function selectedDraft(
  decision: RoutingDecisionDraft['decision'],
  route: NonNullable<RoutingDecisionDraft['route']>,
  provider: ProviderId | null,
  reasonCode: RoutingReasonCode,
  cacheStatus: RoutingDecisionDraft['cache_status'],
  budgetStatus: RoutingDecisionDraft['budget_status'],
  pricingStatus: RoutingDecisionDraft['pricing_status'],
  dataPolicyStatus: RoutingDecisionDraft['data_policy_status'],
  approvalStatus: RoutingDecisionDraft['approval_status'],
  escalationAllowed: boolean,
  trace: readonly RoutingTransition[],
): RoutingDecisionDraft {
  return {
    decision,
    route,
    provider_candidate: provider,
    reason_code: reasonCode,
    cache_status: cacheStatus,
    budget_status: budgetStatus,
    pricing_status: pricingStatus,
    data_policy_status: dataPolicyStatus,
    approval_status: approvalStatus,
    escalation_allowed: escalationAllowed,
    transition_trace: [...trace],
  };
}

function stopDraft(
  reasonCode: RoutingReasonCode,
  cacheStatus: RoutingDecisionDraft['cache_status'],
  trace: readonly RoutingTransition[],
  escalationAllowed = false,
  pricingStatus: RoutingDecisionDraft['pricing_status'] = 'NOT_APPLICABLE',
  budgetStatus: RoutingDecisionDraft['budget_status'] = 'NOT_APPLICABLE',
  provider: ProviderId | null = null,
  route: RoutingDecisionDraft['route'] = null,
  approvalStatus: RoutingDecisionDraft['approval_status'] = 'NOT_REQUIRED',
): RoutingDecisionDraft {
  return {
    decision: 'STOP',
    route,
    provider_candidate: provider,
    reason_code: reasonCode,
    cache_status: cacheStatus,
    budget_status: budgetStatus,
    pricing_status: pricingStatus,
    data_policy_status:
      reasonCode === 'DATA_CLASS_DENIED' ||
      reasonCode === 'RISK_CLASS_DENIED' ||
      reasonCode === 'CAPABILITY_DENIED' ||
      reasonCode === 'SECRET_DATA_DENIED'
        ? 'DENIED'
        : 'ALLOWED',
    approval_status: approvalStatus,
    escalation_allowed: escalationAllowed,
    transition_trace: [...trace],
  };
}
