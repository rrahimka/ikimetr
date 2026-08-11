import { describe, expect, it, vi } from 'vitest';

import {
  type CheapCloudInvoker,
  type DeepSeekAdapter,
  ExecutionCoordinator,
  type LocalInvoker,
  type OllamaAdapter,
  type RoutingDecision,
} from '../src/index.js';

type LocalInvokerShape = Pick<LocalInvoker, 'invoke'>;
type CheapCloudInvokerShape = Pick<CheapCloudInvoker, 'invoke'>;
type LocalResult = Awaited<ReturnType<LocalInvoker['invoke']>>;
type CheapCloudResult = Awaited<ReturnType<CheapCloudInvoker['invoke']>>;

function decision(
  overrides: Partial<RoutingDecision> = {},
): RoutingDecision {
  return {
    decision: 'LOCAL',
    route: 'local',
    provider_candidate: 'local-ai',
    reason_code: 'ROUTE_SELECTED',
    cache_status: 'MISS',
    budget_status: 'ALLOWED',
    pricing_status: 'KNOWN',
    data_policy_status: 'ALLOWED',
    approval_status: 'NOT_REQUIRED',
    escalation_allowed: false,
    transition_trace: [
      { stage: 'CACHE', outcome: 'CONTINUE', reason_code: 'CACHE_MISS' },
      { stage: 'DETERMINISTIC', outcome: 'CONTINUE', reason_code: 'DETERMINISTIC_UNRESOLVED' },
      { stage: 'LOCAL', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
      { stage: 'FINAL', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
    ],
    reason_summary: 'The first eligible route and provider were selected.',
    config_hash: 'a'.repeat(64),
    request_hash: 'b'.repeat(64),
    decision_hash: 'c'.repeat(64),
    ...overrides,
  } as RoutingDecision;
}

function cheapCloudDecision(
  overrides: Partial<RoutingDecision> = {},
): RoutingDecision {
  return decision({
    decision: 'CHEAP_CLOUD',
    route: 'cheap-cloud',
    provider_candidate: 'deepseek',
    transition_trace: [
      { stage: 'CACHE', outcome: 'CONTINUE', reason_code: 'CACHE_MISS' },
      { stage: 'DETERMINISTIC', outcome: 'CONTINUE', reason_code: 'DETERMINISTIC_UNRESOLVED' },
      { stage: 'LOCAL', outcome: 'SKIPPED', reason_code: 'LOCAL_UNAVAILABLE' },
      { stage: 'CHEAP_CLOUD', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
      { stage: 'FINAL', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
    ],
    ...overrides,
  });
}

const dummyOllamaAdapter = {
  invoke: vi.fn<OllamaAdapter['invoke']>(),
};

const dummyDeepSeekAdapter = {
  invoke: vi.fn<DeepSeekAdapter['invoke']>(),
} satisfies Pick<DeepSeekAdapter, 'invoke'>;

function createLocalInvoker(result?: LocalResult | Error) {
  const defaultResult: LocalResult = {
    status: 'success',
    result: { text: 'local-response', inputTokens: 1, outputTokens: 2, latencyMs: 10 },
  };
  return {
    invoke: vi
      .fn<LocalInvoker['invoke']>()
      .mockImplementation(() =>
        result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result ?? defaultResult),
      ),
  } satisfies LocalInvokerShape;
}

function createCheapCloudInvoker(result?: CheapCloudResult | Error) {
  const defaultResult: CheapCloudResult = {
    status: 'success',
    result: { text: 'cloud-response', inputTokens: 3, outputTokens: 4, latencyMs: 50 },
  };
  return {
    invoke: vi
      .fn<CheapCloudInvoker['invoke']>()
      .mockImplementation(() =>
        result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result ?? defaultResult),
      ),
  } satisfies CheapCloudInvokerShape;
}

describe('ExecutionCoordinator', () => {
  it('1. LOCAL + local-ai invokes LocalInvoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'local',
      decision: decision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(localMock.invoke).toHaveBeenCalledOnce();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('2. LOCAL + local-ai does NOT invoke CheapCloudInvoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'local',
      decision: decision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('3. CHEAP_CLOUD + deepseek invokes CheapCloudInvoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(cheapMock.invoke).toHaveBeenCalledOnce();
    expect(localMock.invoke).not.toHaveBeenCalled();
  });

  it('4. CHEAP_CLOUD + deepseek does NOT invoke LocalInvoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(localMock.invoke).not.toHaveBeenCalled();
  });

  it('5. STOP invokes neither invoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'none',
      decision: decision({ decision: 'STOP', route: null }),
    });

    expect(result.status).toBe('unsupported');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('6. STRONG invokes neither invoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'none',
      decision: decision({ decision: 'STRONG', route: 'strong' }),
    });

    expect(result.status).toBe('unsupported');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('7. CHEAP_CLOUD + qwen invokes neither invoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision({ provider_candidate: 'qwen' }),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(result.status).toBe('denied');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('8. LOCAL + deepseek invokes neither invoker', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'local',
      decision: decision({ provider_candidate: 'deepseek' }),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(result.status).toBe('denied');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('9. authorized LOCAL invokes LocalInvoker exactly once', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'local',
      decision: decision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(localMock.invoke).toHaveBeenCalledOnce();
  });

  it('10. authorized CHEAP_CLOUD invokes CheapCloudInvoker exactly once', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(cheapMock.invoke).toHaveBeenCalledOnce();
  });

  it('11. LocalInvoker failed result does NOT trigger CheapCloud fallback', async () => {
    const failedResult: LocalResult = {
      status: 'failed',
      reason: 'local failure',
      errorCode: 'ERR',
    };
    const localMock = createLocalInvoker(failedResult);
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'local',
      decision: decision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(result.status).toBe('failed');
    expect(localMock.invoke).toHaveBeenCalledOnce();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('12. CheapCloudInvoker failed result does NOT trigger Local fallback', async () => {
    const failedResult: CheapCloudResult = {
      status: 'failed',
      reason: 'cloud failure',
      errorCode: 'ERR',
    };
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker(failedResult);
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(result.status).toBe('failed');
    expect(cheapMock.invoke).toHaveBeenCalledOnce();
    expect(localMock.invoke).not.toHaveBeenCalled();
  });

  it('13. LocalInvoker result is returned to caller unchanged', async () => {
    const invokeResult: LocalResult = {
      status: 'success',
      result: { text: 'exact-result', inputTokens: 7, outputTokens: 8, latencyMs: 99 },
    };
    const localMock = createLocalInvoker(invokeResult);
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'local',
      decision: decision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(result).toEqual(invokeResult);
  });

  it('14. CheapCloudInvoker result is returned to caller unchanged', async () => {
    const invokeResult: CheapCloudResult = {
      status: 'success',
      result: { text: 'exact-cloud', inputTokens: 9, outputTokens: 10, latencyMs: 88 },
    };
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker(invokeResult);
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'cheap-cloud',
      decision: cheapCloudDecision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(result).toEqual(invokeResult);
  });

  it('15. route cheap-cloud with LOCAL decision invokes neither', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'cheap-cloud',
      decision: decision(),
      adapter: dummyDeepSeekAdapter,
      params: { prompt: 'test' } satisfies Parameters<CheapCloudInvoker['invoke']>[2],
    });

    expect(result.status).toBe('denied');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });

  it('16. route local with CHEAP_CLOUD decision invokes neither', async () => {
    const localMock = createLocalInvoker();
    const cheapMock = createCheapCloudInvoker();
    const coordinator = new ExecutionCoordinator({
      localInvoker: localMock,
      cheapCloudInvoker: cheapMock,
    });

    const result = await coordinator.execute({
      route: 'local',
      decision: cheapCloudDecision(),
      adapter: dummyOllamaAdapter as never,
      params: { prompt: 'test' } satisfies Parameters<LocalInvoker['invoke']>[2],
    });

    expect(result.status).toBe('denied');
    expect(localMock.invoke).not.toHaveBeenCalled();
    expect(cheapMock.invoke).not.toHaveBeenCalled();
  });
});
