# Phase 3G.2 Cheap Cloud Invocation Boundary Implementation Plan

**Goal:** Add a minimal `CheapCloudInvoker` that executes an already-authorized `CHEAP_CLOUD + deepseek` `RouteDecision` exactly once through the existing `DeepSeekAdapter`.

**Architecture:** `CostRouter` remains decision-only. `CheapCloudInvoker` validates an already-computed routing decision and delegates an authorized request exactly once to `DeepSeekAdapter`. It performs no routing, retry, fallback, provider selection, budget override, API-key access, or network logic of its own.

**Tech Stack:** TypeScript 6, Vitest 4, existing `@ikimetr/ai-cost-system` types, `RouteDecision`, and `DeepSeekAdapter`.

## Global Constraints

- Allowed implementation files only:
  1. `packages/ai-cost-system/src/providers/cheap-cloud-invoker.ts`
  2. `packages/ai-cost-system/test/cheap-cloud-invoker.test.ts`
  3. `packages/ai-cost-system/src/index.ts` — exports only
- No `CostRouter` changes.
- No `DeepSeekAdapter` changes.
- No `PolicyEvaluator` changes.
- No `BudgetController` changes.
- No ledger changes.
- No provider configuration changes.
- No new dependencies.
- No retry.
- No fallback.
- No automatic provider switching.
- No real paid DeepSeek API calls.
- No API keys in tests.
- No Qwen support.
- No Claude/Codex integration.
- No Local AI integration.
- No streaming.
- No background agents.
- No git commit unless explicitly authorized by the user.

---

## File Structure

### Create

`packages/ai-cost-system/src/providers/cheap-cloud-invoker.ts`

Responsibility: enforce the final invocation boundary for an already-approved `CHEAP_CLOUD + deepseek` route and delegate exactly once to `DeepSeekAdapter`.

### Create

`packages/ai-cost-system/test/cheap-cloud-invoker.test.ts`

Responsibility: prove authorization gating, exactly-once invocation, result propagation, error propagation, and absence of retry/fallback.

### Modify

`packages/ai-cost-system/src/index.ts`

Responsibility: export only the new public invoker symbols.

---

# Task 1 — Write CheapCloudInvoker Contract Tests

**Files:**

- Create: `packages/ai-cost-system/test/cheap-cloud-invoker.test.ts`
- Read only for exact existing types:
  - `packages/ai-cost-system/src/providers/local-invoker.ts`
  - `packages/ai-cost-system/src/providers/deepseek-adapter.ts`
  - `packages/ai-cost-system/src/cost-router.ts`

**Purpose:** Establish the required behavior before production implementation.

## Required test strategy

Use a fake adapter.

Do not construct a real `DeepSeekAdapter`.

Do not perform HTTP requests.

Do not provide `DEEPSEEK_API_KEY`.

Type the fake adapter against the existing adapter invocation contract so tests cannot silently drift from `DeepSeekAdapter`.

Preferred structural type:

```ts
type DeepSeekInvoker = Pick<DeepSeekAdapter, 'invoke'>;