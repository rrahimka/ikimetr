# AI Cost Router Dry-Run Implementation Plan

> **Execution:** Follow this plan in the approved current workspace. Preserve
> the dirty Phase 1/3A/3B/3C baseline, use TDD, and do not commit, stash, reset,
> clean, checkout, or start the next phase.

**Goal:** Add a strict deterministic PolicyEvaluator and a separate dry-run
CostRouter that can return a hashed, audited routing decision without provider,
model, network, shell, budget-reservation, or verification-loop execution.

**Architecture:** Extend the immutable provider configuration with two enum
allowlists. Keep generic policy in a pure evaluator and I/O orchestration in a
bounded finite-state coordinator. Reuse Phase 3B ledger/pricing/budget state and
Phase 3C verified cache lookup. Add only a read-only budget quote and a minimal
routing audit event.

**Tech stack:** TypeScript, Zod 4, Node built-ins, Vitest, existing package
canonicalization/config/ledger/cache/budget modules.

## Task 1: Provider risk and capability allowlists

**Files:**

- Modify: `packages/ai-cost-system/src/schemas.ts`
- Modify: `packages/ai-cost-system/test/config-fixture.ts`
- Modify: `packages/ai-cost-system/test/config-foundation.test.ts`
- Modify: `config/ai-cost/providers.json`

**Steps:**

1. Add failing tests for required strict `allowedRiskClasses` and
   `allowedCapabilities`, unknown enum values, duplicates, and config-hash
   changes.
2. Run the focused config tests and confirm the expected failures.
3. Add shared frozen risk/capability constants and strict provider fields.
4. Populate the disabled bootstrap providers with policy-aligned allowlists;
   do not add models, credentials, endpoints, pricing, or enabled providers.
5. Run the focused config tests and `validate:config`.

## Task 2: Strict routing contracts and pure PolicyEvaluator

**Files:**

- Create: `packages/ai-cost-system/src/routing-contracts.ts`
- Create: `packages/ai-cost-system/src/policy-evaluator.ts`
- Create: `packages/ai-cost-system/test/policy-evaluator.test.ts`

**Steps:**

1. Add failing tests for strict `TaskRoutingRequest` and `RoutingDecision`,
   forbidden/unknown fields, deterministic capabilities, route ceiling,
   allowed/denied risk and capability combinations, fixed reason codes, bounded
   transition order, and canonical hash stability.
2. Run the focused test and confirm RED.
3. Implement parsing, deep immutability, fixed summaries, request hashing,
   decision hashing, route ranks, and pure provider-policy evaluation.
4. Implement the fixed non-recursive state/transition vocabulary.
5. Run the focused test and confirm GREEN.

## Task 3: Read-only BudgetController quote

**Files:**

- Modify: `packages/ai-cost-system/src/budget.ts`
- Modify: `packages/ai-cost-system/test/budget-controller.test.ts`

**Steps:**

1. Add failing tests that quote uses replay, pricing, provider and all budget
   limits; denies before ready, during recovery/discrepancy, and on null limits;
   and never appends or mutates state.
2. Run the focused budget tests and confirm RED.
3. Extract the smallest shared in-memory candidate construction/validation used
   by both `quote()` and `reserve()`.
4. Return a strict immutable quote status with fixed reason codes and estimated
   usage/cost. Do not expose a reservation ID or authorization token.
5. Re-run budget tests, including all existing reservation/replay cases.

## Task 4: Routing ledger state and audit event

**Files:**

- Modify: `packages/ai-cost-system/src/ledger-events.ts`
- Create: `packages/ai-cost-system/src/routing-state.ts`
- Create: `packages/ai-cost-system/test/routing-state.test.ts`

**Steps:**

1. Add failing tests for strict `RoutingDecisionEvent`, replay compatibility,
   latest health normalization, latest approval/denial/revocation, prior route
   insufficiency, new verification evidence, and repeated fingerprints.
2. Run the focused test and confirm RED.
3. Extend the ledger discriminated union with the minimal hash/enum-only event.
4. Implement a pure replay-derived immutable routing-state view. Never skip an
   invalid event and never use routing audit events as authorization evidence.
5. Run focused and existing accounting/cache-ledger tests.

## Task 5: Dry-run CostRouter coordinator

**Files:**

- Create: `packages/ai-cost-system/src/cost-router.ts`
- Create: `packages/ai-cost-system/test/cost-router.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Steps:**

1. Add failing integration tests using real temporary config, ledger, budget
   controller, and Phase 3C cache runtime for:
   - verified cache hit;
   - cache miss/invalidation continuation;
   - cache quarantine/provenance stop;
   - deterministic short-circuit;
   - local selection;
   - DeepSeek then Qwen fallback in config order;
   - strong selection only after evidenced lower-tier insufficiency;
   - disabled/unknown-health/data/risk/capability exclusion;
   - stale/unknown pricing denial;
   - exhausted budget stop;
   - approval required/approved/denied and manual-primary isolation;
   - repeated request without new evidence;
   - stable and config-sensitive decision hashes;
   - audit append failure.
2. Assert no `BudgetReservation` or `AttemptStarted` event appears and no
   provider/network/shell interface exists or is called.
3. Run the focused router test and confirm RED.
4. Implement the bounded `CACHE -> DETERMINISTIC -> LOCAL -> CHEAP_CLOUD ->
   STRONG -> FINAL` coordinator using only injected existing components.
5. Append the minimal routing event after a successful decision; on append
   failure return an unaudited fail-closed STOP without recursive logging.
6. Export only the approved public contracts and runtime.
7. Run all package unit tests and config validation.

## Task 6: Self-review and verification

**Files:**

- Review only the Phase 3D files against the recorded SHA-256 baseline.

**Steps:**

1. Review for schema bypass, provider-specific permission hardcoding, raw data
   leakage, route skipping, recursive transitions, mutable decisions, budget
   mutation, audit recursion, hidden provider/network/shell calls, and scope
   drift.
2. Run from a WSL-native temporary copy:
   - `pnpm --filter @ikimetr/ai-cost-system test:unit`
   - `pnpm --filter @ikimetr/ai-cost-system validate:config`
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test:unit`
   - `pnpm test:integration`
   - `pnpm build`
   - `git diff --check`
3. Use only the existing loopback-bound project integration services, stop only
   services started for this verification, and preserve user volumes/data.
4. Remove only the temporary WSL-native verification copy.
5. Compare final changed paths with the baseline and report exact results and
   known issues. Do not commit or begin the next phase.
