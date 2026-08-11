import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AccountingLedger,
  BudgetController,
  CostRouter,
  type CacheCompatibilityContext,
  type ConfigSnapshot,
  hashTaskRoutingRequest,
  parseLedgerEvent,
  parseTaskRoutingRequest,
  PricingResolver,
  type RoutingRuntimeContext,
  type TaskRoutingRequest,
  type VerificationAuthority,
  type VerificationEvidenceInput,
  VerifiedCacheRuntime,
} from '../src/index.js';
import { makePendingInput, makeUnverifiedInput } from './cache-fixture.js';
import {
  createConfigFixture,
  type ConfigFixture,
  type JsonObject,
  nestedObject,
} from './config-fixture.js';

const now = () => new Date('2026-08-09T10:45:00.000Z');
const hash = (character: string): string => character.repeat(64);
const fixtures: ConfigFixture[] = [];
const temporaryDirectories: string[] = [];
const models = {
  'local-ai': 'local-test-model',
  deepseek: 'deepseek-test-model',
  qwen: 'qwen-test-model',
  codex: 'codex-test-model',
  claude: 'claude-test-model',
} as const;

const trustedAuthority: VerificationAuthority = {
  authorityId: 'trusted-router-tests',
  authorityVersion: '1',
  authorize: () => true,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

interface Harness {
  readonly router: CostRouter;
  readonly ledger: AccountingLedger;
  readonly budget: BudgetController;
  readonly cache: VerifiedCacheRuntime;
  readonly snapshot: ConfigSnapshot;
  readonly repository: string;
}

async function createHarness(
  mutate?: (configuration: {
    providers: JsonObject;
    pricing: JsonObject;
    budgets: JsonObject;
  }) => void,
): Promise<Harness> {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providers = await fixture.read('providers.json');
  const pricing = await fixture.read('pricing.json');
  const budgets = await fixture.read('budgets.json');
  configureProviders(providers);
  configurePricing(pricing);
  configureBudgets(budgets);
  mutate?.({ providers, pricing, budgets });
  await fixture.write('providers.json', providers);
  await fixture.write('pricing.json', pricing);
  await fixture.write('budgets.json', budgets);
  const snapshot = await fixture.load();
  const repository = await mkdtemp(join(tmpdir(), 'ikimetr-router-test-'));
  temporaryDirectories.push(repository);
  const ledger = await AccountingLedger.open(repository);
  const pricingResolver = new PricingResolver(snapshot);
  const budget = await BudgetController.initialize({
    ledger,
    config: snapshot,
    pricingResolver,
    now,
  });
  const cache = await VerifiedCacheRuntime.open({
    repositoryRoot: repository,
    ledger,
    configSnapshot: snapshot,
    verificationAuthority: trustedAuthority,
  });
  const router = await CostRouter.initialize({
    ledger,
    config: snapshot,
    pricingResolver,
    budgetController: budget,
    cacheRuntime: cache,
    now,
  });
  return { router, ledger, budget, cache, snapshot, repository };
}

function configureProviders(configuration: JsonObject): void {
  const providers = nestedObject(configuration, 'providers');
  for (const providerId of Object.keys(models) as Array<keyof typeof models>) {
    const provider = nestedObject(providers, providerId);
    Object.assign(provider, {
      enabled: true,
      model: models[providerId],
      maxInputTokens: 2_000,
      maxOutputTokens: 500,
      maxCallsPerTask: 5,
      maxCostPerTask: { currency: 'USD', amountMicros: 50_000 },
      timeoutMs: 5_000,
    });
    nestedObject(provider, 'retryPolicy')['maxRetries'] = 1;
  }
}

function configurePricing(configuration: JsonObject): void {
  const snapshots = configuration['snapshots'];
  if (!Array.isArray(snapshots)) {
    throw new Error('pricing snapshots fixture must be an array');
  }
  for (const value of snapshots) {
    const snapshot = nestedObject({ value }, 'value');
    const provider = snapshot['provider'] as keyof typeof models;
    Object.assign(snapshot, {
      model: models[provider],
      currency: 'USD',
      inputRatePerMillionTokens: 1_000_000,
      outputRatePerMillionTokens: 1_000_000,
      cacheReadRatePerMillionTokens: 1_000_000,
      cacheWriteRatePerMillionTokens: 1_000_000,
      effectiveAt: '2026-08-01T00:00:00.000Z',
      retrievedAt: '2026-08-01T00:00:00.000Z',
      source: 'test-fixture',
      status: 'known',
    });
  }
}

function configureBudgets(configuration: JsonObject): void {
  configuration['defaultBudgetClass'] = 'STRONG_ALLOWED';
  const limits = nestedObject(configuration, 'limits');
  for (const scope of [
    'perTask',
    'providerTask',
    'providerDay',
    'cloudDay',
    'providerMonth',
    'cloudMonth',
  ]) {
    Object.assign(nestedObject(limits, scope), {
      maxInputTokens: 20_000,
      maxOutputTokens: 20_000,
      maxCalls: 20,
      maxCost: { currency: 'USD', amountMicros: 200_000 },
    });
  }
  nestedObject(limits, 'cloudCallsTask')['maxCalls'] = 10;
  Object.assign(nestedObject(limits, 'retryLimits'), {
    maxRetriesPerTask: 2,
    maxRetriesPerProviderTask: 2,
  });
  nestedObject(limits, 'localWallTime')['maxMillisecondsPerTask'] = 20_000;
}

function request(
  overrides: Partial<TaskRoutingRequest> = {},
): TaskRoutingRequest {
  return parseTaskRoutingRequest({
    task_id: 'task-1',
    task_type: 'routine-code-result',
    purpose: 'implementation',
    risk_class: 'low',
    data_class: 'internal',
    requested_capability: 'routine-analysis',
    task_spec_hash: hash('a'),
    input_hashes: [hash('b'), hash('c')],
    current_diff_hash: null,
    error_fingerprint: null,
    verification_profile: 'standard',
    allowed_routes: ['deterministic', 'local', 'cheap-cloud', 'strong'],
    max_route: 'strong',
    approval_context: { requested_scopes: [] },
    manual_primary_agent: 'codex',
    ...overrides,
  });
}

function context(
  overrides: Partial<RoutingRuntimeContext> = {},
): RoutingRuntimeContext {
  return {
    cache_candidates: [],
    estimated_input_tokens: 100,
    retry: false,
    ...overrides,
  };
}

async function appendHealth(
  ledger: AccountingLedger,
  provider: keyof typeof models,
  status: 'healthy' | 'unavailable' | 'timeout' | 'malformed',
  suffix = status,
): Promise<void> {
  await ledger.append(
    parseLedgerEvent({
      event_version: 1,
      event_id: `health-${provider}-${suffix}`,
      event_type: 'ProviderHealthEvent',
      occurred_at: now().toISOString(),
      provider,
      model: models[provider],
      status,
      latency_ms: 10,
      reason_code: suffix,
    }),
  );
}

async function appendApproval(
  ledger: AccountingLedger,
  scope: 'cheap-cloud' | 'strong' | 'secondary-claude',
  decision: 'approved' | 'denied' | 'revoked' = 'approved',
): Promise<void> {
  await ledger.append(
    parseLedgerEvent({
      event_version: 1,
      event_id: `approval-${scope}-${decision}`,
      event_type: 'ApprovalEvent',
      occurred_at: now().toISOString(),
      approval_id: `approval-${scope}-${decision}`,
      task_id: 'task-1',
      decision,
      scope,
      approver_hash: hash('9'),
      reason_code: decision,
    }),
  );
}

async function appendInsufficientAttempt(
  ledger: AccountingLedger,
  taskRequest: TaskRoutingRequest,
  route: 'local' | 'cheap-cloud',
  suffix: string,
): Promise<void> {
  const provider = route === 'local' ? 'local-ai' : 'deepseek';
  const attemptId = `attempt-${suffix}`;
  await ledger.append(
    parseLedgerEvent({
      event_version: 1,
      event_id: `started-${suffix}`,
      event_type: 'AttemptStarted',
      occurred_at: now().toISOString(),
      task_id: taskRequest.task_id,
      attempt_id: attemptId,
      parent_attempt_id: null,
      route,
      provider,
      model: models[provider],
      purpose: 'implementation',
      data_class: 'internal',
      cache_hit: false,
      request_fingerprint: hashTaskRoutingRequest(taskRequest),
      input_hash: hash('8'),
      prompt_version: 'prompt-1',
      config_hash: hash('7'),
      pricing_version: 'pricing-1',
      estimated_cost: { currency: 'USD', amountMicros: 1 },
      status: 'started',
    }),
  );
  await ledger.append(
    parseLedgerEvent({
      event_version: 1,
      event_id: `completed-${suffix}`,
      event_type: 'AttemptCompleted',
      occurred_at: now().toISOString(),
      task_id: taskRequest.task_id,
      attempt_id: attemptId,
      status: 'failed',
      input_tokens: 1,
      output_tokens: 1,
      actual_cost: { currency: 'USD', amountMicros: 1 },
      latency_ms: 1,
      result_hash: null,
      patch_hash: taskRequest.current_diff_hash,
      error_fingerprint: taskRequest.error_fingerprint,
      verification_result: 'unit-fail',
      escalation_reason:
        route === 'local' ? 'local-insufficient' : 'cheap-insufficient',
    }),
  );
}

function evidence(profileHash: string): VerificationEvidenceInput {
  return {
    schema_version: 1,
    required_stages: ['lint'],
    completed_stages: ['lint'],
    stages: [
      {
        stage_id: 'lint',
        command_id: 'lint',
        exit_code: 0,
        evidence_hash: hash('1'),
        tool_version: 'eslint-9',
        duration_ms: 10,
      },
    ],
    authority_id: trustedAuthority.authorityId,
    authority_version: trustedAuthority.authorityVersion,
    verification_profile_hash: profileHash,
    verified_at: '2026-08-09T10:30:00.000Z',
  };
}

async function publishVerified(
  harness: Harness,
  taskRequest: TaskRoutingRequest,
): Promise<CacheCompatibilityContext> {
  const profileHash =
    harness.snapshot.sourceFileHashes['verification.json'];
  const pending = await harness.cache.begin(
    makePendingInput({
      task_id: taskRequest.task_id,
      task_type: taskRequest.task_type,
      route: 'local',
      provider: 'local-ai',
      model_revision: models['local-ai'],
      policy_version: harness.snapshot.configuration.router.policyVersion,
      config_hash: harness.snapshot.configHash,
      verification_profile_hash: profileHash,
      task_spec_hash: taskRequest.task_spec_hash,
      input_hashes: taskRequest.input_hashes,
      diff_hash: taskRequest.current_diff_hash,
      error_fingerprint: taskRequest.error_fingerprint,
      data_class: 'internal',
      expires_at: '2026-08-09T12:00:00.000Z',
    }),
  );
  const unverified = await harness.cache.storeUnverified(
    pending,
    makeUnverifiedInput(pending),
  );
  const verified = await harness.cache.publishVerified(
    unverified,
    makeUnverifiedInput(unverified, {
      entry_id: 'verified-router-1',
      namespace: 'verified-artifact',
      state: 'verified',
      expires_at: '2026-08-09T12:00:00.000Z',
      provenance: {
        ...unverified.provenance,
        producer_kind: 'verification-authority',
        producer_id: trustedAuthority.authorityId,
        source_cache_key: unverified.cache_key,
        source_entry_hash: unverified.entry_hash,
        write_event_id: 'cache-write-verified-router-1',
      },
      payload: unverified.payload,
      verification_evidence: evidence(profileHash),
    }),
  );
  return {
    cache_key: verified.cache_key,
    task_id: verified.task_id,
    task_type: verified.task_type,
    route: verified.route,
    provider: verified.provider,
    model_revision: verified.model_revision,
    prompt_version: verified.prompt_version,
    policy_version: verified.policy_version,
    config_hash: verified.config_hash,
    verification_profile_hash: verified.verification_profile_hash,
    task_spec_hash: verified.task_spec_hash,
    input_hashes: verified.input_hashes,
    diff_hash: verified.diff_hash,
    error_fingerprint: verified.error_fingerprint,
    data_class: verified.data_class,
    input_protection: verified.input_protection,
    data_policy_hash: verified.data_policy_hash,
    tool_versions: verified.tool_versions,
    dependency_versions: verified.dependency_versions,
  };
}

describe('CostRouter dry-run', () => {
  it('returns CACHE only for a compatible verified lookup', async () => {
    const harness = await createHarness();
    const taskRequest = request();
    const cacheContext = await publishVerified(harness, taskRequest);

    const decision = await harness.router.evaluate(
      taskRequest,
      context({ cache_candidates: [cacheContext] }),
    );

    expect(decision.decision).toBe('CACHE');
    expect(decision.cache_status).toBe('HIT');
    expect(decision.provider_candidate).toBe('local-ai');
  });

  it('continues from a real cache miss to deterministic routing', async () => {
    const harness = await createHarness();
    const taskRequest = request({ requested_capability: 'hashing' });
    const missing: CacheCompatibilityContext = {
      cache_key: hash('f'),
      task_id: taskRequest.task_id,
      task_type: taskRequest.task_type,
      route: 'local',
      provider: 'local-ai',
      model_revision: models['local-ai'],
      prompt_version: 'prompt-1',
      policy_version: harness.snapshot.configuration.router.policyVersion,
      config_hash: harness.snapshot.configHash,
      verification_profile_hash:
        harness.snapshot.sourceFileHashes['verification.json'],
      task_spec_hash: taskRequest.task_spec_hash,
      input_hashes: taskRequest.input_hashes,
      diff_hash: taskRequest.current_diff_hash,
      error_fingerprint: taskRequest.error_fingerprint,
      data_class: 'internal',
      input_protection: 'sha256',
      data_policy_hash: hash('e'),
      tool_versions: { node: '24.18.0' },
      dependency_versions: { zod: '4.4.3' },
    };

    const decision = await harness.router.evaluate(
      taskRequest,
      context({ cache_candidates: [missing] }),
    );

    expect(decision.decision).toBe('DETERMINISTIC');
    expect(decision.cache_status).toBe('MISS');
  });

  it('continues from an incompatible verified revision as invalidated', async () => {
    const harness = await createHarness();
    const taskRequest = request({ requested_capability: 'hashing' });
    const cacheContext = await publishVerified(harness, taskRequest);

    const decision = await harness.router.evaluate(
      taskRequest,
      context({
        cache_candidates: [
          {
            ...cacheContext,
            tool_versions: { ...cacheContext.tool_versions, node: '25.0.0' },
          },
        ],
      }),
    );

    expect(decision).toMatchObject({
      decision: 'DETERMINISTIC',
      cache_status: 'INVALIDATED',
    });
  });

  it('stops on cache quarantine instead of routing onward', async () => {
    const harness = await createHarness();
    const lookupVerified = vi.fn().mockResolvedValue({
      status: 'quarantined',
      entry: null,
      value: null,
    });
    const router = await CostRouter.initialize({
      ledger: harness.ledger,
      config: harness.snapshot,
      pricingResolver: new PricingResolver(harness.snapshot),
      budgetController: harness.budget,
      cacheRuntime: { lookupVerified },
      now,
    });
    const taskRequest = request();
    const compatible = await publishVerified(harness, taskRequest);

    const decision = await router.evaluate(
      taskRequest,
      context({ cache_candidates: [compatible] }),
    );

    expect(lookupVerified).toHaveBeenCalledOnce();
    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'CACHE_QUARANTINED',
      cache_status: 'QUARANTINED',
    });
  });

  it('selects LOCAL without reserving budget or invoking network/provider code', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
      }),
      context(),
    );
    const events = await harness.ledger.replay();

    expect(decision).toMatchObject({
      decision: 'LOCAL',
      route: 'local',
      provider_candidate: 'local-ai',
      budget_status: 'ALLOWED',
      pricing_status: 'KNOWN',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.some((value) => value.event_type === 'BudgetReservation')).toBe(
      false,
    );
    expect(events.some((value) => value.event_type === 'AttemptStarted')).toBe(
      false,
    );
    expect(
      events.some((value) => value.event_type === 'RoutingDecisionEvent'),
    ).toBe(true);
  });

  it('falls back from unavailable DeepSeek to Qwen in config order', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'unavailable');
    await appendHealth(harness.ledger, 'deepseek', 'unavailable');
    await appendHealth(harness.ledger, 'qwen', 'healthy');
    await appendApproval(harness.ledger, 'cheap-cloud');

    const decision = await harness.router.evaluate(
      request({ max_route: 'cheap-cloud' }),
      context(),
    );

    expect(decision).toMatchObject({
      decision: 'CHEAP_CLOUD',
      provider_candidate: 'qwen',
      approval_status: 'APPROVED',
    });
    expect(decision.transition_trace).toContainEqual({
      stage: 'CHEAP_CLOUD',
      outcome: 'SKIPPED',
      reason_code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('selects STRONG only after evidenced local and cheap insufficiency', async () => {
    const harness = await createHarness();
    const taskRequest = request({
      current_diff_hash: hash('4'),
      error_fingerprint: hash('5'),
    });
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');
    await appendHealth(harness.ledger, 'codex', 'healthy');
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'local',
      'local',
    );
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'cheap-cloud',
      'cheap',
    );
    await appendApproval(harness.ledger, 'strong');

    const decision = await harness.router.evaluate(taskRequest, context());

    expect(decision).toMatchObject({
      decision: 'STRONG',
      provider_candidate: 'codex',
      approval_status: 'APPROVED',
    });
    expect(decision.transition_trace).toContainEqual({
      stage: 'LOCAL',
      outcome: 'SKIPPED',
      reason_code: 'LOCAL_INSUFFICIENT',
    });
    expect(decision.transition_trace).toContainEqual({
      stage: 'CHEAP_CLOUD',
      outcome: 'SKIPPED',
      reason_code: 'CHEAP_INSUFFICIENT',
    });
  });

  it('requires ledger approval and never treats manual primary as approval', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'unavailable');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({ max_route: 'cheap-cloud', manual_primary_agent: 'codex' }),
      context(),
    );

    expect(decision).toMatchObject({
      decision: 'APPROVAL_REQUIRED',
      provider_candidate: 'deepseek',
      reason_code: 'APPROVAL_REQUIRED',
      approval_status: 'REQUIRED',
    });
  });

  it('requires explicit approval for sensitive cloud routing', async () => {
    const harness = await createHarness(({ providers }) => {
      const configured = nestedObject(providers, 'providers');
      nestedObject(configured, 'local-ai')['enabled'] = false;
      nestedObject(configured, 'deepseek')['allowedDataClasses'] = [
        'public',
        'internal',
        'sensitive',
      ];
    });
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({ data_class: 'sensitive', max_route: 'cheap-cloud' }),
      context(),
    );

    expect(decision).toMatchObject({
      decision: 'APPROVAL_REQUIRED',
      provider_candidate: 'deepseek',
      approval_status: 'REQUIRED',
    });
  });

  it('stops after an explicit approval denial', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'unavailable');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');
    await appendApproval(harness.ledger, 'cheap-cloud', 'denied');

    const decision = await harness.router.evaluate(
      request({ max_route: 'cheap-cloud' }),
      context(),
    );

    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'APPROVAL_DENIED',
      approval_status: 'DENIED',
    });
  });

  it('uses provider capability allowlists for same-route fallback', async () => {
    const harness = await createHarness(({ providers }) => {
      const configured = nestedObject(providers, 'providers');
      nestedObject(configured, 'deepseek')['allowedCapabilities'] = [];
    });
    await appendHealth(harness.ledger, 'local-ai', 'unavailable');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');
    await appendHealth(harness.ledger, 'qwen', 'healthy');
    await appendApproval(harness.ledger, 'cheap-cloud');

    const decision = await harness.router.evaluate(
      request({ max_route: 'cheap-cloud' }),
      context(),
    );

    expect(decision.provider_candidate).toBe('qwen');
    expect(decision.transition_trace).toContainEqual({
      stage: 'CHEAP_CLOUD',
      outcome: 'SKIPPED',
      reason_code: 'CAPABILITY_DENIED',
    });
  });

  it.each(['unknown', 'stale'] as const)(
    'stops when all automatic cheap-cloud pricing is %s',
    async (status) => {
      const harness = await createHarness(({ providers, pricing }) => {
        const configured = nestedObject(providers, 'providers');
        nestedObject(configured, 'local-ai')['enabled'] = false;
        const snapshots = pricing['snapshots'];
        if (!Array.isArray(snapshots)) {
          throw new Error('pricing snapshots fixture must be an array');
        }
        for (const value of snapshots) {
          const snapshot = nestedObject({ value }, 'value');
          if (snapshot['provider'] === 'deepseek' || snapshot['provider'] === 'qwen') {
            snapshot['status'] = status;
            if (status === 'unknown') {
              for (const field of [
                'model',
                'currency',
                'inputRatePerMillionTokens',
                'outputRatePerMillionTokens',
                'cacheReadRatePerMillionTokens',
                'cacheWriteRatePerMillionTokens',
                'effectiveAt',
                'retrievedAt',
                'source',
              ]) {
                snapshot[field] = null;
              }
            }
          }
        }
      });
      await appendHealth(harness.ledger, 'deepseek', 'healthy');
      await appendHealth(harness.ledger, 'qwen', 'healthy');

      const decision = await harness.router.evaluate(
        request({ max_route: 'cheap-cloud' }),
        context(),
      );

      expect(decision).toMatchObject({
        decision: 'STOP',
        reason_code: status === 'unknown' ? 'PRICING_UNKNOWN' : 'PRICING_STALE',
      });
    },
  );

  it('stops on exhausted budget without a reservation write', async () => {
    const harness = await createHarness(({ budgets }) => {
      nestedObject(
        nestedObject(budgets, 'limits'),
        'perTask',
      )['maxInputTokens'] = 50;
    });
    await appendHealth(harness.ledger, 'local-ai', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
      }),
      context(),
    );
    const events = await harness.ledger.replay();

    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'BUDGET_DENIED',
      budget_status: 'DENIED',
    });
    expect(events.some((value) => value.event_type === 'BudgetReservation')).toBe(
      false,
    );
  });

  it('maps an unavailable budget preflight to fail-closed STOP', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    const quote = vi.fn().mockRejectedValue(new Error('budget unavailable'));
    const router = await CostRouter.initialize({
      ledger: harness.ledger,
      config: harness.snapshot,
      pricingResolver: new PricingResolver(harness.snapshot),
      budgetController: { quote },
      cacheRuntime: harness.cache,
      now,
    });

    const decision = await router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
      }),
      context(),
    );

    expect(quote).toHaveBeenCalledOnce();
    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'BUDGET_DENIED',
      budget_status: 'ERROR',
      escalation_allowed: false,
    });
  });

  it('stops repeated same-route failures without new evidence', async () => {
    const harness = await createHarness();
    const taskRequest = request({
      current_diff_hash: hash('4'),
      error_fingerprint: hash('5'),
    });
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'local',
      'repeat-1',
    );
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'local',
      'repeat-2',
    );

    const decision = await harness.router.evaluate(taskRequest, context());

    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'REPEATED_REQUEST',
    });
  });

  it('stops when the evidenced next route exceeds max_route', async () => {
    const harness = await createHarness();
    const taskRequest = request({
      current_diff_hash: hash('4'),
      error_fingerprint: hash('5'),
      max_route: 'cheap-cloud',
    });
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'local',
      'max-local',
    );
    await appendInsufficientAttempt(
      harness.ledger,
      taskRequest,
      'cheap-cloud',
      'max-cheap',
    );

    const decision = await harness.router.evaluate(taskRequest, context());

    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'MAX_ROUTE_EXCEEDED',
      escalation_allowed: false,
    });
  });

  it('terminates with a bounded trace when every provider is disabled', async () => {
    const harness = await createHarness(({ providers }) => {
      const configured = nestedObject(providers, 'providers');
      for (const providerId of Object.keys(models)) {
        nestedObject(configured, providerId)['enabled'] = false;
      }
    });

    const decision = await harness.router.evaluate(request(), context());

    expect(decision.decision).toBe('STOP');
    expect(decision.transition_trace.length).toBeLessThanOrEqual(32);
    expect(decision.transition_trace.at(-1)?.stage).toBe('FINAL');
  });

  it('fails closed for secret data before cache or provider routing', async () => {
    const harness = await createHarness();

    const decision = await harness.router.evaluate(
      request({ data_class: 'secret' }),
      context(),
    );

    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'SECRET_DATA_DENIED',
      cache_status: 'SKIPPED',
    });
  });

  it('returns the same decision hash for unchanged effective state', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');

    const first = await harness.router.evaluate(request(), context());
    const second = await harness.router.evaluate(request(), context());

    expect(second).toEqual(first);
  });

  it('returns fail-closed STOP when audit append fails', async () => {
    const harness = await createHarness();
    const append = vi
      .spyOn(harness.ledger, 'append')
      .mockRejectedValueOnce(new Error('simulated append failure'));

    const decision = await harness.router.evaluate(
      request({ requested_capability: 'hashing' }),
      context(),
    );

    expect(append).toHaveBeenCalledOnce();
    expect(decision).toMatchObject({
      decision: 'STOP',
      reason_code: 'AUDIT_APPEND_FAILED',
      escalation_allowed: false,
    });
  });

  it('returns fail-closed STOP for invalid config and corrupt ledger', async () => {
    const harness = await createHarness();
    const invalidConfig = {
      ...harness.snapshot,
      configHash: hash('f'),
    } as ConfigSnapshot;
    const invalidRouter = await CostRouter.initialize({
      ledger: harness.ledger,
      config: invalidConfig,
      pricingResolver: new PricingResolver(harness.snapshot),
      budgetController: harness.budget,
      cacheRuntime: harness.cache,
      now,
    });
    expect(
      await invalidRouter.evaluate(
        request({ requested_capability: 'hashing' }),
        context(),
      ),
    ).toMatchObject({ decision: 'STOP', reason_code: 'CONFIG_INVALID' });

    await appendFile(
      join(harness.repository, '.ai-cost', 'ledger.jsonl'),
      '{"partial":',
      'utf8',
    );
    expect(
      await harness.router.evaluate(
        request({ requested_capability: 'hashing' }),
        context(),
      ),
    ).toMatchObject({ decision: 'STOP', reason_code: 'LEDGER_INVALID' });
  });
});

describe('local-ai policy routing', () => {
  it('selects local-ai for Public + low + classification', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.decision).toBe('LOCAL');
    expect(decision.provider_candidate).toBe('local-ai');
  });

  it('selects local-ai for Public + low + tiny_typescript', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'tiny_typescript',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.decision).toBe('LOCAL');
    expect(decision.provider_candidate).toBe('local-ai');
  });

  it('does not select disabled local-ai', async () => {
    const harness = await createHarness(({ providers }) => {
      nestedObject(nestedObject(providers, 'providers'), 'local-ai')[
        'enabled'
      ] = false;
    });
    await appendHealth(harness.ledger, 'local-ai', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).not.toBe('local-ai');
  });

  it('does not select local-ai for Internal data', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'internal',
        risk_class: 'low',
        purpose: 'classification',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).not.toBe('local-ai');
  });

  it('does not select local-ai for high risk', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'high',
        purpose: 'classification',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).not.toBe('local-ai');
  });

  it('does not select local-ai for non-whitelisted purpose', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'architecture',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).not.toBe('local-ai');
  });

  it('does not select local-ai for unknown purpose', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'healthy');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'some-unknown-task',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).not.toBe('local-ai');
  });

  it('still routes non-local providers correctly', async () => {
    const harness = await createHarness();
    await appendHealth(harness.ledger, 'local-ai', 'unavailable');
    await appendHealth(harness.ledger, 'deepseek', 'healthy');

    const decision = await harness.router.evaluate(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'architecture',
        requested_capability: 'routine-analysis',
      }),
      context(),
    );

    expect(decision.provider_candidate).toBe('deepseek');
    expect(decision.decision).toBe('APPROVAL_REQUIRED');
  });
});
