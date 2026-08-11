# AI Cost Verified Cache Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, immutable, repository-local verified cache
runtime above the approved Phase 3B foundations.

**Architecture:** Persist one strict canonical JSON document per immutable
content-addressed revision beneath `.ai-cost/cache/`. A runtime validates
lineage, compatibility, evidence, data policy, checksums, and matching ledger
events before reuse; process-local single-flight suppresses duplicate work.

**Tech Stack:** Node.js 24 APIs, TypeScript, Zod 4, `node:crypto`, `node:fs`,
Vitest, existing canonicalization/ledger/single-flight foundations.

## Global Constraints

- Phase 3C only; do not begin Phase 3D.
- No new dependencies, databases, Redis, migrations, provider calls, Router,
  PromptBuilder, Verification/Fix Loop, Ollama, or cloud adapters.
- Do not modify apps, database, business logic, provider profiles, or AI policy.
- Never persist raw prompt/source/log/PII, secrets, env values, or split
  metadata/payload files.
- Secret caching is denied. Sensitive persistent caching requires ledger-backed
  scoped approval plus injected HMAC and local encryption-capable codec.
- Use failing tests before each production behavior. Do not commit from this
  inherited dirty workspace; preserve all existing Phase 1/3A/3B changes.
- Run final verification from a WSL-native filesystem and use only existing
  loopback Compose infrastructure for integration tests.

---

### Task 1: Strict cache records and verification evidence

**Files:**

- Create: `packages/ai-cost-system/src/cache-entry.ts`
- Create: `packages/ai-cost-system/src/verification-evidence.ts`
- Create: `packages/ai-cost-system/test/cache-entry.test.ts`
- Modify: `packages/ai-cost-system/src/cache.ts`

**Interfaces:**

- Consumes: `canonicalize`, `sha256`, `CacheKeyInput`, `DataClass`, and the
  existing secret-like value guard.
- Produces: `CacheEntry`, `CacheCompatibilityContext`, `CachePayloadInput`,
  `VerificationEvidence`, `parseCacheEntry`, `finalizeCacheEntry`,
  `validateVerificationEvidence`, `assertAllowedTransition`, and typed errors.

- [ ] Write a failing test proving a public canonical payload round-trips and
  its hand-computed expected hash is stable despite object key order.
- [ ] Run `pnpm --filter @ikimetr/ai-cost-system test:unit -- cache-entry.test.ts`
  and confirm failure because the record API is absent.
- [ ] Implement bounded canonical JSON validation, strict payload/evidence/
  provenance schemas, canonical hashes, deep freeze, and exported types.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Add failing cases for unknown/raw prompt/source/log/PII fields, secret-like
  values, non-finite/unsupported JSON, checksum mismatch, and byte ceiling.
- [ ] Implement the minimal fail-closed validation and re-run the focused test.
- [ ] Add failing state-machine tests for every allowed edge and prohibited
  `negative -> verified`, `quarantined -> verified`, and terminal-state edge.
- [ ] Implement the allowlisted transition table and re-run all package tests.

### Task 2: Immutable content-addressed file storage

**Files:**

- Create: `packages/ai-cost-system/src/cache-storage.ts`
- Create: `packages/ai-cost-system/test/cache-storage.test.ts`

**Interfaces:**

- Consumes: strict finalized `CacheEntry` values and canonical serialization.
- Produces: `CacheStorage.open(repositoryRoot)`, `append(entry)`,
  `readRevisions(namespace, cacheKey)`, `CacheStorageError`, and deterministic
  storage paths internal to the class.

- [ ] Write failing real-filesystem tests for valid write/read, identical-key
  path stability, byte-identical idempotence, and immutable distinct revisions.
- [ ] Run the focused storage test and confirm the missing-class RED.
- [ ] Implement fixed-root path derivation and temp/full-write/fsync/close/atomic
  rename publication without a mutable head file.
- [ ] Re-run the focused storage test and confirm GREEN.
- [ ] Add failing tests for traversal-like namespace/key input, symlinked state,
  cache, shard, key, and entry paths, non-regular files, partial and malformed
  JSON, unexpected filenames, and checksum mismatch.
- [ ] Implement no-follow boundary checks and strict directory scanning; reject
  every unsafe or malformed revision without repairing or deleting it.
- [ ] Re-run storage and existing accounting tests.

### Task 3: Deterministic lineage and cache runtime

**Files:**

- Create: `packages/ai-cost-system/src/cache-runtime.ts`
- Create: `packages/ai-cost-system/test/cache-runtime.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

- Consumes: `CacheStorage`, `AccountingLedger`, strict entries, cache-key
  builder, and `SingleFlight`.
- Produces: `VerifiedCacheRuntime.open`, `begin`, `storeUnverified`,
  `storeNegative`, `publishVerified`, `lookupVerified`, `lookupNegative`, and
  `coordinate` with immutable result objects.

- [ ] Write failing tests proving pending/unverified writes produce one unique
  lineage head and unverified entries never satisfy verified lookup.
- [ ] Run the focused runtime test and confirm the missing-runtime RED.
- [ ] Implement initialization, strict builders, parent linkage, unique-head
  replay, and generic writes limited to non-verified states.
- [ ] Re-run the focused tests and confirm GREEN.
- [ ] Add failing tests for conflicting parents/children and forbidden state
  transitions returning quarantine/fail-closed rather than selecting a winner.
- [ ] Implement deterministic lineage validation and quarantine results.
- [ ] Add a failing concurrency test proving `coordinate` runs one real
  operation for identical fingerprints and clears after success/failure.
- [ ] Integrate the existing `SingleFlight` and re-run all package tests.

### Task 4: Verified evidence, compatibility, and invalidation

**Files:**

- Modify: `packages/ai-cost-system/src/cache-runtime.ts`
- Modify: `packages/ai-cost-system/src/verification-evidence.ts`
- Modify: `packages/ai-cost-system/test/cache-runtime.test.ts`

**Interfaces:**

- Consumes: immutable verification config, a `VerificationAuthority`, exact
  `CacheCompatibilityContext`, and an unverified source revision.
- Produces: trusted verified publication and lookup outcomes `hit`, `miss`,
  `invalidated`, or `quarantined`.

- [ ] Add failing tests proving a provider/generic caller cannot self-mark
  verified and incomplete, duplicate, unknown-command, nonzero-exit, or wrong
  profile evidence is rejected.
- [ ] Implement injected authority validation and allowlisted evidence checks;
  the runtime must not execute commands.
- [ ] Add failing tests for valid verified reuse and expired verified miss.
- [ ] Add table-driven failing tests for policy, config, prompt, model, task/input,
  diff, error, tool/dependency, verification-profile, and data-policy changes.
- [ ] Implement exact compatibility comparison, artifact/evidence rehashing,
  TTL checks, and deterministic invalidation without deleting stale revisions.
- [ ] Re-run the focused and complete package test suites.

### Task 5: Sensitive payload and negative-cache gates

**Files:**

- Modify: `packages/ai-cost-system/src/cache-entry.ts`
- Modify: `packages/ai-cost-system/src/cache-runtime.ts`
- Modify: `packages/ai-cost-system/test/cache-entry.test.ts`
- Modify: `packages/ai-cost-system/test/cache-runtime.test.ts`

**Interfaces:**

- Consumes: ledger `ApprovalEvent`, `HmacSha256Provider`, injected
  `SensitiveCacheCodec`, explicit payload ceiling, and nullable negative TTL.
- Produces: sealed sensitive payload persistence/read and bounded negative cache
  outcomes without env access.

- [ ] Add failing tests for Sensitive denial without approval, without HMAC,
  without codec, with revoked approval, and with plain SHA input protection.
- [ ] Implement latest-effective task/scope approval replay, sealed envelope
  validation, HMAC plaintext integrity, and fail-closed read/write behavior.
- [ ] Add failing tests proving Secret is always denied and encrypted Sensitive
  round-trips only through the injected fixture codec.
- [ ] Add failing tests for null/expired negative TTL, allowed deterministic
  negative hit, and transient outage denial unless explicitly policy-enabled.
- [ ] Implement negative-cache gates and re-run all package tests.

### Task 6: Cache audit events and unaudited-entry denial

**Files:**

- Modify: `packages/ai-cost-system/src/ledger-events.ts`
- Modify: `packages/ai-cost-system/src/cache-runtime.ts`
- Create: `packages/ai-cost-system/test/cache-ledger.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`

**Interfaces:**

- Consumes: the existing strict append-only `AccountingLedger`.
- Produces: strict CacheEvents for `lookup`, `hit`, `miss`, `write`,
  `invalidate`, `quarantine`, `negative-hit`, and `verified-reuse`, plus audit
  linkage required for every reusable revision.

- [ ] Write failing ledger-schema tests for the complete action enum, strict
  fields, and rejection of raw prompt/log/PII fields.
- [ ] Extend `CacheEvent` without changing budget events or ledger storage.
- [ ] Add failing real-ledger tests proving write, lookup/miss, verified reuse,
  negative hit, invalidate, and quarantine events contain hashes only.
- [ ] Implement event emission and require a replay-matched write event before
  reuse; ledger append failure must deny the operation.
- [ ] Add a failing test for a file published without its planned ledger event
  and implement unaudited-entry quarantine.
- [ ] Re-run package unit tests, typecheck, build, and config validation.

### Task 7: Self-review and full verification

**Files:**

- Modify only Phase 3C files if a reproduced review finding requires a fix.

**Interfaces:**

- Consumes: completed Phase 3C diff and the approved verification baseline.
- Produces: fresh package/project verification evidence and a security verdict.

- [ ] Review the diff for cache poisoning, stale reuse, transition bypass,
  traversal, symlinks, partial writes, checksum/provenance/audit bypass,
  sensitive persistence, hidden PII, duplicate work, dependency creep, and
  fail-open paths.
- [ ] For every defect found, add a failing regression test before the fix and
  re-run the focused test after the minimal correction.
- [ ] In a WSL-native checkout run package unit tests, typecheck, build, and
  `validate:config`.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, temporary loopback
  integration services plus `pnpm test:integration`, `pnpm build`, and
  `git diff --check`.
- [ ] Stop only task-created integration resources; preserve user volumes/data.
- [ ] Compare the final diff line-by-line with the Phase 3C scope and report
  exact results without starting Phase 3D.
