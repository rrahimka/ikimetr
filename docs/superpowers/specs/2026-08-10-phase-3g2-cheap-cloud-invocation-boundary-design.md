# Phase 3G.2 — Cheap Cloud Invocation Boundary

**Date:** 2026-08-10
**Status:** Approved — ready for implementation

## Goal

Introduce a minimal `CheapCloudInvoker` boundary between an already-computed
`CostRouter` decision and the existing `DeepSeekAdapter`.

The invoker does **not** perform routing.
The invoker does **not** choose providers.
The invoker does **not** perform budget decisions.
The invoker does **not** retry or fallback.

Its only responsibility is to safely execute an already-approved `CHEAP_CLOUD`
DeepSeek decision.

## Architecture

```
CostRouter
 → RouteDecision
  → CheapCloudInvoker
   → DeepSeekAdapter
    → DeepSeek API
```

Responsibilities remain separated:

- `CostRouter` decides whether `CHEAP_CLOUD` is allowed and which provider
  candidate is selected.
- `CheapCloudInvoker` validates that the supplied decision authorizes a
  cheap-cloud DeepSeek invocation.
- `DeepSeekAdapter` owns the actual single network invocation, request/response
  validation, timeout, budget lifecycle, accounting, and provider-specific
  errors.

`CheapCloudInvoker` must never call `CostRouter` internally.

## Allowed invocation

Invocation is allowed **only** when all required decision conditions are true:

- `decision.decision === 'CHEAP_CLOUD'`
- `decision.provider_candidate === 'deepseek'`

If either condition is false, `CheapCloudInvoker` must refuse execution without
invoking `DeepSeekAdapter`.

## Invocation contract

For an allowed decision:

- invoke `DeepSeekAdapter` exactly once;
- return the adapter result unchanged or through a minimal typed wrapper if
  required by the existing project pattern;
- do not retry;
- do not re-route;
- do not select another provider;
- do not invoke Qwen;
- do not invoke Claude;
- do not invoke Codex;
- do not invoke Local AI;
- do not perform a second paid request.

If `DeepSeekAdapter` fails, propagate the failure through the defined invoker
result/error contract without attempting another provider.

## Cost and safety boundary

`CheapCloudInvoker` has no authority to spend money independently.

Paid-provider authorization must already exist in the supplied `RouteDecision`.

Budget enforcement remains inside the existing established budget/adapter path.

The invoker must not:

- bypass `PolicyEvaluator`;
- bypass `CostRouter`;
- create new budget limits;
- override provider configuration;
- read API keys;
- log prompts, API keys, secrets, or PII.

## Scope

Allowed implementation files for Phase 3G.2:

1. `packages/ai-cost-system/src/providers/cheap-cloud-invoker.ts`
2. `packages/ai-cost-system/test/cheap-cloud-invoker.test.ts`
3. `packages/ai-cost-system/src/index.ts` — exports only

No other production files may be changed without explicit approval.

Specifically out of scope:

- CostRouter changes
- DeepSeekAdapter changes
- PolicyEvaluator changes
- BudgetController changes
- ledger changes
- provider configuration changes
- Qwen support
- Claude/Codex integration
- retries
- fallback
- automatic provider switching
- real DeepSeek API acceptance call
- streaming
- background agents
- new dependencies

## Testing design

Unit tests must use a fake/mock `DeepSeekAdapter` and must **not** make real
network calls.

Minimum behavioral coverage:

1. `CHEAP_CLOUD` + `deepseek` is accepted.
2. Allowed invocation calls adapter exactly once.
3. Adapter result is returned correctly.
4. Non-`CHEAP_CLOUD` decision is rejected.
5. Wrong provider candidate is rejected.
6. Rejected decision invokes adapter zero times.
7. Adapter error is propagated correctly.
8. Adapter failure does not retry.
9. Adapter failure does not fallback or invoke another provider.
10. No paid/network call can occur from an unauthorized decision.

Tests must verify behavior, not implementation details unnecessarily.

## Definition of Done

Phase 3G.2 is complete only when:

- `CheapCloudInvoker` exists as a small isolated boundary;
- only the three approved files are changed;
- no routing/network logic is added to `CostRouter`;
- no retry/fallback behavior exists;
- narrow `CheapCloudInvoker` tests pass;
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

No real paid DeepSeek API call is required for Phase 3G.2.

## Future boundary

Any future Qwen or additional cheap-cloud provider support must be designed as
a separate phase.

Phase 3G.2 must not prematurely generalize for providers that are not currently
approved.
