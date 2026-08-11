import { describe, expect, it, vi } from 'vitest';

import {
  type InvokeResult,
  LocalInvoker,
  type RoutingDecision,
} from '../src/index.js';

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

function createAdapter(invokeResult?: InvokeResult | Error) {
  return {
    invoke: vi.fn<(_: { prompt: string }) => Promise<InvokeResult>>().mockImplementation(
      () =>
        invokeResult instanceof Error
          ? Promise.reject(invokeResult)
          : Promise.resolve(invokeResult ?? { text: 'ok', inputTokens: 1, outputTokens: 2, latencyMs: 100 }),
    ),
  };
}

describe('LocalInvoker', () => {
  const invoker = new LocalInvoker();

  it('invokes adapter exactly once for LOCAL + local-ai', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(decision(), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('success');
    expect(adapter.invoke).toHaveBeenCalledOnce();
  });

  it('does not invoke adapter for non-LOCAL decision', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(decision({ decision: 'STOP' }), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('does not invoke adapter for LOCAL with null provider', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(decision({ provider_candidate: null }), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('does not invoke adapter for LOCAL with non-local provider', async () => {
    const adapter = createAdapter();
    const result = await invoker.invoke(decision({ provider_candidate: 'deepseek' }), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('denied');
    expect(adapter.invoke).not.toHaveBeenCalled();
  });

  it('returns success result deterministically', async () => {
    const invokeResult: InvokeResult = { text: 'hello', inputTokens: 3, outputTokens: 4, latencyMs: 200 };
    const adapter = createAdapter(invokeResult);
    const result = await invoker.invoke(decision(), adapter as never, { prompt: 'test' });
    expect(result).toEqual({ status: 'success', result: invokeResult });
  });

  it('returns fail-closed on adapter error', async () => {
    const adapter = createAdapter(new Error('adapter failure'));
    const result = await invoker.invoke(decision(), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('adapter failure');
    }
  });

  it('causes zero retries on adapter error', async () => {
    const adapter = createAdapter(new Error('adapter failure'));
    await invoker.invoke(decision(), adapter as never, { prompt: 'test' });
    expect(adapter.invoke).toHaveBeenCalledOnce();
  });

  it('does not trigger fallback to other providers on failure', async () => {
    const adapter = createAdapter(new Error('adapter failure'));
    const result = await invoker.invoke(decision(), adapter as never, { prompt: 'test' });
    expect(result.status).toBe('failed');
    // No second adapter, no re-routing — verified by scope
  });
});
