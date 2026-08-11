# AI Cost Deterministic Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task-by-task. The active
> environment does not authorize subagent delegation.

**Goal:** Implement the Phase 3B deterministic accounting, pricing, persistent
budget, cache-key/metadata, and single-flight core without any model or router
runtime.

**Architecture:** A strict append-only JSONL ledger is the only persistent
budget source of truth. The controller reconstructs all counters and active
reservations through deterministic replay, then serializes reserve/settle/
release transitions with ledger appends. Pricing, money, cache metadata, and
single-flight remain focused deterministic modules.

**Tech Stack:** Node.js 24, TypeScript 6, Zod 4, Node `crypto`/`fs`, Vitest 4.

## Global Constraints

- No new dependencies, databases, Redis locks, migrations, provider calls,
  Router runtime, PromptBuilder, or Verification/Fix Loop.
- Never read env values or persist raw prompts, source, logs, secrets, or PII.
- All runtime paths stay inside repository-local `.ai-cost/`.
- Money and pricing rates are safe-integer micros; arithmetic uses `BigInt`.
- Tests are written and observed failing before production code.
- Do not commit from this dirty multi-phase workspace.
- Final verification runs from a WSL-native checkout with loopback-only test
  services and complete cleanup.

---

### Task 1: Money and validated pricing

**Files:**

- Create: `packages/ai-cost-system/src/money.ts`
- Create: `packages/ai-cost-system/src/pricing.ts`
- Create: `packages/ai-cost-system/test/pricing.test.ts`
- Modify: `packages/ai-cost-system/src/schemas.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

```ts
export interface Money {
  readonly currency: string;
  readonly amountMicros: number;
}

export function createMoney(currency: string, amountMicros: number): Money;
export function addMoney(left: Money, right: Money): Money;
export function calculateMicrosForTokens(
  tokens: number,
  rateMicrosPerMillionTokens: number,
): number;

export class PricingResolutionError extends Error {}
export class PricingResolver {
  public constructor(snapshot: ConfigSnapshot);
  public resolve(request: {
    provider: ProviderId;
    model: string;
    automatic: boolean;
    cloud: boolean;
  }): ResolvedPricing;
  public calculateCost(pricing: ResolvedPricing, usage: TokenUsage): Money;
}
```

- [ ] Write failing pricing tests with literal expected micros for known input,
  output, cache-read, and cache-write usage; include fractional-micro ceiling,
  large-value overflow, stale cloud, unknown cloud, model mismatch, and currency
  mismatch cases.
- [ ] Run `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/pricing.test.ts`
  and confirm failure because the money/pricing exports do not exist.
- [ ] Change pricing-rate schemas from finite numbers to non-negative safe
  integers and allow the approved budget-class enum while keeping bootstrap
  `NONE` unchanged.
- [ ] Implement the interfaces with `BigInt(tokens) * BigInt(rate)`, ceiling
  division by `1_000_000n`, and a safe-integer range check before returning.
- [ ] Re-run the focused tests and the existing config-foundation tests; keep
  both green.

### Task 2: Strict ledger events and safe append/replay

**Files:**

- Create: `packages/ai-cost-system/src/ledger-events.ts`
- Create: `packages/ai-cost-system/src/ledger.ts`
- Create: `packages/ai-cost-system/test/accounting.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`
- Modify: `.gitignore`

**Interfaces:**

```ts
export type LedgerEvent = z.infer<typeof ledgerEventSchema>;
export function parseLedgerEvent(value: unknown): LedgerEvent;

export class LedgerValidationError extends Error {}
export class LedgerStorageError extends Error {}

export class AccountingLedger {
  public static open(repositoryRoot: string): Promise<AccountingLedger>;
  public append(event: LedgerEvent): Promise<void>;
  public replay(): Promise<readonly LedgerEvent[]>;
}
```

- [ ] Write failing tests for all eight event variants, unknown/malformed/raw
  content rejection, deterministic canonical JSONL, two-event append without
  mutation, corrupted and partial lines, serialized concurrent appends, state
  directory traversal resistance, state-directory symlink escape, and ledger
  symlink escape. Use real temporary directories and files.
- [ ] Run the focused accounting test and confirm the missing-interface RED.
- [ ] Implement strict versioned Zod event schemas with bounded identifier/
  reason-code strings, SHA-256 hex fields, ISO timestamps, safe token/latency
  integers, money objects, and no free-form content fields.
- [ ] Implement a fixed `.ai-cost/ledger.jsonl` boundary derived from a real
  repository root. Reject symlinks with `lstat`, verify containment with
  `realpath`/`relative`, and never accept a caller-supplied ledger filename.
- [ ] Implement an in-process promise-chain mutex. Append one canonical record
  with `O_APPEND | O_CREAT | O_WRONLY`, loop until its complete buffer is
  written, call `sync()`, and close before success. On error, leave callers
  failed and do not rewrite existing content.
- [ ] Implement replay as strict line-order parsing. Reject empty interior
  lines, partial final JSON, duplicate transition identifiers, unknown fields,
  and any invalid event; never skip or repair a record.
- [ ] Add `.ai-cost/` to `.gitignore`, run focused accounting plus config tests,
  and keep them green.

### Task 3: Deterministic replay state

**Files:**

- Create: `packages/ai-cost-system/src/budget.ts`
- Create: `packages/ai-cost-system/test/budget-replay.test.ts`
- Create: `packages/ai-cost-system/test/helpers/config-fixture.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

```ts
export interface ReplayedBudgetState {
  readonly activeReservations: ReadonlyMap<string, BudgetReservationRecord>;
  readonly recoveryBlockingReservationIds: ReadonlySet<string>;
  readonly settledReservationIds: ReadonlySet<string>;
  readonly totals: BudgetTotals;
  readonly automaticCallsBlocked: boolean;
}

export function replayBudgetState(
  events: readonly LedgerEvent[],
): ReplayedBudgetState;
```

- [ ] Write failing replay tests proving restoration of active reservations,
  settlements, releases, task/provider-task totals, provider/cloud UTC day and
  month totals, cloud-call counts, retries, local wall time, and discrepancy
  circuit state.
- [ ] Add RED cases for duplicate reservation IDs, settlement before reserve,
  double settlement, mismatched task/provider/currency, and restart with an
  unfinished reservation.
- [ ] Run the focused replay tests and confirm failure on the missing replay
  implementation.
- [ ] Implement a new empty accumulator and a pure ordered reducer. A released
  reservation contributes no billable usage; a settled reservation contributes
  actual usage; an active reservation contributes worst-case reserved usage.
  Assign usage to the reservation's UTC day/month.
- [ ] Mark every reservation still active at the end of startup replay as
  recovery-blocking. Preserve any overrun circuit flag. Freeze returned state.
- [ ] Re-run replay, accounting, pricing, and config tests.

### Task 4: Atomic reserve, settle, and release

**Files:**

- Modify: `packages/ai-cost-system/src/budget.ts`
- Create: `packages/ai-cost-system/test/budget-controller.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

```ts
export class BudgetControllerError extends Error {}
export class BudgetController {
  public static initialize(options: {
    ledger: AccountingLedger;
    config: ConfigSnapshot;
    pricingResolver: PricingResolver;
    now?: () => Date;
  }): Promise<BudgetController>;
  public reserve(request: BudgetReservationRequest): Promise<ReserveResult>;
  public settle(request: BudgetSettlementRequest): Promise<SettlementResult>;
  public release(request: BudgetReleaseRequest): Promise<ReleaseResult>;
  public getState(): ReplayedBudgetState;
}
```

- [ ] Write failing tests for calls before replay, null budget denial, disabled
  provider, successful reservation, configured max-output reserve, minimum
  provider/task ceiling, task exhaustion, provider/day exhaustion, cloud/day,
  provider/month, cloud/month, cloud-calls/task, retry task/provider limits,
  local wall-time, currency mismatch, and split-call task aggregation.
- [ ] Add failing lifecycle tests for unused-reserve release on settlement,
  explicit non-billable release, restart persistence, recovered-active global
  block, safe recovery settlement/release, reservation replay, double
  settlement, and actual-over-reservation persistent circuit block.
- [ ] Add a concurrency RED test: two simultaneous reservations that each fit
  alone but exceed the shared limit together must yield exactly one success.
- [ ] Run the focused controller tests and confirm the missing behavior RED.
- [ ] Implement initialization as ledger replay; do not expose a usable
  controller if replay fails. Keep automatic reserve blocked while any replayed
  active reservation remains unresolved.
- [ ] Implement one serialized transition queue shared by reserve, settle, and
  release. Check provider ceilings and every applicable budget bucket before
  append. Null in an applicable bucket is `NOT_CONFIGURED` and denies.
- [ ] Append and sync the event before mutating derived state. If append fails,
  set the controller blocked. Reject all replay/double transitions before
  append.
- [ ] On settlement, replace reserved totals with actual totals. When any actual
  dimension exceeds reserve, append an overrun result, set the persistent
  circuit flag, and return a fail-closed discrepancy result.
- [ ] Re-run all package tests and confirm the concurrency/lifecycle cases are
  green without timeouts or mocks.

### Task 5: Cache metadata, protected fingerprints, and single-flight

**Files:**

- Create: `packages/ai-cost-system/src/cache.ts`
- Create: `packages/ai-cost-system/src/single-flight.ts`
- Create: `packages/ai-cost-system/test/cache.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

```ts
export interface HmacSha256Provider {
  digest(value: Uint8Array): string;
}

export function buildApprovedInputHash(options: {
  dataClass: DataClass;
  value: Uint8Array;
  persistent: boolean;
  sensitivePersistenceApproved?: boolean;
  hmac?: HmacSha256Provider;
}): string;

export function buildCacheKey(input: CacheKeyInput): string;
export function parseCacheMetadata(value: unknown): CacheMetadata;
export function isVerifiedCacheHit(
  metadata: CacheMetadata,
  now: Date,
): boolean;

export class SingleFlight<T> {
  public run(key: string, operation: () => Promise<T>): Promise<{
    readonly disposition: 'leader' | 'reused';
    readonly value: T;
  }>;
}
```

- [ ] Write failing tests for identical and meaningfully changed cache inputs,
  ordered input hashes, Secret denial, Sensitive persistent denial by default,
  injected HMAC requirement, strict metadata parsing, malformed poisoning
  rejection, unverified/quarantined/expired non-reuse, and verified reuse.
- [ ] Add failing single-flight tests proving two concurrent calls invoke the
  real operation once, both receive the same value with distinct dispositions,
  and a rejected computation is removed so a later call can retry.
- [ ] Run the focused cache tests and confirm the missing-interface RED.
- [ ] Implement strict cache schemas and SHA-256 canonical key construction.
  Never store the raw input in metadata. Validate injected HMAC output as a
  SHA-256 hex digest and never read its key.
- [ ] Implement process-local single-flight with a Map of active promises and
  identity-safe cleanup in `finally`.
- [ ] Re-run all package tests.

### Task 6: Package integration, security review, and verification

**Files:**

- Modify: `packages/ai-cost-system/package.json`
- Modify: `packages/ai-cost-system/src/index.ts`
- Verify: all Phase 3B files plus the approved design and this plan

- [ ] Change `test:unit` to run all package tests, without adding dependencies.
- [ ] Run package unit tests, package typecheck, package build, and config
  validation in the working tree for fast feedback.
- [ ] Review money precision, budget bypass, replay/double settlement,
  concurrent reservation serialization, append safety, path/symlink escape,
  raw-data schemas, cache poisoning, and every fail-closed branch. Fix findings
  through focused RED/GREEN cycles.
- [ ] Create a fresh WSL-native clone, copy only the current source/config/
  lockfile changes (never `node_modules`), and run offline frozen install.
- [ ] Start only the existing Compose images under a unique project name with
  `--pull never`, loopback bindings, and the approved temporary verification
  bridge. Do not touch existing user volumes.
- [ ] Run package tests/typecheck/build, project lint/typecheck/unit/integration/
  build, `git diff --check`, and config validation.
- [ ] Stop and remove only task-created containers, networks, and task volumes;
  delete the verified temp checkout; confirm the Windows workspace status is
  unchanged except for Phase 3B files.
- [ ] Report exact results and do not start Phase 3C.
