import { afterEach, describe, expect, it } from 'vitest';

import {
  capabilityIds,
  PolicyEvaluator,
  type RoutingDecisionDraft,
  type TaskRoutingRequest,
  parseTaskRoutingRequest,
} from '../src/index.js';
import {
  createConfigFixture,
  type ConfigFixture,
  nestedObject,
} from './config-fixture.js';

const hash = (character: string): string => character.repeat(64);
const fixtures: ConfigFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()));
});

function request(
  overrides: Partial<TaskRoutingRequest> = {},
): TaskRoutingRequest {
  return parseTaskRoutingRequest({
    task_id: 'phase-3d-task',
    task_type: 'implementation',
    purpose: 'routine-change',
    risk_class: 'low',
    data_class: 'internal',
    requested_capability: 'routine-analysis',
    task_spec_hash: hash('1'),
    input_hashes: [hash('2')],
    current_diff_hash: hash('3'),
    error_fingerprint: null,
    verification_profile: 'standard',
    allowed_routes: ['deterministic', 'local', 'cheap-cloud', 'strong'],
    max_route: 'strong',
    approval_context: {
      requested_scopes: [],
    },
    manual_primary_agent: 'codex',
    ...overrides,
  });
}

async function enabledLocalEvaluator(options?: {
  readonly risks?: readonly string[];
  readonly capabilities?: readonly string[];
}): Promise<PolicyEvaluator> {
  const fixture = await createConfigFixture();
  fixtures.push(fixture);
  const providersConfig = await fixture.read('providers.json');
  const providers = nestedObject(providersConfig, 'providers');
  const local = nestedObject(providers, 'local-ai');
  local['enabled'] = true;
  local['model'] = 'local-test-model';
  local['allowedRiskClasses'] = options?.risks ?? ['low'];
  local['allowedCapabilities'] = options?.capabilities ?? ['routine-analysis'];
  local['maxInputTokens'] = 2_000;
  local['maxOutputTokens'] = 1_000;
  local['maxCallsPerTask'] = 2;
  local['maxCostPerTask'] = { currency: 'USD', amountMicros: 10_000 };
  local['timeoutMs'] = 5_000;
  const retryPolicy = nestedObject(local, 'retryPolicy');
  retryPolicy['maxRetries'] = 0;
  await fixture.write('providers.json', providersConfig);

  return new PolicyEvaluator(await fixture.load());
}

function deterministicDraft(): RoutingDecisionDraft {
  return {
    decision: 'DETERMINISTIC',
    route: 'deterministic',
    provider_candidate: null,
    reason_code: 'DETERMINISTIC_CAPABILITY',
    cache_status: 'MISS',
    budget_status: 'NOT_APPLICABLE',
    pricing_status: 'NOT_APPLICABLE',
    data_policy_status: 'ALLOWED',
    approval_status: 'NOT_REQUIRED',
    escalation_allowed: false,
    transition_trace: [
      { stage: 'CACHE', outcome: 'CONTINUE', reason_code: 'CACHE_MISS' },
      {
        stage: 'DETERMINISTIC',
        outcome: 'SELECTED',
        reason_code: 'DETERMINISTIC_CAPABILITY',
      },
      {
        stage: 'FINAL',
        outcome: 'SELECTED',
        reason_code: 'DETERMINISTIC_CAPABILITY',
      },
    ],
  };
}

describe('TaskRoutingRequest', () => {
  it('rejects unknown fields and raw content fields', () => {
    expect(() =>
      parseTaskRoutingRequest({ ...request(), raw_prompt: 'do not persist' }),
    ).toThrow();
  });

  it('rejects unknown risk classes and capabilities', () => {
    expect(() =>
      parseTaskRoutingRequest({ ...request(), risk_class: 'unknown' }),
    ).toThrow();
    expect(() =>
      parseTaskRoutingRequest({
        ...request(),
        requested_capability: 'provider-defined-capability',
      }),
    ).toThrow();
  });
});

describe('PolicyEvaluator', () => {
  it('classifies every exact capability as deterministic', async () => {
    const fixture = await createConfigFixture();
    fixtures.push(fixture);
    const evaluator = new PolicyEvaluator(await fixture.load());
    const aiCapabilities = new Set([
      'routine-analysis',
      'routine-implementation',
      'documentation',
      'test-generation',
      'low-risk-refactor',
      'complex-implementation',
      'complex-debugging',
      'architecture-review',
      'security-review',
    ]);

    for (const capability of capabilityIds) {
      const isDeterministic = !aiCapabilities.has(capability);
      expect(
        evaluator.isDeterministicCapability(
          request({ requested_capability: capability }),
        ),
      ).toBe(isDeterministic);
    }
  });

  it('allows only configured provider risk classes and capabilities', async () => {
    const evaluator = await enabledLocalEvaluator();

    expect(
      evaluator.evaluateProviderPolicy(
        request({
          data_class: 'public',
          risk_class: 'low',
          purpose: 'classification',
        }),
        'local-ai',
      ),
    ).toEqual({ allowed: true, reason_code: 'DATA_POLICY_ALLOWED' });
    expect(
      evaluator.evaluateProviderPolicy(
        request({
          data_class: 'public',
          purpose: 'classification',
          risk_class: 'high',
        }),
        'local-ai',
      ),
    ).toEqual({ allowed: false, reason_code: 'RISK_CLASS_DENIED' });
    expect(
      evaluator.evaluateProviderPolicy(
        request({
          data_class: 'public',
          risk_class: 'low',
          purpose: 'classification',
          requested_capability: 'complex-debugging',
        }),
        'local-ai',
      ),
    ).toEqual({ allowed: false, reason_code: 'CAPABILITY_DENIED' });
  });

  it('treats empty provider allowlists as deny', async () => {
    const withoutRisk = await enabledLocalEvaluator({ risks: [] });
    const withoutCapability = await enabledLocalEvaluator({ capabilities: [] });

    const eligible = {
      data_class: 'public' as const,
      risk_class: 'low' as const,
      purpose: 'classification' as const,
    };

    expect(
      withoutRisk.evaluateProviderPolicy(request(eligible), 'local-ai'),
    ).toEqual({ allowed: false, reason_code: 'RISK_CLASS_DENIED' });
    expect(
      withoutCapability.evaluateProviderPolicy(request(eligible), 'local-ai'),
    ).toEqual({ allowed: false, reason_code: 'CAPABILITY_DENIED' });
  });

  it('enforces allowed routes and the maximum route', async () => {
    const evaluator = await enabledLocalEvaluator();

    expect(evaluator.evaluateRoutePolicy(request(), 'local')).toEqual({
      allowed: true,
      reason_code: 'ROUTE_ALLOWED',
    });
    expect(
      evaluator.evaluateRoutePolicy(
        request({ allowed_routes: ['deterministic', 'local'] }),
        'cheap-cloud',
      ),
    ).toEqual({ allowed: false, reason_code: 'ROUTE_NOT_ALLOWED' });
    expect(
      evaluator.evaluateRoutePolicy(
        request({ max_route: 'local' }),
        'cheap-cloud',
      ),
    ).toEqual({ allowed: false, reason_code: 'MAX_ROUTE_EXCEEDED' });
  });

  it('creates immutable stable decisions whose hash includes config', async () => {
    const first = await enabledLocalEvaluator();
    const second = await enabledLocalEvaluator({ risks: ['low', 'standard'] });

    const firstDecision = first.createDecision(request(), deterministicDraft());
    const repeatedDecision = first.createDecision(
      request(),
      deterministicDraft(),
    );
    const changedConfigDecision = second.createDecision(
      request(),
      deterministicDraft(),
    );

    expect(firstDecision).toEqual(repeatedDecision);
    expect(firstDecision.decision_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(firstDecision.decision_hash).not.toBe(
      changedConfigDecision.decision_hash,
    );
    expect(Object.isFrozen(firstDecision)).toBe(true);
    expect(Object.isFrozen(firstDecision.transition_trace)).toBe(true);
    expect(Reflect.set(firstDecision, 'decision', 'STOP')).toBe(false);
  });

  it('rejects contradictory decision, route, and provider combinations', async () => {
    const evaluator = await enabledLocalEvaluator();

    expect(() =>
      evaluator.createDecision(request(), {
        ...deterministicDraft(),
        decision: 'LOCAL',
        route: 'deterministic',
        provider_candidate: null,
      }),
    ).toThrow();
  });
});

describe('local-ai task whitelist', () => {
  it('allows Public + low + classification', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'classification',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(true);
  });

  it('allows Public + low + short_documentation', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'short_documentation',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(true);
  });

  it('allows Public + low + tiny_typescript', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'tiny_typescript',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(true);
  });

  it('denies Internal + low + whitelisted', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'internal',
        risk_class: 'low',
        purpose: 'classification',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('DATA_CLASS_DENIED');
  });

  it('denies Sensitive + low', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'sensitive',
        risk_class: 'low',
        purpose: 'classification',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('DATA_CLASS_DENIED');
  });

  it('denies Public + medium', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'standard',
        purpose: 'classification',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('RISK_CLASS_DENIED');
  });

  it('denies Public + high', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'high',
        purpose: 'classification',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('RISK_CLASS_DENIED');
  });

  it('denies Public + low + architecture', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'architecture',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('LOCAL_TASK_NOT_ALLOWED');
  });

  it('denies Public + low + security', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'security',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('LOCAL_TASK_NOT_ALLOWED');
  });

  it('denies Public + low + unknown task', async () => {
    const evaluator = await enabledLocalEvaluator();
    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'some-unknown-task',
      }),
      'local-ai',
    );
    expect(result.allowed).toBe(false);
    expect(result.reason_code).toBe('LOCAL_TASK_NOT_ALLOWED');
  });

  it('does not restrict non-local providers', async () => {
    const fixture = await createConfigFixture();
    fixtures.push(fixture);
    const providersConfig = await fixture.read('providers.json');
    const providers = nestedObject(providersConfig, 'providers');
    const deepseek = nestedObject(providers, 'deepseek');
    deepseek['enabled'] = true;
    deepseek['model'] = 'deepseek-test';
    deepseek['allowedRiskClasses'] = ['low'];
    deepseek['allowedCapabilities'] = ['routine-analysis'];
    deepseek['maxInputTokens'] = 2_000;
    deepseek['maxOutputTokens'] = 1_000;
    deepseek['maxCallsPerTask'] = 2;
    deepseek['maxCostPerTask'] = { currency: 'USD', amountMicros: 10_000 };
    deepseek['timeoutMs'] = 5_000;
    const retryPolicy = nestedObject(deepseek, 'retryPolicy');
    retryPolicy['maxRetries'] = 0;
    await fixture.write('providers.json', providersConfig);
    const evaluator = new PolicyEvaluator(await fixture.load());

    const result = evaluator.evaluateProviderPolicy(
      request({
        data_class: 'public',
        risk_class: 'low',
        purpose: 'architecture',
      }),
      'deepseek',
    );
    expect(result.allowed).toBe(true);
    expect(result.reason_code).toBe('DATA_POLICY_ALLOWED');
  });
});
