import { describe, expect, it, vi } from 'vitest';

import {
  AiExecutor,
  type CostRouter,
  type DeepSeekAdapter,
  type ExecutionCoordinator,
  type LocalInvoker,
  type OllamaAdapter,
  type RoutingDecision,
} from '../src/index.js';

type RouterShape = Pick<CostRouter, 'evaluate'>;
type CoordinatorShape = Pick<ExecutionCoordinator, 'execute'>;
type LocalAdapterShape = Pick<OllamaAdapter, 'invoke'>;
type CheapCloudAdapterShape = Pick<DeepSeekAdapter, 'invoke'>;
type InvokeParams = Parameters<LocalInvoker['invoke']>[2];

function localDecision(): RoutingDecision {
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
    reason_summary: 'Selected LOCAL route.',
    config_hash: 'a'.repeat(64),
    request_hash: 'b'.repeat(64),
    decision_hash: 'c'.repeat(64),
  } as RoutingDecision;
}

function cheapCloudDecision(): RoutingDecision {
  return {
    ...localDecision(),
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
    reason_summary: 'Selected CHEAP_CLOUD route.',
  } as RoutingDecision;
}

function stopDecision(): RoutingDecision {
  return {
    ...localDecision(),
    decision: 'STOP',
    route: null,
    provider_candidate: null,
    transition_trace: [
      { stage: 'CACHE', outcome: 'CONTINUE', reason_code: 'CACHE_MISS' },
      { stage: 'FINAL', outcome: 'DENIED', reason_code: 'NO_PROVIDER_AVAILABLE' },
    ],
    reason_summary: 'No provider available.',
  } as RoutingDecision;
}

type CoordinatorResult = Awaited<ReturnType<ExecutionCoordinator['execute']>>;

function createFakeRouter(decision: RoutingDecision) {
  return {
    evaluate: vi.fn<CostRouter['evaluate']>().mockResolvedValue(decision),
  } satisfies RouterShape;
}

function createFakeCoordinator(result: CoordinatorResult) {
  return {
    execute: vi
      .fn<ExecutionCoordinator['execute']>()
      .mockResolvedValue(result),
  } satisfies CoordinatorShape;
}

const fakeLocalAdapter = {
  invoke: vi.fn<OllamaAdapter['invoke']>(),
} satisfies LocalAdapterShape;

const fakeCheapCloudAdapter = {
  invoke: vi.fn<DeepSeekAdapter['invoke']>(),
} satisfies CheapCloudAdapterShape;

const routingRequest = { taskId: 'task-1', type: 'test' };
const routingContext = { estimatedInputTokens: 100 };
const invokeParams: InvokeParams = { prompt: 'hello world' };

describe('AiExecutor', () => {
  it('1. router produces LOCAL → coordinator called with local route', async () => {
    const decision = localDecision();
    const router = createFakeRouter(decision);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 1, outputTokens: 2, latencyMs: 10 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).toHaveBeenCalledOnce();
    const call = coordinator.execute.mock.calls[0];
    if (call) {
      expect(call[0].route).toBe('local');
      expect(call[0].decision).toBe(decision);
    }
  });

  it('2. router receives exact routingRequest and routingContext', async () => {
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 1, outputTokens: 2, latencyMs: 10 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    expect(router.evaluate).toHaveBeenCalledWith(routingRequest, routingContext);
  });

  it('3. router produces CHEAP_CLOUD → coordinator called with cheap-cloud route', async () => {
    const decision = cheapCloudDecision();
    const router = createFakeRouter(decision);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 3, outputTokens: 4, latencyMs: 50 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).toHaveBeenCalledOnce();
    const call = coordinator.execute.mock.calls[0];
    if (call) {
      expect(call[0].route).toBe('cheap-cloud');
      expect(call[0].decision).toBe(decision);
    }
  });

  it('4. LOCAL uses injected localAdapter → coordinator receives it', async () => {
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 1, outputTokens: 2, latencyMs: 10 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    const call = coordinator.execute.mock.calls[0];
    if (call) {
      const input = call[0];
      expect(input.route).toBe('local');
      if (input.route === 'local') {
        expect(input.adapter).toBe(fakeLocalAdapter);
      }
    }
  });

  it('5. CHEAP_CLOUD uses injected cheapCloudAdapter → coordinator receives it', async () => {
    const router = createFakeRouter(cheapCloudDecision());
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 3, outputTokens: 4, latencyMs: 50 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    const call = coordinator.execute.mock.calls[0];
    if (call) {
      const input = call[0];
      expect(input.route).toBe('cheap-cloud');
      if (input.route === 'cheap-cloud') {
        expect(input.adapter).toBe(fakeCheapCloudAdapter);
      }
    }
  });

  it('6. invokeParams forwarded unchanged to coordinator for LOCAL', async () => {
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 1, outputTokens: 2, latencyMs: 10 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    const call = coordinator.execute.mock.calls[0];
    if (call) {
      const input = call[0];
      expect(input.route).toBe('local');
      if (input.route === 'local') {
        expect(input.params).toBe(invokeParams);
      }
    }
  });

  it('7. invokeParams forwarded unchanged to coordinator for CHEAP_CLOUD', async () => {
    const router = createFakeRouter(cheapCloudDecision());
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 3, outputTokens: 4, latencyMs: 50 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    await executor.execute(routingRequest, routingContext, invokeParams);

    const call = coordinator.execute.mock.calls[0];
    if (call) {
      const input = call[0];
      expect(input.route).toBe('cheap-cloud');
      if (input.route === 'cheap-cloud') {
        expect(input.params).toBe(invokeParams);
      }
    }
  });

  it('8. router produces STOP → coordinator not called, decision returned', async () => {
    const decision = stopDecision();
    const router = createFakeRouter(decision);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).not.toHaveBeenCalled();
    expect((result as RoutingDecision).decision).toBe('STOP');
  });

  it('9. router produces STRONG → coordinator not called', async () => {
    const strong = { ...stopDecision(), decision: 'STRONG' as const };
    const router = createFakeRouter(strong);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).not.toHaveBeenCalled();
    expect((result as RoutingDecision).decision).toBe('STRONG');
  });

  it('10. coordinator LOCAL success result is returned unchanged', async () => {
    const coordinatorResult: CoordinatorResult = {
      status: 'success',
      result: { text: 'exact-local', inputTokens: 5, outputTokens: 6, latencyMs: 20 },
    };
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator(coordinatorResult);
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(result).toEqual(coordinatorResult);
  });

  it('11. coordinator CHEAP_CLOUD success result is returned unchanged', async () => {
    const coordinatorResult: CoordinatorResult = {
      status: 'success',
      result: { text: 'exact-cloud', inputTokens: 7, outputTokens: 8, latencyMs: 30 },
    };
    const router = createFakeRouter(cheapCloudDecision());
    const coordinator = createFakeCoordinator(coordinatorResult);
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(result).toEqual(coordinatorResult);
  });

  it('12. coordinator failed result is propagated without retry', async () => {
    const coordinatorResult: CoordinatorResult = {
      status: 'failed',
      reason: 'adapter failure',
      errorCode: 'ERR',
    };
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator(coordinatorResult);
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(result).toEqual(coordinatorResult);
    expect(coordinator.execute).toHaveBeenCalledOnce();
    expect(router.evaluate).toHaveBeenCalledOnce();
  });

  it('13. LOCAL failure → no fallback, router exactly once, coordinator exactly once', async () => {
    const router = createFakeRouter(localDecision());
    const coordinator = createFakeCoordinator({
      status: 'failed',
      reason: 'local failure',
      errorCode: 'ERR',
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    if ('status' in result) {
      expect(result.status).toBe('failed');
    }
    expect(router.evaluate).toHaveBeenCalledOnce();
    expect(coordinator.execute).toHaveBeenCalledOnce();
  });

  it('14. CHEAP_CLOUD failure → no fallback, router exactly once, coordinator exactly once', async () => {
    const router = createFakeRouter(cheapCloudDecision());
    const coordinator = createFakeCoordinator({
      status: 'failed',
      reason: 'cloud failure',
      errorCode: 'ERR',
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    if ('status' in result) {
      expect(result.status).toBe('failed');
    }
    expect(router.evaluate).toHaveBeenCalledOnce();
    expect(coordinator.execute).toHaveBeenCalledOnce();
  });

  it('15. router produces DETERMINISTIC → coordinator not called', async () => {
    const unsupported = {
      ...localDecision(),
      decision: 'DETERMINISTIC' as const,
      route: 'deterministic' as RoutingDecision['route'],
    };
    const router = createFakeRouter(unsupported);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).not.toHaveBeenCalled();
    expect((result as RoutingDecision).decision).toBe('DETERMINISTIC');
  });

  it('16. router produces CACHE → coordinator not called', async () => {
    const cached = {
      ...localDecision(),
      decision: 'CACHE' as const,
      route: 'cache' as RoutingDecision['route'],
    };
    const router = createFakeRouter(cached);
    const coordinator = createFakeCoordinator({
      status: 'success',
      result: { text: 'ok', inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    });
    const executor = new AiExecutor({
      router,
      coordinator,
      localAdapter: fakeLocalAdapter,
      cheapCloudAdapter: fakeCheapCloudAdapter,
    });

    const result = await executor.execute(routingRequest, routingContext, invokeParams);

    expect(coordinator.execute).not.toHaveBeenCalled();
    expect((result as RoutingDecision).decision).toBe('CACHE');
  });
});
