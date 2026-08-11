# Phase 3G.4 — End-to-End AI Execution Integration

**Date:** 2026-08-10
**Status:** Approved — ready for planning (v1.2 — invoke params separated)

## Goal

Connect the existing `CostRouter`, `ExecutionCoordinator`, `LocalInvoker`, and
`CheapCloudInvoker` into one controlled, testable execution path without
changing any component's internal behavior.

The router, coordinator, invokers, and adapters are already implemented and
individually tested. This phase wires them together.

## Architecture

```
AiExecutor.execute(routingRequest, routingContext, invokeParams)
  → CostRouter.evaluate(routingRequest, routingContext)
    → RoutingDecision
      → ExecutionCoordinator.execute({ route, decision, adapter, params })
        → LocalInvoker.invoke(decision, adapter, params)
          → OllamaAdapter.invoke(params)
        → CheapCloudInvoker.invoke(decision, adapter, params)
          → DeepSeekAdapter.invoke(params)
```

Responsibilities remain separated:

- `CostRouter` decides routing (unchanged). Receives `routingRequest` and
  `routingContext` exactly as passed to `AiExecutor.execute()`.
- `ExecutionCoordinator` validates and dispatches to invokers (unchanged).
  ExecutionCoordinator owns `LocalInvoker` and `CheapCloudInvoker` via its
  own constructor injection.
- `LocalInvoker` / `CheapCloudInvoker` own their invocation boundaries
  (unchanged).
- `OllamaAdapter` / `DeepSeekAdapter` own network/provider specifics
  (unchanged).

`AiExecutor` is a thin orchestration layer. It owns the router, coordinator,
and adapters. It does NOT duplicate invoker ownership — that belongs to
ExecutionCoordinator.

## Constructor contract (v1.2)

```ts
new AiExecutor({
  router,
  coordinator,
  localAdapter,
  cheapCloudAdapter,
})
```

| Dependency | Type | Purpose |
|-----------|------|---------|
| `router` | `Pick<CostRouter, 'evaluate'>` | Produce RoutingDecision |
| `coordinator` | `Pick<ExecutionCoordinator, 'execute'>` | Dispatch execution |
| `localAdapter` | `Parameters<LocalInvoker['invoke']>[1]` | OllamaAdapter for LOCAL path |
| `cheapCloudAdapter` | `Parameters<CheapCloudInvoker['invoke']>[1]` | Pick<DeepSeekAdapter, 'invoke'> for CHEAP_CLOUD path |

`LocalInvoker` and `CheapCloudInvoker` are NOT AiExecutor dependencies
because `ExecutionCoordinator` already owns them through its own constructor.
AiExecutor does not invoke invokers directly — it delegates to the
coordinator, which dispatches to its own invokers.

## Public execution contract (v1.2)

```ts
execute(
  routingRequest: unknown,
  routingContext: unknown,
  invokeParams: Parameters<LocalInvoker['invoke']>[2],
): Promise<AiExecutorResult>
```

### Data flow

1. `routingRequest` → passed directly to `router.evaluate(routingRequest, routingContext)`.
2. `routingContext` → passed directly to `router.evaluate(routingRequest, routingContext)`.
3. `invokeParams` → passed ONLY to `coordinator.execute()` for executable paths.
4. `RoutingDecision` returned by router → passed unchanged to coordinator.

### Invoke params type analysis

`Parameters<LocalInvoker['invoke']>[2]` resolves to OllamaAdapter's
`InvokeParams`:

```ts
{ prompt: string; system?: string; temperature?: number; maxTokens?: number; format?: string }
```

`Parameters<CheapCloudInvoker['invoke']>[2]` resolves to DeepSeekAdapter's
`InvokeParams`:

```ts
{ prompt: string; system?: string; temperature?: number; maxTokens?: number }
```

The LOCAL type is a structural superset of the CHEAP_CLOUD type (adds
optional `format`). TypeScript structural typing accepts the wider LOCAL type
where the narrower CHEAP_CLOUD type is expected because:

- All required fields match (`prompt: string`)
- The extra field (`format?: string`) is optional — excess optional properties
  are allowed on non-fresh types

Therefore `Parameters<LocalInvoker['invoke']>[2]` can be used as the
AiExecutor's public `invokeParams` type and safely passed to both:
- `coordinator.execute()` with `route: 'local'` (exact match)
- `coordinator.execute()` with `route: 'cheap-cloud'` (structural superset,
  extra optional field ignored)

No type assertion, narrowing, or reconstruction is needed.

## Integration contract

The integration component must:

1. Accept `execute(routingRequest, routingContext, invokeParams)`.
2. Call `router.evaluate(routingRequest, routingContext)` exactly once to obtain
   a `RoutingDecision`.
3. If the decision is STOP or otherwise not LOCAL/CHEAP_CLOUD, return the
   decision without calling the coordinator.
4. If the decision authorizes LOCAL:
   - call `coordinator.execute({ route: 'local', decision, adapter: localAdapter, params: invokeParams })`;
   - return the coordinator result unchanged.
5. If the decision authorizes CHEAP_CLOUD:
   - call `coordinator.execute({ route: 'cheap-cloud', decision, adapter: cheapCloudAdapter, params: invokeParams })`;
   - return the coordinator result unchanged.
6. Never retry, fallback, or re-route.
7. Never bypass CostRouter.
8. Never override RoutingDecision.
9. Never select a provider autonomously.

## Scope

Allowed implementation files:

1. `packages/ai-cost-system/src/ai-executor.ts` — integration component
2. `packages/ai-cost-system/test/ai-executor.test.ts` — contract tests
3. `packages/ai-cost-system/src/index.ts` — exports only

### Corrective exception — LocalInvoker adapter type (v1.3)

Phase 3G.4 is authorized to apply one narrowly scoped production-type
correction:

```diff
// packages/ai-cost-system/src/providers/local-invoker.ts

-  adapter: OllamaAdapter,
+  adapter: Pick<OllamaAdapter, 'invoke'>,
```

Reasoning:

- `LocalInvoker.invoke()` only consumes the adapter's `invoke` capability.
- Requiring the full concrete `OllamaAdapter` creates unnecessary nominal
  coupling because the class contains private members (`baseUrl`, `taskId`,
  `config`, `budgetController`, `ledger`, `configSnapshot`, `now`).
- `CheapCloudInvoker.invoke()` already follows the correct capability-based
  DI pattern with `Pick<DeepSeekAdapter, 'invoke'>`.
- `ExecutionCoordinator.LocalExecuteInput.adapter` derives from
  `Parameters<LocalInvoker['invoke']>[1]`, so the correction propagates
  automatically to the coordinator and AiExecutor without further changes.
- This is a **type-contract widening only**. No runtime behavior changes.
  No routing, retry, fallback, network, API-key, or config changes.

This exception authorizes **only** the single-line adapter type change in
`local-invoker.ts`. All other LocalInvoker behavior, structure, and tests
remain untouched.

No other production files may be changed without explicit approval.

Specifically out of scope:

- CostRouter changes
- ExecutionCoordinator changes
- LocalInvoker / CheapCloudInvoker changes
- OllamaAdapter / DeepSeekAdapter changes
- budget / ledger / policy / config changes
- routing contract changes
- Qwen adapter
- retries
- fallback
- provider reselection
- real network calls in unit tests
- streaming
- background agents
- new dependencies

## Cost and safety boundary

The integration component has no authority to spend money independently.

Paid-provider authorization must already exist in the `RoutingDecision`
produced by `CostRouter`.

Budget enforcement remains inside the existing budget/adapter path.

The integration component must not:

- bypass `CostRouter`;
- bypass `ExecutionCoordinator`;
- bypass invoker authorization;
- create new budget limits;
- override provider configuration;
- read API keys;
- log prompts, API keys, secrets, or PII.

## Testing design

Unit tests must use fake/mock components and must not make real network calls.

Use fake CostRouter, fake ExecutionCoordinator, fake adapters. Test the
integration wiring, not the internals of each component.

Minimum behavioral coverage:

1. Router produces LOCAL → integration calls coordinator with local route.
2. Router produces CHEAP_CLOUD → integration calls coordinator with
   cheap-cloud route.
3. Coordinator result is returned to caller unchanged.
4. Router produces STOP → integration returns without calling coordinator.
5. Router produces unsupported decision → integration returns without calling
   coordinator.
6. Coordinator failure is propagated (no retry).
7. Integration never calls the router more than once per invocation.
8. Integration never calls the coordinator more than once per invocation.
9. No fallback from local to cheap-cloud.
10. No fallback from cheap-cloud to local.

## Definition of Done

Phase 3G.4 is complete only when:

- `AiExecutor` exists as a small integration boundary;
- only the three approved files are changed;
- no existing component behavior is modified;
- narrow `AiExecutor` tests pass;
- `@ikimetr/ai-cost-system` typecheck passes;
- full `@ikimetr/ai-cost-system` tests pass;
- full project checkpoint passes:

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

No real paid API call is required for Phase 3G.4.

## Future boundary

Any Qwen adapter or additional provider support must be designed as a separate
phase.

Phase 3G.4 must not prematurely generalize for providers or execution paths
that are not currently approved.
