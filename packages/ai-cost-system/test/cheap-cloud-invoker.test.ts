import { describe, expect, it, vi } from 'vitest';

import {
  CheapCloudInvoker,
  type CheapCloudInvokeResult,
  type DeepSeekAdapter,
  type RoutingDecision,
} from '../src/index.js';

type DeepSeekInvoker = Pick<DeepSeekAdapter, 'invoke'>;

function decision(
  overrides: Partial<RoutingDecision> = {},
): RoutingDecision {
  return {
    decision: 'CHEAP_CLOUD',
    route: 'cheap-cloud',
    provider_candidate: 'deepseek',
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
      { stage: 'LOCAL', outcome: 'SKIPPED', reason_code: 'LOCAL_UNAVAILABLE' },
      { stage: 'CHEAP_CLOUD', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
      { stage: 'FINAL', outcome: 'SELECTED', reason_code: 'ROUTE_SELECTED' },
    ],
    reason_summary: 'The first eligible route and provider were selected.',
    config_hash: 'a'.repeat(64),
    request_hash: 'b'.repeat(64),
    decision_hash: 'c'.repeat(64),
    ...overrides,
  } as RoutingDecision;
}

type AdapterResult = Awaited<ReturnType<DeepSeekAdapter['invoke']>>;

function createAdapter(invokeResult?: AdapterResult | Error) {
  return {
    invoke: vi
      .fn<(_: Parameters<DeepSeekAdapter['invoke']>[0]) => Promise<AdapterResult>>()
      .mockImplementation(() =>
        invokeResult instanceof Error
          ? Promise.reject(invokeResult)
          : Promise.resolve(
              invokeResult ?? {
                text: 'deepseek-response',
                inputTokens: 10,
                outputTokens: 20,
                latencyMs: 150,
              },
            ),
      ),
  } satisfies DeepSeekInvoker;
}

describe('CheapCloudInvoker', () => {
  const invoker = new CheapCloudInvoker();

  it('1. CHEAP_CLOUD + deepseek is accepted', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('success');
  });

  it('2. allowed invocation calls adapter exactly once', async () => {
    const adapter = createAdapter();
    await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(adapter.invoke).toHaveBeenCalledOnce();
  });

  it('3. adapter result is returned correctly', async () => {
    const invokeResult: AdapterResult = {
      text: 'hello-from-deepseek',
      inputTokens: 5,
      outputTokens: 10,
      latencyMs: 99,
    };
    const adapter = createAdapter(invokeResult);
    const result = await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result).toEqual(invokeResult);
    }
  });

  it('4. non-CHEAP_CLOUD decision is rejected', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(
      decision({ decision: 'STOP' }),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('5. CHEAP_CLOUD with null provider is rejected', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(
      decision({ provider_candidate: null }),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('6. CHEAP_CLOUD with non-deepseek provider is rejected', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(
      decision({ provider_candidate: 'qwen' }),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('7. rejected decision invokes adapter zero times', async () => {
    const adapter = createAdapter();
    await invoker.invoke(
      decision({ decision: 'LOCAL' }),
      adapter,
      { prompt: 'test' },
    );
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('8. adapter error is propagated to the caller', async () => {
    const adapter = createAdapter(new Error('adapter explosion'));
    const result = await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('adapter explosion');
    }
  });

  it('9. adapter failure causes NO retry — adapter invoked exactly once', async () => {
    const adapter = createAdapter(new Error('adapter explosion'));
    await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(adapter.invoke).toHaveBeenCalledOnce();
  });

  it('10. adapter failure does NOT fallback to another provider', async () => {
    const adapter = createAdapter(new Error('adapter explosion'));
    const result = await invoker.invoke(
      decision(),
      adapter,
      { prompt: 'test' },
    );
    expect(result.status).toBe('failed');
    // No second adapter, no re-routing — verified by scope
  });

  it('11. unauthorized decision cannot cause a paid invocation', async () => {
    const adapter = createAdapter();

    const deniedResults: CheapCloudInvokeResult[] = await Promise.all([
      invoker.invoke(
        decision({ decision: 'STOP' }),
        adapter,
        { prompt: 'test' },
      ),
      invoker.invoke(
        decision({ decision: 'LOCAL' }),
        adapter,
        { prompt: 'test' },
      ),
      invoker.invoke(
        decision({ decision: 'STRONG' }),
        adapter,
        { prompt: 'test' },
      ),
      invoker.invoke(
        decision({ provider_candidate: null }),
        adapter,
        { prompt: 'test' },
      ),
      invoker.invoke(
        decision({ provider_candidate: 'qwen' }),
        adapter,
        { prompt: 'test' },
      ),
    ]);

    for (const result of deniedResults) {
      expect(result.status).toBe('denied');
    }
    expect(adapter.invoke).not.toHaveBeenCalled();
  });
});
