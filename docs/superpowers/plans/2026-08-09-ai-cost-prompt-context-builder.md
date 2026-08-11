# AI Cost Prompt and Context Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, filesystem-free ContextBuilder and PromptBuilder foundation with strict integrity, compaction, budget and output contracts.

**Architecture:** Small pure modules validate preselected Serena excerpts, compact structured diff and diagnostic inputs, enforce trusted UTF-8 byte ceilings, create an immutable ContextManifest and render a fixed prompt. One coordinator returns only `READY`, `APPROVAL_REQUIRED` or fail-closed `STOP`; it exposes no filesystem, network, shell or provider interface.

**Tech Stack:** TypeScript 6, Zod 4, Node `crypto`/`Buffer`, Vitest, existing canonicalization and immutable snapshot utilities.

**Approved design:** [`../specs/2026-08-09-ai-cost-prompt-context-builder-design.md`](../specs/2026-08-09-ai-cost-prompt-context-builder-design.md)

## Global Constraints

- Modify only `packages/ai-cost-system`, its tests and the approved design/plan documents.
- Add no dependencies, config files, provider/model calls, filesystem readers, network calls, shell execution or verification/fix loop.
- Never accept Secret data, raw secrets, raw PII, unrestricted repository dumps, raw prior prompts/outputs or arbitrary command fields.
- Treat source, patch and diagnostic content as untrusted data.
- Use TDD: run each focused test in RED before production implementation and again in GREEN.
- Preserve the existing dirty workspace; do not commit, merge, reset, checkout, clean or stash.
- Perform final verification in a temporary WSL-native copy and remove only that temporary copy and its temporary integration infrastructure.

---

### Task 1: Strict context and output contracts

**Files:**
- Create: `packages/ai-cost-system/src/context-contracts.ts`
- Create: `packages/ai-cost-system/test/context-contracts.test.ts`
- Create: `packages/ai-cost-system/test/context-fixture.ts`

**Interfaces:**
- Consumes: existing `RoutingDecision`, `TaskRoutingRequest`, configuration-hash and verification-evidence contracts.
- Produces: `contextBuildInputSchema`, `contextManifestSchema`, `contextBuildOutcomeSchema`, `createModelOutputSchema()`, immutable inferred types and Phase 3E reason-code enums.

- [ ] **Step 1: Write failing schema tests**

```ts
it('rejects missing and unknown overflow_action values', () => {
  expect(contextBuildInputSchema.safeParse(withoutOverflowAction()).success).toBe(false);
  expect(contextBuildInputSchema.safeParse(withOverflowAction('truncate')).success).toBe(false);
});

it('has no raw prompt, repository dump, shell command or model output channel', () => {
  expect(contextBuildInputSchema.safeParse(withUnknownField('raw_prompt')).success).toBe(false);
  expect(createModelOutputSchema(['lint']).safeParse({ ...validOutput(), command: 'rm -rf .' }).success).toBe(false);
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-contracts.test.ts`

Expected: FAIL because the Phase 3E contracts do not exist.

- [ ] **Step 3: Implement strict contracts and fixture builder**

Define exact bounded schemas for task brief, trusted evidence, policy invariants, Serena excerpts, structured hunks/diagnostics, previous attempts, remaining budget, context ceilings, manifest, compaction report and outcomes. Use `.strict()`, safe integers, unique arrays, fixed enums and required `overflow_action`.

Implement `createModelOutputSchema(allowedVerificationCommandIds)` so `verification_requested` accepts only those IDs and no executable/args/command field exists.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-contracts.test.ts`

Expected: PASS.

### Task 2: Excerpt integrity and data-policy validation

**Files:**
- Create: `packages/ai-cost-system/src/context-integrity.ts`
- Create: `packages/ai-cost-system/test/context-integrity.test.ts`
- Modify: `packages/ai-cost-system/test/context-fixture.ts`

**Interfaces:**
- Consumes: parsed `SerenaExcerpt`, trusted routing/config evidence and context policy.
- Produces: `validateContextIntegrity(input): IntegrityResult`, canonical content hashing and normalized project-relative path/range checks.

- [ ] **Step 1: Write failing integrity tests**

```ts
it.each(['secret', 'hash-mismatch', 'provenance-mismatch', 'forbidden-sensitive'])(
  'fails closed for %s',
  (scenario) => expect(validateScenario(scenario)).toMatchObject({ status: 'STOP' }),
);

it('accepts only matching redacted Sensitive scope', () => {
  expect(validateContextIntegrity(approvedSensitiveFixture())).toEqual({ status: 'VALID', ... });
});
```

Cover absolute/traversal/backslash paths, invalid/inverted ranges, duplicate IDs,
conflicting overlaps, non-Serena provenance, content hash mismatch, reserved
boundary markers and obvious secret/PII indicators. Confirm outcomes never echo
rejected content.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-integrity.test.ts`

Expected: FAIL because validation is missing.

- [ ] **Step 3: Implement minimal pure integrity validation**

Normalize only documented line endings, compute SHA-256 with existing
`sha256()`, validate evidence hashes and enforce Public/Internal/Sensitive/Secret
rules. Do not add a filesystem or automatic redaction interface.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-integrity.test.ts`

Expected: PASS.

### Task 3: Deterministic diff compactor

**Files:**
- Create: `packages/ai-cost-system/src/diff-compactor.ts`
- Create: `packages/ai-cost-system/test/diff-compactor.test.ts`
- Modify: `packages/ai-cost-system/test/context-fixture.ts`

**Interfaces:**
- Consumes: validated `DiffHunkCandidate[]` and trusted relevant-path scope.
- Produces: `compactDiffHunks(input): DiffCompactionResult` with selected hunks, excluded IDs/reason codes and canonical aggregate hash.

- [ ] **Step 1: Write failing compaction tests**

```ts
it('excludes unrelated paths and emits no unrelated patch content', () => {
  const result = compactDiffHunks(diffFixtureWithUnrelatedFile());
  expect(result.selected_hunks.map((h) => h.path)).toEqual(['packages/ai-cost-system/src/context-builder.ts']);
  expect(canonicalize(result)).not.toContain('apps/web');
});

it('is stable across candidate ordering', () => {
  expect(compactDiffHunks(input)).toEqual(compactDiffHunks(reverse(input)));
});
```

Also cover header/range/hash mismatch, duplicate deduplication and conflicting
coordinate rejection.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/diff-compactor.test.ts`

Expected: FAIL because the compactor is missing.

- [ ] **Step 3: Implement minimal structured-hunk compaction**

Parse only a single unified hunk header, validate metadata, keep meaningful
patch whitespace, deduplicate by canonical hash and sort by path/ranges/hash. Do
not invoke Git or accept an unrestricted multi-file raw diff.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/diff-compactor.test.ts`

Expected: PASS.

### Task 4: Deterministic error compactor

**Files:**
- Create: `packages/ai-cost-system/src/error-compactor.ts`
- Create: `packages/ai-cost-system/test/error-compactor.test.ts`

**Interfaces:**
- Consumes: bounded structured `DiagnosticCandidate[]` and allowlisted command IDs.
- Produces: `compactErrors(input): ErrorCompactionResult` with normalized diagnostics and SHA-256 fingerprints.

- [ ] **Step 1: Write failing normalization tests**

```ts
it('removes ANSI, timestamps, random IDs, temporary paths and repeated frames', () => {
  const result = compactErrors(noisyDiagnosticFixture());
  expect(result.diagnostics[0]).toMatchSnapshot();
  expect(canonicalize(result)).not.toMatch(/\u001b|2026-08-09|[0-9a-f]{8}-/i);
});

it('produces the same fingerprint for equivalent noise', () => {
  expect(fingerprint(noiseA)).toBe(fingerprint(noiseB));
});
```

Cover unknown command IDs, oversized fields, Secret/Sensitive denial and no raw
log field.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/error-compactor.test.ts`

Expected: FAIL because normalization is missing.

- [ ] **Step 3: Implement minimal bounded normalization**

Use deterministic regex transforms with no timestamps or randomness in output,
deduplicate frames while preserving first-seen semantic order, then fingerprint
canonical structured fields. Never persist or return the original candidate.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/error-compactor.test.ts`

Expected: PASS.

### Task 5: Fixed prompt renderer and output contract

**Files:**
- Create: `packages/ai-cost-system/src/prompt-builder.ts`
- Create: `packages/ai-cost-system/test/prompt-builder.test.ts`
- Modify: `packages/ai-cost-system/test/context-fixture.ts`

**Interfaces:**
- Consumes: a validated immutable ContextManifest and trusted verification-command IDs.
- Produces: `renderPrompt(manifest, commandIds): { prompt: string; prompt_hash: string; prompt_bytes: number }` and strict model-output parsing.

- [ ] **Step 1: Write failing renderer tests**

Verify exact fixed section order, canonical JSON, explicit trusted/untrusted
boundaries, rejection of boundary markers, identical hashes for identical
manifests, changed hashes for task/context/diff/error/policy/config/prompt-version
changes and absence of full AGENTS/policy or arbitrary command channels.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/prompt-builder.test.ts`

Expected: FAIL because the renderer is missing.

- [ ] **Step 3: Implement the fixed renderer**

Render the eleven approved sections only. Use stable boundary constants and
canonical JSON. Label every source/diff/diagnostic block as untrusted evidence.
Compute exact UTF-8 bytes with `Buffer.byteLength()` and SHA-256 over final
prompt bytes.

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/prompt-builder.test.ts`

Expected: PASS.

### Task 6: Context coordinator, pruning and immutable manifest

**Files:**
- Create: `packages/ai-cost-system/src/context-builder.ts`
- Create: `packages/ai-cost-system/test/context-builder.test.ts`
- Modify: `packages/ai-cost-system/src/index.ts`
- Modify: `packages/ai-cost-system/test/context-fixture.ts`

**Interfaces:**
- Consumes: unknown `ContextBuildInput` through strict parsing and Tasks 1–5 pure functions.
- Produces: `ContextBuilder.build(input: unknown): ContextBuildOutcome` and public Phase 3E exports.

- [ ] **Step 1: Write failing coordinator tests**

Cover:

- filesystem/repository reader cannot be injected or represented by schema;
- symbol excerpt preferred over equivalent whole-range candidate;
- deterministic lossless compaction precedes pruning;
- non-critical items prune in stable lowest-value-first order;
- critical content is byte-for-byte preserved or no prompt is returned;
- both overflow actions and missing/invalid action;
- unconditional STOP for Secret, forbidden Sensitive, provenance/hash/integrity failure;
- previous raw prompt/output and full policy fields rejected;
- identical valid inputs produce identical manifest/prompt hashes;
- every required semantic input change changes the correct hash;
- returned manifest and nested collections are immutable.

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-builder.test.ts`

Expected: FAIL because the coordinator is missing.

- [ ] **Step 3: Implement minimal coordinator**

Parse unknown input fail-closed, validate integrity, compact diff/errors, create a
candidate manifest, render and measure, then prune only non-critical candidates
until within the ceiling. Rebuild hashes after each deterministic selection.
Return no prompt for STOP/APPROVAL_REQUIRED. Deep-freeze successful manifests
and outcomes.

- [ ] **Step 4: Run GREEN and focused Phase 3E suite**

Run: `pnpm --filter @ikimetr/ai-cost-system exec vitest run test/context-contracts.test.ts test/context-integrity.test.ts test/diff-compactor.test.ts test/error-compactor.test.ts test/prompt-builder.test.ts test/context-builder.test.ts`

Expected: PASS.

### Task 7: Regression, security and full verification

**Files:**
- Modify only Phase 3E files if a failing test proves a defect.

**Interfaces:**
- Consumes: completed Phase 3E implementation.
- Produces: fresh verification evidence and a scope/security report.

- [ ] **Step 1: Run package verification**

```text
pnpm --filter @ikimetr/ai-cost-system test:unit
pnpm --filter @ikimetr/ai-cost-system typecheck
pnpm --filter @ikimetr/ai-cost-system build
pnpm --filter @ikimetr/ai-cost-system validate:config
```

- [ ] **Step 2: Perform security/source review**

Confirm Phase 3E production files contain no filesystem/network/shell/provider
imports or calls; no raw prompt/log/PII/secret persistence; no arbitrary command
field; no hidden truncation; and no config/app/database/migration change.

- [ ] **Step 3: Run full WSL-native verification**

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
git diff --check
```

Use the existing lockfile and existing WSL-native dependencies. Start only the
existing loopback PostgreSQL/Redis compose services under a unique temporary
project, use a temporary bridge only if Docker Desktop requires it, and remove
only those temporary containers/networks/volumes and the verified temporary
copy afterward.

- [ ] **Step 4: Compare against the captured Phase 3E baseline**

Report only the approved created/modified files. Do not alter or overwrite
unrelated Phase 1/3A–3D dirty-state.
