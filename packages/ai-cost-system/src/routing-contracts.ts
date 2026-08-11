import { z } from 'zod';

import { canonicalize, sha256 } from './canonical.js';
import { capabilityIds, riskClasses } from './schemas.js';

export const routingRoutes = [
  'deterministic',
  'local',
  'cheap-cloud',
  'strong',
] as const;
export type RoutingRoute = (typeof routingRoutes)[number];

export const routingStages = [
  'CACHE',
  'DETERMINISTIC',
  'LOCAL',
  'CHEAP_CLOUD',
  'STRONG',
  'FINAL',
] as const;
export type RoutingStage = (typeof routingStages)[number];

export const routingReasonCodes = [
  'CACHE_HIT',
  'CACHE_MISS',
  'CACHE_INVALIDATED',
  'CACHE_QUARANTINED',
  'CACHE_UNAVAILABLE',
  'SECRET_DATA_DENIED',
  'DETERMINISTIC_CAPABILITY',
  'DETERMINISTIC_UNRESOLVED',
  'ROUTE_ALLOWED',
  'ROUTE_NOT_ALLOWED',
  'MAX_ROUTE_EXCEEDED',
  'PROVIDER_DISABLED',
  'PROVIDER_HEALTHY',
  'PROVIDER_DEGRADED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_HEALTH_UNKNOWN',
  'DATA_CLASS_DENIED',
  'RISK_CLASS_DENIED',
  'CAPABILITY_DENIED',
  'DATA_POLICY_ALLOWED',
  'PRICING_KNOWN',
  'PRICING_STALE',
  'PRICING_UNKNOWN',
  'BUDGET_ALLOWED',
  'BUDGET_DENIED',
  'BUDGET_NOT_CONFIGURED',
  'APPROVAL_NOT_REQUIRED',
  'APPROVAL_REQUIRED',
  'APPROVAL_GRANTED',
  'APPROVAL_DENIED',
  'LOCAL_UNAVAILABLE',
  'LOCAL_INSUFFICIENT',
  'CHEAP_UNAVAILABLE',
  'CHEAP_INSUFFICIENT',
  'STRONG_UNAVAILABLE',
  'NO_PROVIDER_AVAILABLE',
  'REPEATED_REQUEST',
  'CONFIG_INVALID',
  'LEDGER_INVALID',
  'POLICY_CONTRADICTION',
  'ROUTE_SELECTED',
  'AUDIT_APPEND_FAILED',
  'LOCAL_TASK_NOT_ALLOWED',
] as const;
export type RoutingReasonCode = (typeof routingReasonCodes)[number];

export const approvalScopes = [
  'cheap-cloud',
  'strong',
  'sensitive-cloud',
  'secondary-claude',
  'budget-override',
  'retry-override',
  'provider-override',
] as const;
export type ApprovalScope = (typeof approvalScopes)[number];

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u);
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const nullableSha256Hex = sha256Hex.nullable();

const uniqueRoutes = z
  .array(z.enum(routingRoutes))
  .min(1)
  .max(routingRoutes.length)
  .superRefine(rejectDuplicates);
const uniqueApprovalScopes = z
  .array(z.enum(approvalScopes))
  .max(approvalScopes.length)
  .superRefine(rejectDuplicates);

const taskRoutingRequestSchema = z
  .object({
    task_id: identifier,
    task_type: identifier,
    purpose: identifier,
    risk_class: z.enum(riskClasses),
    data_class: z.enum(['public', 'internal', 'sensitive', 'secret']),
    requested_capability: z.enum(capabilityIds),
    task_spec_hash: sha256Hex,
    input_hashes: z.array(sha256Hex).max(256).superRefine(rejectDuplicates),
    current_diff_hash: nullableSha256Hex,
    error_fingerprint: nullableSha256Hex,
    verification_profile: identifier,
    allowed_routes: uniqueRoutes,
    max_route: z.enum(routingRoutes),
    approval_context: z
      .object({
        requested_scopes: uniqueApprovalScopes,
      })
      .strict(),
    manual_primary_agent: z.enum(['codex', 'claude']).nullable(),
  })
  .strict();

export type TaskRoutingRequest = z.infer<typeof taskRoutingRequestSchema>;

const transitionSchema = z
  .object({
    stage: z.enum(routingStages),
    outcome: z.enum(['CONTINUE', 'SELECTED', 'DENIED', 'SKIPPED']),
    reason_code: z.enum(routingReasonCodes),
  })
  .strict();
export type RoutingTransition = z.infer<typeof transitionSchema>;

const decisionDraftSchema = z
  .object({
    decision: z.enum([
      'CACHE',
      'DETERMINISTIC',
      'LOCAL',
      'CHEAP_CLOUD',
      'STRONG',
      'APPROVAL_REQUIRED',
      'STOP',
    ]),
    route: z
      .enum(['cache', 'deterministic', 'local', 'cheap-cloud', 'strong'])
      .nullable(),
    provider_candidate: z
      .enum(['local-ai', 'deepseek', 'qwen', 'codex', 'claude'])
      .nullable(),
    reason_code: z.enum(routingReasonCodes),
    cache_status: z.enum([
      'HIT',
      'MISS',
      'INVALIDATED',
      'QUARANTINED',
      'SKIPPED',
      'ERROR',
    ]),
    budget_status: z.enum([
      'NOT_APPLICABLE',
      'ALLOWED',
      'DENIED',
      'NOT_CONFIGURED',
      'ERROR',
    ]),
    pricing_status: z.enum([
      'NOT_APPLICABLE',
      'KNOWN',
      'STALE',
      'UNKNOWN',
      'ERROR',
    ]),
    data_policy_status: z.enum(['ALLOWED', 'DENIED']),
    approval_status: z.enum([
      'NOT_REQUIRED',
      'APPROVED',
      'REQUIRED',
      'DENIED',
    ]),
    escalation_allowed: z.boolean(),
    transition_trace: z.array(transitionSchema).min(1).max(32),
  })
  .strict()
  .superRefine(validateTransitionOrder)
  .superRefine(validateDecisionSemantics);

export type RoutingDecisionDraft = z.infer<typeof decisionDraftSchema>;

const routingDecisionSchema = decisionDraftSchema
  .safeExtend({
    reason_summary: z.string().min(1).max(160),
    config_hash: sha256Hex,
    request_hash: sha256Hex,
    decision_hash: sha256Hex,
  })
  .strict();

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

const reasonSummaries: Readonly<Record<RoutingReasonCode, string>> =
  Object.freeze({
    CACHE_HIT: 'Compatible verified cache entry is reusable.',
    CACHE_MISS: 'No compatible verified cache entry was found.',
    CACHE_INVALIDATED: 'Cache entry is stale or incompatible.',
    CACHE_QUARANTINED: 'Cache integrity or provenance is invalid.',
    CACHE_UNAVAILABLE: 'Verified cache lookup is unavailable.',
    SECRET_DATA_DENIED: 'Secret data is not routable to AI providers.',
    DETERMINISTIC_CAPABILITY: 'The requested capability is deterministic.',
    DETERMINISTIC_UNRESOLVED: 'Deterministic tools cannot satisfy the request.',
    ROUTE_ALLOWED: 'The route is within the request policy boundary.',
    ROUTE_NOT_ALLOWED: 'The route is not allowlisted by the request.',
    MAX_ROUTE_EXCEEDED: 'The route exceeds the request maximum.',
    PROVIDER_DISABLED: 'The provider is disabled.',
    PROVIDER_HEALTHY: 'The provider has validated healthy state.',
    PROVIDER_DEGRADED: 'The provider health is degraded.',
    PROVIDER_UNAVAILABLE: 'The provider is unavailable.',
    PROVIDER_HEALTH_UNKNOWN: 'The provider has no healthy evidence.',
    DATA_CLASS_DENIED: 'The provider does not allow the data class.',
    RISK_CLASS_DENIED: 'The provider does not allow the risk class.',
    CAPABILITY_DENIED: 'The provider does not allow the capability.',
    DATA_POLICY_ALLOWED: 'Provider data, risk, and capability policy allows the request.',
    PRICING_KNOWN: 'A usable pricing snapshot is available.',
    PRICING_STALE: 'Provider pricing is stale.',
    PRICING_UNKNOWN: 'Provider pricing is unknown.',
    BUDGET_ALLOWED: 'Read-only budget preflight allows the candidate.',
    BUDGET_DENIED: 'The effective budget denies the candidate.',
    BUDGET_NOT_CONFIGURED: 'Required budget limits are not configured.',
    APPROVAL_NOT_REQUIRED: 'The candidate does not require approval.',
    APPROVAL_REQUIRED: 'The candidate requires explicit approval.',
    APPROVAL_GRANTED: 'Validated ledger approval permits the candidate.',
    APPROVAL_DENIED: 'Validated ledger state denies the required approval.',
    LOCAL_UNAVAILABLE: 'No eligible local provider is available.',
    LOCAL_INSUFFICIENT: 'Validated evidence shows the local route was insufficient.',
    CHEAP_UNAVAILABLE: 'No eligible cheap-cloud provider is available.',
    CHEAP_INSUFFICIENT: 'Validated evidence shows the cheap-cloud route was insufficient.',
    STRONG_UNAVAILABLE: 'No eligible strong provider is available.',
    NO_PROVIDER_AVAILABLE: 'No approved provider can satisfy the request.',
    REPEATED_REQUEST: 'The same failed request has no new verification evidence.',
    CONFIG_INVALID: 'The routing configuration is invalid.',
    LEDGER_INVALID: 'The accounting ledger is invalid.',
    POLICY_CONTRADICTION: 'Routing policy inputs are contradictory.',
    ROUTE_SELECTED: 'The first eligible route and provider were selected.',
    AUDIT_APPEND_FAILED: 'The routing decision could not be audited.',
    LOCAL_TASK_NOT_ALLOWED: 'Local AI does not allow this task type.',
  });

export function parseTaskRoutingRequest(value: unknown): TaskRoutingRequest {
  const parsed = taskRoutingRequestSchema.parse(value);
  const normalized: TaskRoutingRequest = {
    ...parsed,
    allowed_routes: [...parsed.allowed_routes].sort(
      (left, right) => routeRank(left) - routeRank(right),
    ),
    approval_context: {
      requested_scopes: [...parsed.approval_context.requested_scopes].sort(),
    },
  };
  return deepFreeze(normalized);
}

export function parseRoutingDecision(value: unknown): RoutingDecision {
  const decision = routingDecisionSchema.parse(value);
  if (reasonSummaries[decision.reason_code] !== decision.reason_summary) {
    throw new Error('Routing decision reason summary does not match reason code');
  }
  const { decision_hash: decisionHash, ...hashInput } = decision;
  if (sha256(canonicalize(hashInput)) !== decisionHash) {
    throw new Error('Routing decision hash mismatch');
  }
  return deepFreeze(decision);
}

export function parseRoutingDecisionDraft(
  value: unknown,
): RoutingDecisionDraft {
  return deepFreeze(decisionDraftSchema.parse(value));
}

export function routingReasonSummary(reasonCode: RoutingReasonCode): string {
  return reasonSummaries[reasonCode];
}

export function hashTaskRoutingRequest(request: TaskRoutingRequest): string {
  return sha256(canonicalize(request));
}

export function routeRank(route: RoutingRoute): number {
  return routingRoutes.indexOf(route);
}

function rejectDuplicates(
  values: readonly string[],
  context: z.RefinementCtx,
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: 'custom', message: 'values must be unique' });
  }
}

function validateTransitionOrder(
  draft: { readonly transition_trace: readonly RoutingTransition[] },
  context: z.RefinementCtx,
): void {
  let previous = -1;
  for (const [index, transition] of draft.transition_trace.entries()) {
    const current = routingStages.indexOf(transition.stage);
    if (current < previous) {
      context.addIssue({
        code: 'custom',
        path: ['transition_trace', index],
        message: 'routing transitions must follow the finite state order',
      });
      return;
    }
    previous = current;
  }
  if (draft.transition_trace.at(-1)?.stage !== 'FINAL') {
    context.addIssue({
      code: 'custom',
      path: ['transition_trace'],
      message: 'routing transition trace must terminate at FINAL',
    });
  }
}

function validateDecisionSemantics(
  draft: {
    readonly decision: string;
    readonly route: string | null;
    readonly provider_candidate: string | null;
    readonly reason_code: RoutingReasonCode;
    readonly transition_trace: readonly RoutingTransition[];
  },
  context: z.RefinementCtx,
): void {
  const expectedRoute = {
    CACHE: 'cache',
    DETERMINISTIC: 'deterministic',
    LOCAL: 'local',
    CHEAP_CLOUD: 'cheap-cloud',
    STRONG: 'strong',
  }[draft.decision];
  if (expectedRoute !== undefined && draft.route !== expectedRoute) {
    context.addIssue({
      code: 'custom',
      path: ['route'],
      message: 'decision and route are inconsistent',
    });
  }
  if (
    (draft.decision === 'DETERMINISTIC' &&
      draft.provider_candidate !== null) ||
    (['LOCAL', 'CHEAP_CLOUD', 'STRONG', 'APPROVAL_REQUIRED'].includes(
      draft.decision,
    ) && draft.provider_candidate === null) ||
    (draft.route === null && draft.provider_candidate !== null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['provider_candidate'],
      message: 'decision and provider candidate are inconsistent',
    });
  }
  if (
    draft.decision === 'APPROVAL_REQUIRED' &&
    !['local', 'cheap-cloud', 'strong'].includes(draft.route ?? '')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['route'],
      message: 'approval decision requires a provider route',
    });
  }
  const final = draft.transition_trace.at(-1);
  if (final?.reason_code !== draft.reason_code) {
    context.addIssue({
      code: 'custom',
      path: ['transition_trace'],
      message: 'final transition must match the decision reason',
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
