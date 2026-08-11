# AI Cost Deterministic Core Design

**Status:** Approved

**Scope:** Phase 3B only. This design adds deterministic accounting, pricing,
budget reservation/settlement, cache metadata/key construction, and
single-process single-flight coordination to `@ikimetr/ai-cost-system`.

## Constraints

- The append-only JSONL ledger is the only source of truth for persistent
  budget state. Do not add snapshots, mutable counter files, PostgreSQL, Redis,
  migrations, or another framework.
- Do not implement routing, provider calls, PromptBuilder, Verification/Fix
  Loop, Ollama, or cloud-model adapters.
- Runtime files remain under repository-local `.ai-cost/`, which is gitignored.
- Do not read env values, make network calls, or persist raw prompts, source
  files, logs, secrets, or raw PII.

## Components

### Money and pricing

The canonical money value is `{ currency, amountMicros }`, where
`amountMicros` is a non-negative safe integer and one currency unit equals
1,000,000 micros. Pricing rates are non-negative safe-integer micros per one
million tokens. Cost calculation uses `BigInt`, rounds fractional micros up,
and rejects results outside JavaScript's safe-integer range.

The pricing resolver consumes only the immutable, validated config snapshot.
`known` pricing may be resolved for an exact provider/model pair. `stale` and
`unknown` pricing deny automatic cloud use. The resolver never retrieves or
scrapes prices.

### Accounting ledger

`.ai-cost/ledger.jsonl` contains a strict, versioned discriminated union of:

- `AttemptStarted`
- `AttemptCompleted`
- `BudgetReservation`
- `BudgetSettlement`
- `CacheEvent`
- `ProviderHealthEvent`
- `ApprovalEvent`
- `VerificationEvent`

Serialized event fields use `snake_case`. Identifiers, enum-like reason codes,
hashes, timestamps, token counts, money, and status fields are validated;
unknown fields are rejected. Free-form prompt, source, log, PII, credential,
and env-value fields are not part of any schema.

Append operations run through one in-process serialized critical section. Each
canonical JSON record is opened with append semantics, completely written,
synced, and closed before the operation succeeds. Existing lines are never
updated. A partial, malformed, duplicate-transition, or schema-invalid record
causes replay to fail closed.

The storage boundary derives the fixed `.ai-cost` path from a repository root.
It rejects path traversal, a symlinked state directory, and a symlinked ledger.

### Persistent budget controller

The controller starts blocked and becomes ready only after deterministic replay
of every validated ledger event. Replay restores active reservations,
settlements, task and provider/task totals, provider/day and cloud/day totals,
provider/month and cloud/month totals, cloud call counts, retries, local wall
time, and the persistent discrepancy circuit flag. Day and month buckets use
UTC calendar boundaries from event timestamps.

`reserve()` serializes these actions:

1. Reject calls before successful replay or while a discrepancy circuit is set.
2. Resolve known pricing where automatic cloud use requires it.
3. Reserve estimated input tokens, configured maximum output tokens, one call,
   retry count when applicable, local wall time when applicable, and the
   worst-case rounded-up cost.
4. Evaluate every applicable non-null task/provider/day/month/cloud ceiling.
   A null limit means not configured and denies the reservation; it never means
   unlimited. The effective ceiling is the minimum applicable ceiling.
5. Append and sync `BudgetReservation`, then update in-memory derived state.

`settle()` accepts actual usage once. It appends `BudgetSettlement`, charges
actual usage, and releases unused reserve. Actual usage above any reserved
dimension records an overrun settlement and permanently blocks automatic calls
until a future explicitly authorized recovery mechanism handles the ledger.

`release()` is an explicit safe-recovery operation for a reservation known not
to have produced billable usage. It appends a release settlement before
removing the active reserve. Double settlement, double release, reservation ID
replay, and unknown reservation IDs are rejected before append.

Reservations left active by a crash remain active after replay and block new
automatic calls until explicitly settled or released. Restarting or splitting
a task cannot reset counters or bypass limits.

### Cache metadata and single-flight

The cache key builder canonicalizes the approved Phase 2 fields and hashes them
with SHA-256: policy version, routing config hash, prompt version, route,
provider/model revision, task-spec hash, ordered approved input hashes, diff
hash, error fingerprint, tool/dependency versions, and verification-profile
hash.

Metadata supports `pending`, `unverified`, `verified`, `negative`, and
`quarantined`. Only an unexpired, schema-valid `verified` entry is reusable as
verified. Malformed metadata is rejected; unverified or quarantined metadata
cannot be promoted implicitly.

Secret data is never cacheable. Sensitive persistent caching is denied by
default and requires explicit approval plus an injected HMAC-SHA-256 interface;
the package never reads an HMAC key or env value automatically. Raw sensitive
inputs are not metadata.

Single-flight is process-local. One computation owns a request fingerprint;
concurrent duplicates reuse that promise and never start a second computation.
The entry is removed after success or failure. No distributed lock is added.

## Error and recovery behavior

- Config, pricing, budget, ledger, cache, path, and overflow failures are typed
  fail-closed errors.
- Ledger append failure blocks the controller before any derived state mutation.
- Replay creates derived state from an empty accumulator in file order; it does
  not repair or skip invalid records.
- No automated truncation, ledger rewrite, reservation expiry, or circuit reset
  exists in Phase 3B.

## Test strategy

Use TDD with real temporary directories and the actual JSONL implementation.
Tests cover strict event validation, append-only behavior, deterministic
serialization/replay, crash reservations, restart persistence, UTC buckets,
money precision/overflow, pricing status gates, all configured budget scopes,
retry accounting, overrun circuit behavior, concurrent reservations, cache
eligibility/poisoning rules, path/symlink rejection, and single-flight reuse.

Full verification runs from a WSL-native checkout using the previously approved
loopback-only temporary Compose environment. Phase 3C is not started.
