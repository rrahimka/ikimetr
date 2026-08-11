# Phase 3G.4 — End-to-End AI Execution Integration Implementation Plan

**Goal:** Wire existing `CostRouter` → `ExecutionCoordinator` → invokers into one controlled execution path without changing any component's internal behavior.

**Tech Stack:** TypeScript 6, Vitest 4, existing `@ikimetr/ai-cost-system` types, `CostRouter`, `ExecutionCoordinator`, `OllamaAdapter`, `DeepSeekAdapter`.

**Approved design:** [`../specs/2026-08-10-phase-3g4-e2e-execution-integration-design.md`](../specs/2026-08-10-phase-3g4-e2e-execution-integration-design.md) (v1.2 — invoke params separated)

## Global constraints

- Do not change `CostRouter`.
- Do not change `ExecutionCoordinator`.
- Do not change `LocalInvoker`.
- Do not change `CheapCloudInvoker`.
- Do not change `OllamaAdapter`.
- Do not change `DeepSeekAdapter`.
- Do not change budget, ledger, policy, config, or routing contracts.
- Do not add dependencies.
- Do not retry.
- Do not fallback.
- Do not reselect providers.
- Do not make network/fetch calls inside the integration component.
- Do not read API keys.
- Do not use subagents.
- Do not commit without explicit approval.

---

## Architecture note (v1.2)

`ExecutionCoordinator` already owns `LocalInvoker` and `CheapCloudInvoker`
through its own constructor injection. `AiExecutor` does NOT duplicate
invoker ownership.

`AiExecutor` owns:
- `router` — produces RoutingDecision
- `coordinator` — dispatches to invokers
- `localAdapter` — passed to coordinator for LOCAL path
- `cheapCloudAdapter` — passed to coordinator for CHEAP_CLOUD path

### Invoke params vs routing request

`TaskRoutingRequest` (routing contracts) and `InvokeParams` (adapters) are
structurally incompatible types with zero field overlap. They must remain
separate arguments.

The AiExecutor's public method receives three distinct arguments:

```ts
execute(
  routingRequest: unknown,
  routingContext: unknown,
  invokeParams: Parameters<LocalInvoker['invoke']>[2],
): Promise<AiExecutorResult>
```

`Parameters<LocalInvoker['invoke']>[2]` (OllamaAdapter InvokeParams) is a
structural superset of `Parameters<CheapCloudInvoker['invoke']>[2]`
(DeepSeekAdapter InvokeParams). The extra `format?: string` field is optional
and does not prevent structural assignment to the narrower type. Therefore
the same `invokeParams` value can be passed to both LOCAL and CHEAP_CLOUD
coordinator paths without type assertions.

---

## Files

### Create

`packages/ai-cost-system/src/ai-executor.ts`

Responsibility: accept `execute(routingRequest, routingContext, invokeParams)`,
call `router.evaluate()`, pass the resulting `RoutingDecision` to
`coordinator.execute()` with the appropriate adapter and invoke params,
and return the result.

### Create

`packages/ai-cost-system/test/ai-executor.test.ts`

Responsibility: verify the integration wiring — router → coordinator,
exactly-once, zero-call for STOP/unsupported, no retry, no fallback.

### Modify

`packages/ai-cost-system/src/index.ts`

Only exports of the new `AiExecutor` and its public types.

---

## Task 1 — Write failing contract tests (TDD RED)

### Allowed reads

- `AGENTS.md`
- `packages/ai-cost-system/src/cost-router.ts`
- `packages/ai-cost-system/src/providers/execution-coordinator.ts`
- `packages/ai-cost-system/src/providers/local-invoker.ts`
- `packages/ai-cost-system/src/providers/cheap-cloud-invoker.ts`
- `packages/ai-cost-system/src/providers/ollama-adapter.ts`
- `packages/ai-cost-system/test/execution-coordinator.test.ts`
- `packages/ai-cost-system/src/index.ts`

### Create only

`packages/ai-cost-system/test/ai-executor.test.ts`

Production code must not exist yet.

### Test model (v1.2)

Constructor:

```ts
const executor = new AiExecutor({
  router,
  coordinator,
  localAdapter,
  cheapCloudAdapter,
});
```

Public method:

```ts
const result = await executor.execute(
  routingRequest,
  routingContext,
  invokeParams,
);
```

### Required tests — minimum 10

1. Router produces LOCAL → coordinator called with local route.
2. Router produces LOCAL → coordinator called exactly once.
3. Router produces CHEAP_CLOUD → coordinator called with cheap-cloud route.
4. Router produces CHEAP_CLOUD → coordinator called exactly once.
5. Router produces STOP → coordinator not called, decision returned.
6. Router produces unsupported → coordinator not called.
7. Coordinator result returned to caller unchanged (LOCAL).
8. Coordinator result returned to caller unchanged (CHEAP_CLOUD).
9. Coordinator failure propagated (no retry, no fallback).
10. Integration never calls router more than once per invocation.

### Type safety

- Use existing `RoutingDecision`, adapter types, etc.
- Do not duplicate invoker/coordinator contracts.
- No `as any`.
- Avoid `as unknown`.
- Avoid non-null assertions.
- Fake components only; no real network calls.

### Expected state

Tests will fail to compile/run because `AiExecutor` does not exist yet.
This is TDD RED.

---

## Task 2 — Implement minimum AiExecutor (TDD GREEN)

### Create only

`packages/ai-cost-system/src/ai-executor.ts`

Implement exactly the minimum code to satisfy Task 1 tests.

Constructor dependencies (v1.2):

```ts
new AiExecutor({
  router,            // Pick<CostRouter, 'evaluate'>
  coordinator,       // Pick<ExecutionCoordinator, 'execute'>
  localAdapter,      // Parameters<LocalInvoker['invoke']>[1]
  cheapCloudAdapter, // Parameters<CheapCloudInvoker['invoke']>[1]
})
```

The `AiExecutor` must:

1. Call `router.evaluate(routingRequest, routingContext)` exactly once.
2. If `decision.decision` is STOP or the decision is not LOCAL/CHEAP_CLOUD,
   return the decision without calling the coordinator.
3. If LOCAL: call `coordinator.execute({ route: 'local', decision, adapter: localAdapter, params: invokeParams })`.
4. If CHEAP_CLOUD: call `coordinator.execute({ route: 'cheap-cloud', decision, adapter: cheapCloudAdapter, params: invokeParams })`.
5. Return the coordinator result unchanged.
6. Never retry, fallback, or re-route.

### Type safety

- Same constraints as Task 1.
- Derive types from existing signatures where possible.

### Corrective verification (v1.3)

Before running tests, apply two narrow fixes required by the approved design
v1.3 corrective exception:

#### Fix 1 — Production type widening (local-invoker.ts)

```diff
// packages/ai-cost-system/src/providers/local-invoker.ts

-  adapter: OllamaAdapter,
+  adapter: Pick<OllamaAdapter, 'invoke'>,
```

This aligns `LocalInvoker` with the capability-based DI pattern already used
by `CheapCloudInvoker` (`Pick<DeepSeekAdapter, 'invoke'>`). The change
propagates automatically to `ExecutionCoordinator.LocalExecuteInput.adapter`
and `AiExecutor.localAdapter` since both derive from
`Parameters<LocalInvoker['invoke']>[1]`.

No behavioral change. No other LocalInvoker modifications.

#### Fix 2 — Test result narrowing (ai-executor.test.ts)

Two tests access `result.status` where the result type `AiExecutorResult`
includes `RoutingDecision` (which has no `status` property). Narrow with:

```ts
if ('status' in result) {
  expect(result.status).toBe('failed');
}
```

No casts.

---

## Task 3 — Export and verify (GREEN checkpoint)

### Modify

`packages/ai-cost-system/src/index.ts`

Export `AiExecutor` and its public types.

### Verify

```bash
pnpm --filter @ikimetr/ai-cost-system typecheck
pnpm --filter @ikimetr/ai-cost-system exec vitest run test/ai-executor.test.ts
```

Then full checkpoint:

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

Target:

- lint PASS
- typecheck PASS
- unit all PASS
- integration 3/3 PASS
- build PASS

---

## STOP boundaries

- Do not begin Task 1 without explicit approval of this plan.
- Do not proceed to Task 2 until Task 1 is reviewed and accepted as RED.
- Do not proceed to Task 3 until Task 2 is reviewed and accepted as GREEN.
- Do not implement Qwen, streaming, retry, fallback, or autonomous routing.
