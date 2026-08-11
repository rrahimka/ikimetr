# İkiMetr Spec Kit + Agent Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use
> `superpowers:subagent-driven-development` or `superpowers:executing-plans` and
> execute one atomic task at a time. Stop at every human or fail-closed gate.

**Goal:** Install and initialize a pinned GitHub Spec Kit release without
colliding with existing İkiMetr governance, then add the smallest native
workflow overlay that enforces the approved Agent Loop and proves it with one
documentation pilot and one pure-logic pilot.

**Architecture:** Path A is Spec Kit workflow → active/default Spec Kit coding
agent integration → coding harness. Path B is a routed model/provider operation
→ the existing public `AiExecutor` → existing `CostRouter` → existing
`ExecutionCoordinator`/invokers/providers. `AiExecutor` is not a coding-agent
launcher, and the coding-agent registry never selects a provider or harness.

**Tech stack:** pinned GitHub Spec Kit CLI, WSL Bash, Git, Node 24, pnpm 10,
TypeScript only for bounded project-local guards proven necessary, and the
existing `@ikimetr/ai-cost-system` public surface.

**Approved design:**
[`../specs/2026-08-11-spec-kit-agent-loop-design.md`](../specs/2026-08-11-spec-kit-agent-loop-design.md),
revision 3 at commit `49c166f3d3ffb90519de7e5a90298abe3663a35e`.

**Plan revision:** 4 — final mechanical correction.

---

## Global execution contract

1. Work from repository root in WSL Bash. Run `set -euo pipefail` at the start
   of every shell session.
2. Before every repository mutation, record `TASK_START_COMMIT` with
   `git rev-parse HEAD`, record `git status --porcelain=v1`, and create a
   task-owned pre-change manifest. A task must stop if unrelated changes are
   present.
3. Unknown values are never typed into a later command. The required sequence
   is discover → validate → persist as literal data → load into a Bash array →
   execute with `"${ARGV[@]}"`. Command strings and `eval` are forbidden.
4. An argv artifact contains one literal argument per line. Reject empty first
   arguments, carriage returns, newlines within an argument, NUL bytes, shell
   metacharacter-only arguments, and paths outside the repository or the
   task-owned temporary directory. Load it with `mapfile -t ARGV`.
5. Human decisions are persisted as validated literals. A worker reads the
   answer, checks it against the discovered allowlist, writes the literal, reads
   it back, and revalidates it before any mutation.
6. Every piped verification command uses `set -o pipefail` and captures the
   producer status with `${PIPESTATUS[0]}`. Every executed check participates in
   the final numeric gate.
7. Every proposed commit declares an `AUTHORIZED_FILES` Bash array from task
   design or a previously human-approved task-owned manifest. It never derives
   authorization from the repository-wide diff or untracked-file list.
8. The commit gate is always:

   ```bash
   bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
   git add -- "${AUTHORIZED_FILES[@]}"
   git diff --cached --name-only
   git diff --cached --check
   git diff --cached
   ```

   Compare `git diff --cached --name-only` byte-for-byte with the sorted
   `AUTHORIZED_FILES` list before proposing `git commit`.
9. Rollback is path-scoped and provenance-based. For a new file, confirm it was
   absent in the task-start manifest and its current hash matches the
   task-owned post-change manifest before removing that exact file. For a
   tracked file, confirm its task-start hash equals the blob at
   `TASK_START_COMMIT`, then use exact path-scoped `git restore
   --source="$TASK_START_COMMIT" --worktree -- "$path"`. If any check fails,
   stop for human review.
10. For a Spec Kit-managed integration, use its manifest-aware uninstall only
    when a disposable probe proved the exact uninstall argv removes only that
    integration's manifest-owned files. Otherwise do not invoke uninstall;
    apply the file-level rollback rule above.
11. Never change `AGENTS.md`, `docs/PROJECT_CONSTITUTION.md`, `docs/ai/`,
    `config/ai-cost/`, or `packages/ai-cost-system/` during this plan.
12. No second router, provider fallback, routing retry, provider selection, or
    modification of non-executable `RoutingDecision` behavior is permitted.
13. No custom Agent Loop runtime is permitted unless native capability is
    proven insufficient and a separate ADR is approved. Small validators and
    evidence recorders are guards, not orchestrators.
14. Every task that changes files contains pre-change evidence, exact mutation,
    post-change diff, acceptance, security, scope, rollback, and proposed
    commit sections. Read-only discovery tasks explicitly say that no commit is
    proposed.
15. `verify-exact` means the complete recorded path/state/hash set must match
    byte-for-byte and is mandatory immediately before real init.
    `verify-existing` means every recorded pre-init path/state/hash still
    matches and every added path is present in an explicit, human-approved
    additions allowlist. After init, references to a complete protected check
    mean `verify-existing` with the cumulative approved additions from A4, A7,
    and H2; a new path outside those lists fails.

## Shared verification commands

When a task requires the repository coding gate, execute all five commands and
gate on all five statuses:

```bash
set -o pipefail
pnpm lint 2>&1 | tee /tmp/ikimetr-lint.log; LINT_STATUS=${PIPESTATUS[0]}
pnpm typecheck 2>&1 | tee /tmp/ikimetr-typecheck.log; TYPECHECK_STATUS=${PIPESTATUS[0]}
pnpm test:unit 2>&1 | tee /tmp/ikimetr-unit.log; UNIT_STATUS=${PIPESTATUS[0]}
pnpm test:integration 2>&1 | tee /tmp/ikimetr-integration.log; INTEGRATION_STATUS=${PIPESTATUS[0]}
pnpm build 2>&1 | tee /tmp/ikimetr-build.log; BUILD_STATUS=${PIPESTATUS[0]}
if (( LINT_STATUS != 0 || TYPECHECK_STATUS != 0 || UNIT_STATUS != 0 || INTEGRATION_STATUS != 0 || BUILD_STATUS != 0 )); then
  printf '%s\n' 'BLOCKED: repository verification failed' >&2
  exit 1
fi
```

Raw logs under `/tmp` are transient. Durable evidence records command, UTC
timestamp, exit status, and a short result summary; it never stores prompts,
secrets, credentials, raw environment values, or unnecessary personal data.

---

## Phase A — Pinned Spec Kit foundation and collision-safe initialization

### Task A0: Fresh baseline and fixed secret-scanner gate

**Phase:** A

**Goal:** Prove the current repository baseline and install a pinned scanner,
then generate one fixed project-local wrapper before the first commit.

**Why:** Every later commit must have a real secret gate. Scanner command-line
arguments cannot be guessed before a candidate is selected and inspected.

**Files:** Create
`docs/superpowers/plans/artifacts/phase-a0-baseline.md`,
`docs/superpowers/plans/artifacts/phase-a0-scanner-selection.md`,
`docs/superpowers/plans/artifacts/phase-a0-scanner.env`,
`tools/secret-scanner/generate-wrapper.sh`, and
`tools/secret-scanner/scan.sh`. Production files are read-only.

**Interfaces:** Produces a fixed `scan.sh` accepting `--` followed by one or
more exact regular-file paths. A finding or scanner failure returns nonzero.

**Preconditions:** WSL reports Linux on `x86_64`; `uv`, `gh`, `tar`,
`sha256sum`, Git, Node, and pnpm are already available. Missing tools cause
`BLOCKED_ENVIRONMENT`; this task installs none of those prerequisites.

**PRE-CHANGE EVIDENCE:** Run and retain the output in `/tmp/a0-start.txt`:

```bash
set -euo pipefail
git branch --show-current
git rev-parse HEAD
git status --porcelain=v1
uname -s
uname -m
gh --version
uv --version
node --version
pnpm --version
```

- [ ] Run the five shared verification commands. Record every exit status,
  including `INTEGRATION_STATUS`, in the baseline artifact. Do not continue if
  any status is nonzero.
- [ ] Evaluate `gitleaks/gitleaks`, `Yelp/detect-secrets`,
  `trufflesecurity/trufflehog`, and `secretlint/secretlint` by querying each
  repository's latest non-draft release with `gh api`. Record repository,
  release tag, publication timestamp, WSL installation form, pinning method,
  and whether a standalone Linux x64 asset exists.
- [ ] Apply this deterministic selection rule: select `gitleaks/gitleaks` only
  when its latest release tag matches `^v[0-9]+\.[0-9]+\.[0-9]+$` and exactly
  one asset matches the selected version's Linux x64 tarball name. If the rule
  fails, stop with `BLOCKED_SECURITY`; do not silently choose another CLI.
- [ ] Persist the selected repository, exact tag, exact asset name, asset URL,
  and published timestamp before downloading. Validate the persisted values by
  reading them back and calling `gh release view` for the exact tag.
- [ ] Download only the selected asset into a directory created by
  `mktemp -d /tmp/ikimetr-gitleaks-XXXXXXXX`. Verify the resolved directory
  matches `/tmp/ikimetr-gitleaks-` plus the generated suffix and is not `/tmp`
  before extracting or later removing it.
- [ ] After loading and validating the persisted literal values, download,
  extract, and install with direct argv:

  ```bash
  SCANNER_TMP="$(mktemp -d /tmp/ikimetr-gitleaks-XXXXXXXX)"
  scanner_tmp_real="$(realpath "$SCANNER_TMP")"
  [[ "$scanner_tmp_real" == /tmp/ikimetr-gitleaks-* ]] || exit 1
  [[ "$scanner_tmp_real" != /tmp ]] || exit 1
  gh release download "$SCANNER_TAG" --repo "$SCANNER_REPOSITORY" --pattern "$SCANNER_ASSET" --dir "$scanner_tmp_real"
  tar -xzf "$scanner_tmp_real/$SCANNER_ASSET" -C "$scanner_tmp_real"
  test -f "$scanner_tmp_real/gitleaks"
  SCANNER_PATH="$(uv tool dir --bin)/gitleaks-${SCANNER_TAG}"
  test ! -e "$SCANNER_PATH" || test "$(sha256sum "$SCANNER_PATH" | awk '{print $1}')" = "$(sha256sum "$scanner_tmp_real/gitleaks" | awk '{print $1}')"
  install -m 0755 "$scanner_tmp_real/gitleaks" "$SCANNER_PATH"
  test -x "$SCANNER_PATH"
  test ! -L "$scanner_tmp_real"
  rm -rf -- "$scanner_tmp_real"
  ```
- [ ] Install the extracted binary as
  `$(uv tool dir --bin)/gitleaks-${SCANNER_TAG}` after confirming `uv tool dir
  --bin` returns an existing user-writable directory. Record its absolute path
  and SHA-256. Do not overwrite an existing path unless its hash is identical.
- [ ] Only after selection and pinning, inspect the real CLI:

  ```bash
  "$SCANNER_PATH" version
  "$SCANNER_PATH" dir --help 2>&1 | tee /tmp/a0-gitleaks-dir-help.txt
  SCANNER_HELP_STATUS=${PIPESTATUS[0]}
  test "$SCANNER_HELP_STATUS" -eq 0
  ```

  Confirm the pinned CLI supports a literal file source, JSON report output,
  redaction, a report path, no banner, no color, and the `--` separator. Persist
  those confirmed fixed arguments in `phase-a0-scanner.env`.
- [ ] Create `generate-wrapper.sh` with this exact contract: parse the env file
  as data without `source`; validate `SCANNER_KIND=gitleaks`, the semver tag,
  absolute binary path, and stored hash; verify the live binary hash; then
  generate `scan.sh` containing the absolute binary path and the fixed argv
  `dir`, `--no-banner`, `--no-color`, `--redact`, `--report-format json`, and a
  per-invocation `--report-path`. It must invoke the binary directly, never via
  a command string.
- [ ] `scan.sh` must require at least one file, consume an optional first `--`,
  reject nonexistent paths and non-regular files, create a private report with
  `mktemp`, scan each path separately, remove only that report in a trap, return
  1 for findings, and propagate every other scanner failure.
- [ ] Generate the wrapper and run three gates:

  ```bash
  printf '%s\n' 'const value = 1;' > /tmp/a0-clean.txt
  printf 'token=ghp_%036d\n' 0 > /tmp/a0-fake-secret.txt
  bash tools/secret-scanner/scan.sh -- /tmp/a0-clean.txt
  if bash tools/secret-scanner/scan.sh -- /tmp/a0-fake-secret.txt; then
    printf '%s\n' 'BLOCKED: fake secret was not detected' >&2
    exit 1
  fi
  bash tools/secret-scanner/scan.sh -- tools/secret-scanner/generate-wrapper.sh tools/secret-scanner/scan.sh
  rm -f -- /tmp/a0-clean.txt /tmp/a0-fake-secret.txt
  ```

**EXACT MUTATION:** The five repository files listed above plus one pinned
external binary at the validated absolute user-tool path.

**POST-CHANGE DIFF:** `git status --short` must contain only the five repository
paths listed above.

**ACCEPTANCE CHECK:** All five baseline commands passed; the selected release
and binary hash are literal and pinned; the clean fixture and wrapper scan pass;
the fake secret is rejected.

**SECURITY CHECK:** The report is private and transient, output is redacted,
fixtures are synthetic, and later gates invoke only `scan.sh`.

**SCOPE CHECK:** Compare `git status --short` with the five declared paths. Any
other change stops the task.

**ROLLBACK POINT:** Remove each new repository file only after its hash matches
the task-owned post-change manifest. Remove the exact external binary only when
its path and hash match `phase-a0-scanner.env`; never remove its parent.

**PROPOSED COMMIT:** After scanner validation:

```bash
AUTHORIZED_FILES=(
  "docs/superpowers/plans/artifacts/phase-a0-baseline.md"
  "docs/superpowers/plans/artifacts/phase-a0-scanner-selection.md"
  "docs/superpowers/plans/artifacts/phase-a0-scanner.env"
  "tools/secret-scanner/generate-wrapper.sh"
  "tools/secret-scanner/scan.sh"
)
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "chore: establish baseline and pinned secret scan gate"
```

---

### Task A1: Resolve and install the exact stable Spec Kit release

**Phase:** A

**Goal:** Resolve the latest stable `github/spec-kit` release automatically,
persist its exact semver tag, and install only that tag.

**Why:** Init and integration behavior must be tied to one inspectable version.

**Files:** Create
`docs/superpowers/plans/artifacts/phase-a1-spec-kit-release.env` and
`docs/superpowers/plans/artifacts/phase-a1-install.md`. Repository code and
configuration remain unchanged.

**Interfaces:** Produces validated `SPEC_KIT_TAG`, `SPEC_KIT_VERSION`, and the
literal `SPECIFY_BINARY` path.

**Preconditions:** A0 committed; `uv` and authenticated or public `gh` access
work; the repository is otherwise clean.

**PRE-CHANGE EVIDENCE:** Record task-start commit/status and output of
`command -v specify || true`, `uv tool list`, and `uv --version`.

- [ ] Resolve and validate the release without human substitution:

  ```bash
  set -euo pipefail
  SPEC_KIT_TAG="$(gh api repos/github/spec-kit/releases/latest --jq '.tag_name')"
  [[ "$SPEC_KIT_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
  SPEC_KIT_VERSION="${SPEC_KIT_TAG#v}"
  gh release view "$SPEC_KIT_TAG" --repo github/spec-kit --json tagName,isDraft,isPrerelease,publishedAt
  ```

- [ ] Persist the tag/version, read them back, revalidate semver, and confirm the
  viewed release is neither draft nor prerelease.
- [ ] If `specify` already exists, record its absolute path, owning `uv` package,
  and version. If it is not the pinned `specify-cli` version, stop for human
  environment remediation; do not uninstall or overwrite an unknown tool.
- [ ] If absent, install the exact Git tag:

  ```bash
  uv tool install specify-cli --from "git+https://github.com/github/spec-kit.git@${SPEC_KIT_TAG}"
  ```

- [ ] Persist `SPECIFY_BINARY="$(command -v specify)"`, require an absolute
  executable path, run its version/check commands shown by top-level help, and
  confirm the reported version contains `SPEC_KIT_VERSION` as a complete
  version token.

**EXACT MUTATION:** Two evidence files plus an external pinned `uv` tool when it
was absent.

**POST-CHANGE DIFF:** Only the two evidence files are present in repository
status.

**ACCEPTANCE CHECK:** Exact stable tag resolved by `gh`, semver validated,
release re-read, pinned CLI path/version recorded, health check exits zero.

**SECURITY CHECK:** No tokens or raw environment values are written; GitHub
metadata only.

**SCOPE CHECK:** Repository code/configuration unchanged.

**ROLLBACK POINT:** Evidence files are path-scoped. If this task installed the
tool, uninstall only `specify-cli` after `uv tool list` proves the task-owned
pinned version; otherwise stop.

**PROPOSED COMMIT:** Exact files only:

```bash
AUTHORIZED_FILES=(
  "docs/superpowers/plans/artifacts/phase-a1-spec-kit-release.env"
  "docs/superpowers/plans/artifacts/phase-a1-install.md"
)
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: pin stable Spec Kit release"
```

---

### Task A2: Disposable per-integration probes and argv persistence

**Phase:** A

**Goal:** Discover real init/integration/workflow mechanics from the pinned CLI
in isolated projects and persist exact argv for later tasks.

**Why:** Generic and native integrations may require different init arguments,
and project-local integration commands may reject an uninitialized repository.

**Files:** Create `docs/superpowers/plans/artifacts/phase-a2-probes.md`,
`docs/superpowers/plans/artifacts/phase-a2-integration-keys.txt`,
`docs/superpowers/plans/artifacts/phase-a2-owned-files.txt`, and argv/file
inventories under `docs/superpowers/plans/artifacts/phase-a2-probes/`.

**Interfaces:** For each confirmed integration, produces `init.argv`,
`status.argv`, `install.argv`, `use.argv`, and `uninstall.argv`; unsupported
operations contain the single literal `NONE`. Also records whether uninstall
was proven manifest-safe.

**Preconditions:** A1 complete; pinned binary path loaded and revalidated.

**PRE-CHANGE EVIDENCE:** Task-start commit/status; hashes of A1 env file and
pinned binary.

- [ ] Run only global help before initialization and capture producer statuses:

  ```bash
  set -o pipefail
  "$SPECIFY_BINARY" --help 2>&1 | tee /tmp/a2-top-help.txt; TOP_STATUS=${PIPESTATUS[0]}
  "$SPECIFY_BINARY" init --help 2>&1 | tee /tmp/a2-init-help.txt; INIT_HELP_STATUS=${PIPESTATUS[0]}
  if (( TOP_STATUS != 0 || INIT_HELP_STATUS != 0 )); then exit 1; fi
  ```

- [ ] From the actual help, persist literal supported integration keys. For each
  key, create `init.argv` with one argument per line. It must start with the
  pinned absolute binary and `init`, target the current empty directory, select
  exactly that integration, and use shell type `sh` only when the pinned help
  supports it.
- [ ] If generic init requires a commands directory or integration options,
  persist a relative path `.ikimetr-generic-commands` in generic `init.argv` and
  create that directory plus the minimum valid command fixture inside only the
  generic probe. Native argv files must not receive generic-only arguments.
- [ ] Validate each argv file as data, then create a separate directory with
  `mktemp -d /tmp/ikimetr-spec-kit-probe-${key}-XXXXXXXX`, initialize Git there,
  and execute `"${INIT_ARGV[@]}"`. No two integrations share a probe.
- [ ] Inside each initialized probe, inspect the pinned CLI's actual help and
  persist exact status/install/use/uninstall argv. Execute status read-only.
  Install/use/uninstall may be exercised only against a second throwaway clone
  of that integration probe so the base probe remains evidence.
- [ ] Record pre/post file inventories and SHA-256 hashes for init, install, use,
  and uninstall. Set `UNINSTALL_MANIFEST_SAFE=true` only when uninstall removes
  exactly the files it installed and changes no pre-existing/shared file.
- [ ] Discover the actual workflow mechanism from help and generated files.
  Record command namespace, project paths, and whether run/status/resume,
  human gates, conditions, persistence, overlays, and validation are confirmed.
- [ ] Before deleting any probe, run:

  ```bash
  probe_real="$(realpath "$PROBE_DIR")"
  [[ "$probe_real" == /tmp/ikimetr-spec-kit-probe-* ]] || exit 1
  [[ "$probe_real" != /tmp ]] || exit 1
  test -d "$probe_real"
  test ! -L "$probe_real"
  rm -rf -- "$probe_real"
  ```

  Use the corresponding task-owned prefix for secondary probes and repeat all
  checks. Never delete a project path.

**EXACT MUTATION:** Durable probe summary, keys/owned manifests, and literal
per-integration artifacts; all probe projects/logs remain under validated
`/tmp` paths.

**POST-CHANGE DIFF:** Only `phase-a2-probes.md`, the keys file, and files below
the declared A2 artifact directory, plus the exact A2 owned manifest.

**ACCEPTANCE CHECK:** Separate successful init probe for every persisted key;
generic arguments proven independently; every later operation has exact argv or
literal `NONE`; cleanup checks passed.

**SECURITY CHECK:** No command-string execution, no project-local pre-init
integration command, no secret material, no deletion outside validated probes.

**SCOPE CHECK:** Compare status with the explicit A2 artifact prefix and three
top-level files.

**ROLLBACK POINT:** Remove only A2 evidence paths after task-owned hash checks.

**PROPOSED COMMIT:** Build authorization from the A2 task-owned evidence
manifest created before the first A2 file write, then load it:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-a2-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: record pinned Spec Kit disposable probes"
```

---

### Task A3: Protected manifest, init allowlist, and literal human gate

**Phase:** A

**Goal:** Snapshot every protected pre-init file, approve the exact init path
allowlist, and persist the selected default integration and force decision.

**Why:** Real init must be preceded by a complete fail-closed manifest check,
not three spot checks.

**Files:** Create `tools/spec-kit/protected-manifest.mjs`,
`docs/superpowers/plans/artifacts/phase-a3-protected.json`,
`phase-a3-init-authorized-paths.txt`, `phase-a3-human-decision.env`, and
`phase-a3-gate.md` in the artifacts directory.

**Interfaces:** `protected-manifest.mjs snapshot OUTPUT` records the baseline;
`verify-exact MANIFEST` returns zero only for an identical path, presence,
tracked-state, and SHA-256 set; `verify-existing MANIFEST ALLOWLIST` returns
zero only when every baseline record is unchanged and every added path is in
the literal approved allowlist.

**Preconditions:** A2 committed; clean worktree; human can review probe summary.

**PRE-CHANGE EVIDENCE:** Task-start commit/status and scanner pass over A2
evidence.

- [ ] Implement the manifest tool with Node standard library only. Its fixed
  protected files are `AGENTS.md`, `CLAUDE.md`, `QWEN.md`, `CODEX.md`,
  `docs/PROJECT_CONSTITUTION.md`, `package.json`, `pnpm-workspace.yaml`,
  `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`,
  `vitest.integration.config.ts`, `eslint.config.js`, `prettier.config.js`,
  `.gitignore`, `.env.example`, `.node-version`, and `.npmrc`. Its fixed
  protected directories are `docs/ai`, `docs/superpowers/specs`,
  `docs/superpowers/plans` excluding `artifacts`, `config/ai-cost`,
  `packages/ai-cost-system`, `.agents`, `.claude`, `.serena`, and `.playwright`.
  Exclude `.git`, dependency trees, build output, caches, and coverage.
- [ ] Snapshot sorted records containing normalized relative path, state
  `FILE` or `ABSENT`, tracked state, and SHA-256. Reject tabs/newlines in paths.
  `verify-exact` recomputes to a private temp file and uses byte comparison;
  changed, added, removed, or tracking-state changes fail. `verify-existing`
  checks every baseline record, then rejects each added path absent from its
  normalized allowlist.
- [ ] Test the helper in a task-owned temp fixture: initial verify passes;
  content change and file removal fail; unapproved addition fails; the same
  addition passes only when its exact path is in the test allowlist. Remove
  only the validated fixture directory.
- [ ] Create the real protected manifest after the helper tests.
- [ ] Derive the candidate init paths only from the selected integration's A2
  probe inventory, not from current repository changes. Normalize/sort, reject
  absolute paths and parent traversal, and present every path to the human.
- [ ] Read the human-selected integration and require an exact line match in
  `phase-a2-integration-keys.txt`. Read force approval and accept only `true` or
  `false`. Read path approval and require literal `true`; otherwise stop.
- [ ] Persist and read back five fields: `DEFAULT_INTEGRATION` contains the
  validated literal key; `FORCE_APPROVED` contains exactly `true` or `false`;
  `SCRIPT_TYPE` contains `sh`; `INIT_PATHS_APPROVED` contains `true`; and
  `APPROVED_AT` contains the actual ISO-8601 UTC timestamp. Reject explanatory
  prose, empty values, and duplicate keys in the artifact.

**EXACT MUTATION:** Manifest helper and four named evidence/decision files.

**POST-CHANGE DIFF:** Only those exact files.

**ACCEPTANCE CHECK:** Complete protected manifest verifies; every candidate init
path came from the selected disposable probe; decision values revalidate.

**SECURITY CHECK:** No protected source content is copied into the decision;
hash evidence contains no secret values.

**SCOPE CHECK:** Exact five-file comparison.

**ROLLBACK POINT:** Remove only the five task-owned files after hashes match.

**PROPOSED COMMIT:** Exact array:

```bash
AUTHORIZED_FILES=(
  "tools/spec-kit/protected-manifest.mjs"
  "docs/superpowers/plans/artifacts/phase-a3-protected.json"
  "docs/superpowers/plans/artifacts/phase-a3-init-authorized-paths.txt"
  "docs/superpowers/plans/artifacts/phase-a3-human-decision.env"
  "docs/superpowers/plans/artifacts/phase-a3-gate.md"
)
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: approve complete pre-init safety manifest"
```

---

### Task A4: One bounded real initialization

**Phase:** A

**Goal:** Execute one pinned `specify init` using the human-approved integration
and the exact probed argv.

**Why:** This is the first real repository mutation by Spec Kit and must fail
before mutation on any protected mismatch.

**Files:** Spec Kit may create/modify only paths in
`phase-a3-init-authorized-paths.txt`. Create
`phase-a4-task-start.json`, `phase-a4-owned-files.txt`, and
`phase-a4-post-init.md` under the artifacts directory.

**Interfaces:** Consumes A2 argv and A3 literals/manifest; produces an exact
task-owned file manifest for A5.

**Preconditions:** A3 committed; worktree clean; pinned CLI hash valid.

**PRE-CHANGE EVIDENCE:** Record task-start commit/status and pre-state/hash for
every A3-authorized path. Load and validate decision values and init argv.

- [ ] Verify init argv begins with the pinned binary and `init`, selects exactly
  `DEFAULT_INTEGRATION`, and contains no path outside repository root.
- [ ] Immediately before init, with no intervening repository write, run:

  ```bash
  node tools/spec-kit/protected-manifest.mjs verify-exact docs/superpowers/plans/artifacts/phase-a3-protected.json
  ```

  Any mismatch stops before init.
- [ ] Load exact argv. If `FORCE_APPROVED=false`, reject an argv containing
  `--force`. If true and the probed real-init argv omits it, insert the single
  literal `--force` adjacent to the confirmed init options. Execute the array
  directly: `"${INIT_ARGV[@]}"`.
- [ ] Capture status/diff/untracked output for evidence only. Iterate the
  preapproved A3 path list, compare each path with its task-start state, and
  write changed approved paths to `phase-a4-owned-files.txt`. Add the three A4
  artifact paths explicitly.
- [ ] Independently compare all repository status paths with the task-start
  status plus the exact owned list. If an unexpected path exists, stop; do not
  add it to the owned list and do not rollback automatically.

**EXACT MUTATION:** One init invocation plus three A4 artifacts.

**POST-CHANGE DIFF:** Every changed path is in the human-approved A3 list or is
one of the three exact A4 artifacts.

**ACCEPTANCE CHECK:** Init exits zero; expected foundation exists; complete
unexpected-path check is empty.

**SECURITY CHECK:** Run `verify-existing` with
`phase-a3-init-authorized-paths.txt`. Any changed/missing baseline record or
unapproved addition is `BLOCKED_SECURITY` and prevents staging.

**SCOPE CHECK:** Byte-compare sorted status paths against task-start paths plus
the A4-owned list.

**ROLLBACK POINT:** No automatic action on unexpected paths. For proven owned
paths only, use the global path-scoped rollback. A manifest-aware uninstall is
permitted only if A2 marked the selected integration safe and exact uninstall
argv is loaded and revalidated.

**PROPOSED COMMIT:** None. A5 audits first.

---

### Task A5: Collision audit and exact init commit

**Phase:** A

**Goal:** Prove init preserved every protected file and commit only approved
init output plus its audit.

**Why:** Successful CLI exit is not collision evidence.

**Files:** Create
`docs/superpowers/plans/artifacts/phase-a5-collision-audit.md`; read A2–A4
manifests and all A4-owned files.

**Interfaces:** Produces verdict `CLEAN` or a terminal blocked result.

**Preconditions:** A4 completed without unexpected paths.

**PRE-CHANGE EVIDENCE:** A4 task-start/post-init evidence and exact owned list.

- [ ] Run `verify-existing` against every A3 baseline record and the exact A3
  init allowlist; do not exempt a baseline record or approve a path after init.
- [ ] Compare actual A4-owned files with the selected integration's probe
  inventory and human-approved path list. Classify every path as expected new,
  expected modified, or unexpected.
- [ ] Verify pre-existing agent skills byte-for-byte; verify `AGENTS.md`, the
  canonical constitution, `docs/ai`, `config/ai-cost`, and
  `packages/ai-cost-system` are unchanged.
- [ ] Write the audit with counts, exact paths, hashes, and `CLEAN` only when no
  unexpected or protected change exists.

**EXACT MUTATION:** One audit file.

**POST-CHANGE DIFF:** A4 owned paths plus the A5 audit only.

**ACCEPTANCE CHECK:** Complete manifest pass and `CLEAN` verdict.

**SECURITY CHECK:** Scan every A4-owned regular file and the audit; fail closed
on unsupported/binary content until human review.

**SCOPE CHECK:** Authorization is the already approved A4-owned manifest plus
the literal audit path; it is not reconstructed from current status.

**ROLLBACK POINT:** Apply A4's exact provenance rules. Do not touch unrelated
paths.

**PROPOSED COMMIT:** Load the prior approved manifest and append only the audit:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-a4-owned-files.txt
AUTHORIZED_FILES+=("docs/superpowers/plans/artifacts/phase-a5-collision-audit.md")
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "chore: initialize pinned Spec Kit with clean collision audit"
```

---

### Task A6: Canonical constitution mirror and fail-closed guard

**Phase:** A

**Goal:** Create a derived Spec Kit mirror whose metadata and body are checked
against the unchanged canonical constitution.

**Why:** Tests must detect canonical changes, mirror-body changes, and metadata
mismatches without ever editing the real canonical source.

**Files:** Create `.specify/memory/constitution.md`,
`tools/constitution-sync.sh`, and
`docs/superpowers/plans/artifacts/phase-a6-constitution.md`. The canonical file
is read-only.

**Interfaces:** `constitution-sync.sh CANONICAL MIRROR` returns zero only when
line 1 and line 5 are `---`, metadata has exactly one canonical source, one
SHA-256, one UTC timestamp, the source literal is
`docs/PROJECT_CONSTITUTION.md`, the hash equals the live canonical hash, and
mirror content from line 6 onward is byte-identical to canonical content.

**Preconditions:** A5 committed and clean; `.specify/memory` location confirmed
by A2.

**PRE-CHANGE EVIDENCE:** Task-start state and hash of canonical; pre-state/hash
of mirror if init created it.

- [ ] Generate the mirror with five metadata lines followed immediately by the
  canonical bytes. The metadata fields are `canonical_source`,
  `canonical_sha256`, and `synchronized_at`.
- [ ] Implement the guard with `sha256sum`, exact metadata cardinality checks,
  ISO timestamp validation, a private temp file, `tail -n +6`, and `cmp -s`.
  It never rewrites either input.
- [ ] Test only fixture copies in a validated task-owned temp directory:
  unchanged fixtures pass; appended canonical content fails; appended mirror
  body fails; changed source metadata fails; changed hash metadata fails;
  duplicate metadata fails. Confirm the real canonical hash still equals the
  pre-change hash.
- [ ] Run the guard on the real canonical and mirror.

**EXACT MUTATION:** Three declared files; no canonical modification.

**POST-CHANGE DIFF:** Only mirror, guard, and evidence.

**ACCEPTANCE CHECK:** All six fixture cases have expected outcomes and real
guard passes.

**SECURITY CHECK:** Canonical is read-only; no test command targets it for
writing; metadata cannot override source authority.

**SCOPE CHECK:** Exact three paths and unchanged canonical hash.

**ROLLBACK POINT:** If the mirror existed at task start, restore that exact path
from the recorded task-start blob after provenance checks. Otherwise remove the
exact new mirror. Remove the two other new files after hash checks.

**PROPOSED COMMIT:** Exact array:

```bash
AUTHORIZED_FILES=(
  ".specify/memory/constitution.md"
  "tools/constitution-sync.sh"
  "docs/superpowers/plans/artifacts/phase-a6-constitution.md"
)
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: add derived constitution mirror guard"
```

---

### Task A7: Additional integration gate and bounded mutations

**Phase:** A

**Goal:** Install only demonstrably needed additional integrations and change
the default only when it differs and a human explicitly approves the refresh.

**Why:** Integration install and use can mutate shared managed artifacts.

**Files:** Create `phase-a7-approved-integrations.txt`,
`phase-a7-decision.env`, per-integration pre/post/owned manifests,
`phase-a7-owned-files.txt`, and `phase-a7-audit.md` under the artifacts
directory; modify only human-approved probe-predicted integration paths.

**Interfaces:** Consumes exact A2 install/status/use/uninstall argv and safety
evidence.

**Preconditions:** A6 committed; the real project is now initialized; A2
recorded a supported integration mechanism rather than `NONE`.

**PRE-CHANGE EVIDENCE:** Task-start commit/status, full protected verification,
current integration status through the exact A2 status argv, and hash manifests
of every shared path predicted by A2.

- [ ] Present installed integrations and a business need for each proposed new
  integration. Persist only human-approved keys, one exact allowlisted key per
  line. An empty file means no installs.
- [ ] For each approved key, load its exact `install.argv`, require it is not
  `NONE`, validate the pinned binary and key, verify the full protected
  manifest, execute the array once, and compute owned paths only by iterating
  that key's human-approved probe path list. Any other status path stops.
- [ ] Re-run full protected and per-shared-path manifests after each install.
- [ ] Query current default with the exact status argv. If it already equals
  the A3 human selection, persist `USE_REQUIRED=false` and do not execute use.
  If different, read human approval and persist literal `USE_APPROVED=true` or
  `false`. Execute exact use argv only when both `USE_REQUIRED=true` and
  `USE_APPROVED=true`; capture complete pre/post shared manifests and reject an
  unexpected path.
- [ ] For rollback, execute exact manifest-aware uninstall only for a key whose
  A2 evidence says `UNINSTALL_MANIFEST_SAFE=true` and whose current owned hashes
  match. Otherwise use only path-level provenance rules.

**EXACT MUTATION:** Human-approved integration-managed paths and named A7
evidence files.

**POST-CHANGE DIFF:** Exact union of per-key approved owned manifests and named
evidence files.

**ACCEPTANCE CHECK:** Each install/status/use command came from pinned probe
argv; protected files unchanged; default refresh ran only when required and
approved.

**SECURITY CHECK:** No speculative agent, no profile-granted permission, no
command string, no unsafe uninstall.

**SCOPE CHECK:** Compare status to task-start plus approved per-key manifests.

**ROLLBACK POINT:** Per-key manifest-aware uninstall only when proven safe;
otherwise exact file provenance rollback.

**PROPOSED COMMIT:** `phase-a7-owned-files.txt` is built before staging from the
human-approved per-key path lists plus the four fixed A7 evidence paths:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-a7-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "chore: add approved Spec Kit integrations"
```

---

### Task A8: Phase A verification and checkpoint

**Phase:** A

**Goal:** Verify foundation, integrations, constitution, scanner, protected
paths, and repository health before Phase B.

**Why:** Phase A mutates workflow infrastructure and needs fresh evidence.

**Files:** Create `phase-a8-verification.md` and `phase-a8-checkpoint.md` under
the artifacts directory.

**Interfaces:** Produces the Phase A gate consumed by B1.

**Preconditions:** A0–A7 complete; worktree clean.

**PRE-CHANGE EVIDENCE:** Task-start commit/status and all Phase A task manifests.

- [ ] Run real constitution guard and complete protected verifier.
- [ ] Revalidate pinned scanner binary hash and pinned Spec Kit binary/version.
- [ ] Load every Phase A owned-file manifest, reject duplicates or paths not
  approved by their originating task, and scan every regular file.
- [ ] Execute all five shared verification commands. Integration status is
  mandatory and participates in the numeric gate.
- [ ] Run the exact pinned workflow/integration status commands that A2 marked
  supported; record `NOT_APPLICABLE` with the A2 reason for absent mechanisms.
- [ ] Write command/status summaries and checkpoint commit range.

**EXACT MUTATION:** Two evidence files.

**POST-CHANGE DIFF:** Exact two files.

**ACCEPTANCE CHECK:** All applicable Phase A gates pass with fresh output.

**SECURITY CHECK:** Scanner and canonical guard pass; protected manifest exact.

**SCOPE CHECK:** Exact two paths.

**ROLLBACK POINT:** Remove only the two new files after hash checks.

**PROPOSED COMMIT:** Exact array:

```bash
AUTHORIZED_FILES=(
  "docs/superpowers/plans/artifacts/phase-a8-verification.md"
  "docs/superpowers/plans/artifacts/phase-a8-checkpoint.md"
)
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: verify Spec Kit foundation checkpoint"
```

---

## Phase B — Installed-version Task Contract and capability metadata

### Task B1: Discover real task artifacts and define the İkiMetr extension

**Phase:** B

**Goal:** Map the pinned Spec Kit's actual task representation before creating
the canonical Task Contract schema.

**Why:** Native field names and formats are version-specific; missing İkiMetr
fields are extensions rather than guessed native properties.

**Files:** Create `docs/superpowers/schemas/task-contract.schema.json`,
`phase-b1-native-task-format.md`, `phase-b1-field-map.json`, and
`phase-b1-owned-files.txt` under the artifacts directory.

**Interfaces:** Each design §8 field is classified `NATIVE` with exact source
path/key or `IKIMETR_EXTENSION` with no invented Spec Kit key.

**Preconditions:** A8 checkpoint; pinned version and real task mechanism known.

**PRE-CHANGE EVIDENCE:** Task-start status and A2/A8 mechanism hashes.

- [ ] Use the exact installed-version help/argv to create one synthetic task in
  a disposable initialized project. Capture the source file, serialized format,
  task ID, description, dependencies, status, and acceptance fields actually
  produced. Remove the probe only after strict `/tmp` ownership checks.
- [ ] Persist `TASK_ARTIFACT_FORMAT`, `TASK_SOURCE_PATH`, `TASK_CREATE_MODE`, and
  exact create/validate argv artifacts. Use literal `NONE` for unsupported
  commands.
- [ ] Create the field map for every approved design field. Never label a field
  native without the exact observed source key and sample path.
- [ ] Create a strict JSON Schema containing the design's schema version,
  identity/references, dependencies, allowed/forbidden scope, acceptance,
  security/risk/task class, required tests, routing constraints, budget
  ceilings, one initial implementation plus two correction cycles, previous
  failure evidence, environment requirements, and READY status. Descriptions
  mark `routing_hint` non-authoritative and all budget/data/risk/capability
  fields hard constraints.
- [ ] Validate JSON parsing and assert exact required keys with a fixed Node
  script invoked from `node -e`; validate the synthetic mapped task and reject
  missing scope, unknown properties, secret data routing, and correction limits
  above two.

**EXACT MUTATION:** Four declared files.

**POST-CHANGE DIFF:** Exact four paths.

**ACCEPTANCE CHECK:** Every Task Contract field mapped or explicitly extended;
no guessed native field; schema positive/negative cases behave as required.

**SECURITY CHECK:** Profiles/workflow cannot expand allowed scope or routing
hard constraints.

**SCOPE CHECK:** Exact owned list equals declared paths.

**ROLLBACK POINT:** Remove only four new files after hashes match.

**PROPOSED COMMIT:** Load B1's exact predeclared list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-b1-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: define installed-version atomic task contract"
```

---

### Task B2: Define capability-only coding-agent profiles and registry

**Phase:** B

**Goal:** Describe only installed coding agents without selecting one or
granting permissions.

**Why:** Brand identity is not capability evidence, and the registry is not a
router.

**Files:** Create
`docs/superpowers/schemas/coding-agent-profile.schema.json`,
`docs/superpowers/schemas/coding-agent-registry.json`, literal profile JSON
files below `docs/superpowers/schemas/profiles/`, and
`phase-b2-owned-files.txt`.

**Interfaces:** Registry maps `agent_id` to profile path only. Spec Kit's active
integration remains the operational harness selection.

**Preconditions:** B1 complete; installed integrations read through exact
status argv.

**PRE-CHANGE EVIDENCE:** Task-start status and installed integration evidence.

- [ ] Build profile output paths deterministically from validated installed
  keys and persist them before writing profile files.
- [ ] Implement the design §7.1 schema. `tool_access` and `capabilities` are
  metadata; every unverified value is literal `false`. Evidence for a `true`
  value must cite pinned Spec Kit help/probe or explicit project configuration.
- [ ] Reject `cost_class`, `trust_class`, provider/model choices, permission
  grants, and runtime-selection fields at schema validation.
- [ ] Registry description must state it describes availability only; it has no
  default, priority, select, route, provider, or model field.
- [ ] Validate every profile against the schema and assert each registry entry
  resolves to exactly one existing profile.

**EXACT MUTATION:** Schema, registry, one profile per installed integration, and
exact owned manifest.

**POST-CHANGE DIFF:** Only B2 owned paths.

**ACCEPTANCE CHECK:** Unknown capability false; no brand inference; registry
cannot select coding agent.

**SECURITY CHECK:** Profile never grants shell, Git, browser, MCP, or privileged
permission; project/task/runtime gates remain authoritative.

**SCOPE CHECK:** Load authorization from B2's predeclared owned manifest, not a
profile-directory glob.

**ROLLBACK POINT:** Exact owned paths only.

**PROPOSED COMMIT:** Load B2's exact predeclared list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-b2-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: add capability-only coding agent metadata"
```

---

### Task B3: Phase B verification

**Phase:** B

**Goal:** Validate schemas, mapping, profiles, registry, constitution, secrets,
and repository health.

**Why:** Phase C consumes these contracts mechanically.

**Files:** Create `phase-b3-verification.md` under artifacts.

**Interfaces:** Produces Phase B checkpoint.

**Preconditions:** B1–B2 complete.

**PRE-CHANGE EVIDENCE:** Task-start status and B1/B2 owned manifests.

- [ ] Re-run all B1/B2 positive and negative validators.
- [ ] Run constitution and complete protected checks.
- [ ] Scan exact B1/B2 owned files.
- [ ] Run all five shared verification commands and gate on every status.
- [ ] Record results and `NOT_APPLICABLE` only where an installed-version
  mechanism is absent with evidence.

**EXACT MUTATION:** One verification file.

**POST-CHANGE DIFF:** One file.

**ACCEPTANCE CHECK:** All required checks pass.

**SECURITY CHECK:** No permission/routing authority appears in profiles.

**SCOPE CHECK:** One path.

**ROLLBACK POINT:** Remove exact evidence file after hash check.

**PROPOSED COMMIT:** Exact one-file array:

```bash
AUTHORIZED_FILES=("docs/superpowers/plans/artifacts/phase-b3-verification.md")
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: verify task contract and agent metadata"
```

---

## Phase C — Actual pinned native workflow mechanism

### Task C1: Persist the exact workflow mechanism and commands

**Phase:** C

**Goal:** Identify the real pinned workflow source/overlay mechanism and persist
every value C2/C3 will execute.

**Why:** A made-up workflow filename or subcommand is not executable planning.

**Files:** Create `phase-c1-workflow.env`, `phase-c1-workflow-discovery.md`,
`phase-c1-owned-files.txt`, and `phase-c1-argv/validate.argv`, `run.argv`,
`status.argv`, `resume.argv` under artifacts. Copy one official pinned
example/schema to the artifact directory when available.

**Interfaces:** Persist literal `WORKFLOW_MECHANISM`, `WORKFLOW_SOURCE_PATH`,
`WORKFLOW_ID`, `WORKFLOW_INSTALLED_PATH`, `WORKFLOW_OVERLAY_PATH`,
`WORKFLOW_VALIDATION_METHOD`, and exact argv. Inapplicable path/command values
are literal `NONE`.

**Preconditions:** B3 complete.

**PRE-CHANGE EVIDENCE:** Task-start status, pinned CLI hash, A2 workflow probe.

- [ ] Inspect pinned top-level help, initialized-project help, generated
  manifests, templates, and package-owned examples. Limit package inspection to
  workflow/integration resources identified by the binary location.
- [ ] Establish whether the mechanism is a native workflow, command template,
  prompt set, extension, preset, overlay, or another documented primitive.
- [ ] Persist exact source and installed paths, ID, overlay path, run/status/
  resume/validate argv, and validation method. Validate repository paths stay
  within root and command argv begins with the pinned binary or an exact
  project-local executable.
- [ ] Require confirmed ordered steps, human pause, conditional transitions,
  persisted run state, status, resume, and fixed shell/prompt steps. If any
  required invariant is absent, write `NATIVE_CAPABILITY=INSUFFICIENT`, stop at
  `BLOCKED_ARCHITECTURE`, and request a separate ADR. Do not create a runtime.

**EXACT MUTATION:** Discovery env/Markdown, owned manifest, four argv files,
and an optional official example whose exact path is predeclared in C1 owned
manifest.

**POST-CHANGE DIFF:** C1 owned paths only.

**ACCEPTANCE CHECK:** Every required persisted field is a validated literal and
every command is executable as argv or exactly `NONE`.

**SECURITY CHECK:** No untrusted interpolation; shell is not treated as a
sandbox.

**SCOPE CHECK:** C1 predeclared owned manifest.

**ROLLBACK POINT:** Exact owned paths only.

**PROPOSED COMMIT:** Load the exact C1 list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-c1-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: record pinned Spec Kit workflow mechanism"
```

---

### Task C2: Create the native İkiMetr Agent Loop overlay

**Phase:** C

**Goal:** Implement the approved state machine using only the C1-confirmed
native mechanism.

**Why:** The workflow must enforce one task, bounded correction, verification,
security, scope, and human gates without a parallel runtime.

**Files:** Create/modify the exact `WORKFLOW_SOURCE_PATH` or
`WORKFLOW_OVERLAY_PATH` selected in C1 and create `phase-c2-owned-files.txt` plus
`phase-c2-state-map.md`.

**Interfaces:** Consumes B1 Task Contract; produces states READY, PRECHECK,
CONTEXT_READY, RED_OR_BASELINED, optional ROUTED, EXECUTING, TARGETED_VERIFY,
FAILURE_TRIAGE, FULL_VERIFY, SECURITY_VERIFY, SCOPE_VERIFY, VERIFIED, all six
blocked states, and FAILED.

**Preconditions:** C1 says native capability sufficient.

**PRE-CHANGE EVIDENCE:** Task-start status and pre-hash of any installed managed
workflow file.

- [ ] Copy/overlay only through the pinned supported customization point. Do not
  edit upstream tool internals or package caches.
- [ ] Encode every valid/forbidden transition from design §9. Any verification
  failure enters FAILURE_TRIAGE. Only CODE_FIXABLE with correction count below
  two returns to EXECUTING. The counter never resets.
- [ ] FULL_VERIFY and SECURITY_VERIFY are visited for every task; non-applicable
  checks record a reason rather than a pass.
- [ ] PRECHECK validates task status READY, exact scope, dependency completion,
  environment, data/risk/budget constraints, and task-owned manifest.
- [ ] Path A dispatches only through the active/default Spec Kit integration.
  Profile/registry data cannot select it. ROUTED is entered only for an explicit
  Path B operation.
- [ ] Shell steps call fixed project commands with argv; model/user output is
  data only. No arbitrary shell, broad staging, automatic commit, or provider
  fallback.
- [ ] Run the exact C1 validation argv and record output.

**EXACT MUTATION:** Exact native workflow/overlay file and two evidence files.

**POST-CHANGE DIFF:** C2 owned manifest only.

**ACCEPTANCE CHECK:** Validation succeeds; state-map audit covers all states and
transitions; no custom runtime package exists.

**SECURITY CHECK:** Human gates precede sensitive/destructive steps; output is
untrusted; higher project policy cannot be overridden.

**SCOPE CHECK:** Exact C2 owned paths.

**ROLLBACK POINT:** Restore a pre-existing managed file only by exact recorded
blob/hash; remove exact new overlay/evidence files after hash checks.

**PROPOSED COMMIT:** Load C2's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-c2-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: add native Spec Kit Agent Loop overlay"
```

---

### Task C3: Exercise pause, status, resume, and state transitions

**Phase:** C

**Goal:** Prove the exact native workflow lifecycle with a synthetic no-write
task.

**Why:** Parse success alone does not prove gates or persistence.

**Files:** Create `phase-c3-mock-task.json`, `phase-c3-run-evidence.json`,
`phase-c3-verification.md`, and `phase-c3-owned-files.txt` under artifacts.

**Interfaces:** Uses the literal C1 run/status/resume argv and C2 workflow ID.

**Preconditions:** C2 complete.

**PRE-CHANGE EVIDENCE:** Task-start status and workflow hash.

- [ ] Create a valid DOCS_ONLY mock Task Contract whose allowed scope contains
  only its evidence paths and whose execution step performs no write.
- [ ] Load/validate run argv and execute until the first human gate. Require a
  persisted run ID and paused state.
- [ ] Load status argv, insert only the validated run ID at the help-confirmed
  argument position, and require paused status.
- [ ] Persist literal human approval for this synthetic run, load resume argv,
  insert the same validated run ID, resume, and verify the ordered state trace
  terminates VERIFIED.
- [ ] Run C1 validation argv, constitution guard, complete protected manifest,
  exact secret scan, and all five shared verification commands.

**EXACT MUTATION:** Four declared C3 files; workflow runtime state only at its
confirmed managed location.

**POST-CHANGE DIFF:** Exact C3 evidence plus C1-confirmed run-state path if the
native mechanism makes it durable and that path was preapproved.

**ACCEPTANCE CHECK:** Pause/status/resume and required state order observed.

**SECURITY CHECK:** No arbitrary command or production write; human approval is
literal and run-specific.

**SCOPE CHECK:** Exact C3 owned manifest.

**ROLLBACK POINT:** Use native run cleanup only if C1 proved it manifest-safe;
otherwise leave managed run state and report it. Remove exact evidence files by
hash.

**PROPOSED COMMIT:** Load C3's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-c3-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "test: verify native Agent Loop lifecycle"
```

---

## Phase D — Deterministic failure classification and verification evidence

### Task D1: Implement the eight-class failure classifier

**Phase:** D

**Goal:** Encode deterministic classification, transitions, and the single
correction budget.

**Why:** Verification failure must not trigger an immediate code edit.

**Files:** Modify the C2 overlay and create
`docs/superpowers/schemas/failure-evidence.schema.json`, optionally
`tools/agent-loop/classify-failure.mjs` only when C1 proves a fixed helper is
required, optional exact helper test
`tools/agent-loop/test/classify-failure.test.ts`, plus
`phase-d1-test.argv`, `phase-d1-owned-files.txt`, and D1 fixture/evidence paths
persisted before mutation.

**Interfaces:** Input includes origin, command, exit status, deterministic
fingerprint, reproduction count, correction count, provider/environment facts,
and security/architecture/spec flags. Output is class, next state, action, and
updated counts.

**Preconditions:** C3 complete; helper mode recorded as `NATIVE` or
`FIXED_HELPER` with evidence. Any other mode stops.

**PRE-CHANGE EVIDENCE:** Task-start status, overlay hash, mode decision.

- [ ] Apply precedence exactly: SECURITY → ARCHITECTURE → SPEC_AMBIGUITY →
  ENVIRONMENT → PROVIDER → TEST_INFRASTRUCTURE → FLAKY → CODE_FIXABLE.
- [ ] ENVIRONMENT, PROVIDER, SPEC_AMBIGUITY, SECURITY, ARCHITECTURE, and
  TEST_INFRASTRUCTURE never authorize a code change. PROVIDER never reroutes.
- [ ] A nondeterministic verification failure with zero reproduction attempts
  yields FLAKY plus `REPRODUCE_ONCE`; after the one controlled reproduction it
  yields FAILED. Reproduction does not consume/reset correction count.
- [ ] A deterministic implementation failure yields CODE_FIXABLE only when
  `correction_cycles_used` is 0 or 1. Increment before returning to EXECUTING.
  At 2, output FAILED. Initial implementation count is always one.
- [ ] Test one fixture for every class, every terminal transition, the one
  reproduction limit, correction values 0/1/2, and counter non-reset across
  targeted/full/scope failures. Assert no other class reaches EXECUTING.
- [ ] Persist the exact targeted test argv before implementation, load it with
  `mapfile`, execute `"${D1_TEST_ARGV[@]}"`, and require zero after the complete
  truth table is present.

**EXACT MUTATION:** Exact D1 schema, overlay change, mode-specific helper/test,
and evidence files listed in the predeclared D1 owned manifest.

**POST-CHANGE DIFF:** D1 manifest only.

**ACCEPTANCE CHECK:** Complete truth table passes and all forbidden transitions
are rejected.

**SECURITY CHECK:** Security failures stop; provider failures do not fall back;
input text cannot become shell argv.

**SCOPE CHECK:** Exact D1 manifest.

**ROLLBACK POINT:** Path-scoped restore of overlay after pre-hash proof; remove
new D1 files after hash checks.

**PROPOSED COMMIT:** Load D1's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-d1-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: add deterministic Agent Loop failure classifier"
```

---

### Task D2: Implement and validate VerificationEvidence

**Phase:** D

**Goal:** Record trustworthy PASS, FAIL, and NOT_APPLICABLE evidence and refuse
false VERIFIED states.

**Why:** Agent completion claims are not proof.

**Files:** Create
`docs/superpowers/schemas/verification-evidence.schema.json`, optionally
`tools/agent-loop/record-evidence.mjs` when native validation is insufficient,
optional exact test `tools/agent-loop/test/record-evidence.test.ts`,
`phase-d2-test.argv`, `phase-d2-owned-files.txt`, and
`phase-d2-evidence-mode.env`/verification artifacts.

**Interfaces:** Exact check fields are `check_name`, `command_or_method`,
`timestamp`, `result`, `result_reason`, `exit_status`, `artifact_ref`, and
`summary`; root fields are schema version, task ID, checks, final status,
scope diff, verifier, and verified timestamp.

**Preconditions:** D1 complete; evidence mode established from C1 capabilities.

**PRE-CHANGE EVIDENCE:** Task-start status and mode evidence.

- [ ] Schema requires a non-empty reason when result is NOT_APPLICABLE,
  requires integer exit status for executed commands, forbids a successful exit
  status on FAIL, and permits null exit status only for non-command methods.
- [ ] Final VERIFIED is accepted only when every required task-class check is
  PASS or justified NOT_APPLICABLE, scope comparison is exact, required
  security review is present, and secret scan passes for committable files.
- [ ] Recorder accepts a JSON input file path, validates as data, appends one
  immutable record using an exclusive append, emits no prompt/file contents,
  and never updates an earlier record. It performs no shell execution.
- [ ] Tests cover valid PASS, valid justified NOT_APPLICABLE, missing reason,
  FAIL with zero exit, VERIFIED containing FAIL, missing secret check, scope
  mismatch, duplicate check, malformed timestamp, and append-only behavior.
- [ ] Persist, load, and execute the exact D2 targeted-test argv; require zero
  only after every positive and negative fixture above has run.

**EXACT MUTATION:** Schema, mode-selected recorder/test, and evidence files in
the predeclared D2 manifest.

**POST-CHANGE DIFF:** D2 manifest only.

**ACCEPTANCE CHECK:** Positive fixtures pass; every invalid fixture fails
closed; records are append-only.

**SECURITY CHECK:** Evidence stores hashes/summaries only and cannot authorize
permissions, provider choices, or commands.

**SCOPE CHECK:** Exact D2 manifest.

**ROLLBACK POINT:** Exact new files only.

**PROPOSED COMMIT:** Load D2's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-d2-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: add fail-closed verification evidence contract"
```

---

### Task D3: Phase D verification

**Phase:** D

**Goal:** Prove classifier/evidence behavior and repository health.

**Why:** Phase E relies on failure and evidence transitions.

**Files:** Create `phase-d3-verification.md`.

**Interfaces:** Produces Phase D checkpoint.

**Preconditions:** D1–D2 complete.

**PRE-CHANGE EVIDENCE:** Task-start status and D1/D2 manifests.

- [ ] Execute every D1/D2 targeted test command, C1 workflow validation,
  constitution guard, complete protected check, exact secret scan, and all five
  shared verification commands.
- [ ] Inspect the workflow trace for CODE_FIXABLE 0/1/2, FLAKY twice,
  ENVIRONMENT, PROVIDER, and SECURITY fixtures.

**EXACT MUTATION:** One verification file.

**POST-CHANGE DIFF:** One file.

**ACCEPTANCE CHECK:** All required checks pass with fresh outputs.

**SECURITY CHECK:** No forbidden transition or hidden reroute.

**SCOPE CHECK:** One path.

**ROLLBACK POINT:** Exact evidence file.

**PROPOSED COMMIT:** Exact one-file array:

```bash
AUTHORIZED_FILES=("docs/superpowers/plans/artifacts/phase-d3-verification.md")
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: verify failure and evidence gates"
```

---

## Phase E — Path B through the existing public AiExecutor only

### Task E1: Revalidate the executable boundary and persist one bridge contract

**Phase:** E

**Goal:** Re-read the current public API and select exactly one minimal bridge
mechanism compatible with the C1 native workflow.

**Why:** Current repository evidence shows `AiExecutor` is exported and tested,
but package `cli.ts` validates configuration only; a filename existing is not
an AiExecutor execution boundary.

**Files:** Read `ai-executor.ts`, `index.ts`, `routing-contracts.ts`, package
scripts/exports, config CLI, and direct AiExecutor tests. Create
`phase-e1-api.md`, `phase-e1-bridge.env`, `phase-e1-owned-files.txt`, and four
exact bridge argv artifacts.

**Interfaces:** Persist `BRIDGE_MODE`, `BRIDGE_SOURCE`, `BRIDGE_TEST`,
`BRIDGE_RUN_COMMAND`, and `BRIDGE_TEST_COMMAND` as literal values/argv.

**Preconditions:** D3 complete; C1 native hook/command capability known.

**PRE-CHANGE EVIDENCE:** Task-start status and current hashes of the read-only AI
Cost System files.

- [ ] Confirm constructor dependencies are router, coordinator, local adapter,
  and cheap-cloud adapter; `execute` accepts routing request/context/invoke
  params; only LOCAL and CHEAP_CLOUD dispatch; CACHE, DETERMINISTIC, STRONG,
  APPROVAL_REQUIRED, and STOP return unchanged.
- [ ] Inspect every package executable/script and prove whether it constructs a
  real `AiExecutor`. Record `EXISTING_EXECUTABLE=true` only with source path,
  invocation argv, and a targeted test.
- [ ] If it exists, choose `BRIDGE_MODE=EXISTING_EXECUTABLE` and persist that
  exact source/test/run/test command.
- [ ] If absent, choose only `BRIDGE_MODE=IN_PROCESS_INJECTED_ADAPTER` with
  `BRIDGE_SOURCE=tools/agent-loop/path-b-bridge.ts` and
  `BRIDGE_TEST=tools/agent-loop/test/path-b-bridge.test.ts`. This bridge accepts
  an already-constructed `Pick<AiExecutor, 'execute'>` from the C1-confirmed
  native host and calls `execute` exactly once. It cannot instantiate/import/
  invoke the router, coordinator, invokers, or adapters.
- [ ] Persist the exact native hook invocation as run argv and exact Vitest
  command as test argv. If C1 provides no in-process dependency-injection hook,
  stop `BLOCKED_ARCHITECTURE` and require a separate composition-root design;
  do not create a fake CLI, dynamic module loader, service proxy, or custom
  runtime.

**EXACT MUTATION:** API/bridge decision evidence and exact argv files only.

**POST-CHANGE DIFF:** E1 artifact paths only.

**ACCEPTANCE CHECK:** One bridge mode, exact source/test/run/test fields, and no
unresolved composition assumption.

**SECURITY CHECK:** No provider credentials, dynamic code loading, router call,
or coding-agent launch.

**SCOPE CHECK:** E1 owned manifest.

**ROLLBACK POINT:** Exact evidence files.

**PROPOSED COMMIT:** Load E1's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-e1-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "docs: pin AiExecutor bridge boundary"
```

---

### Task E2: TDD the minimal injected Path B adapter when required

**Phase:** E

**Goal:** Implement the E1-selected adapter with a real red/green cycle.

**Why:** The bridge must be a thin public-API call, not another router.

**Files:** In injected mode create exactly the E1 source/test paths and
`phase-e2-red.log`, `phase-e2-green.log`, `phase-e2-evidence.md`, and
`phase-e2-owned-files.txt`; existing mode creates evidence only.

**Interfaces:** `executePathB(executor, input)` forwards the three inputs
unchanged and returns/rethrows unchanged.

**Preconditions:** E1 complete and not blocked.

**PRE-CHANGE EVIDENCE:** Task-start status, bridge decision, absence/pre-hash of
exact source/test.

- [ ] RED: create the test first. Assert one `execute` call, referentially
  unchanged three arguments, unchanged success result, unchanged each of five
  non-executable decisions, unchanged rejection, and no second call/fallback.
  Run exact `BRIDGE_TEST_COMMAND`; require nonzero and require output identifies
  the missing adapter export rather than test infrastructure.
- [ ] GREEN: implement only the typed injected function. It imports
  `AiExecutor` as a public type/value needed for typing and calls
  `executor.execute(...)` once. It contains no routing decision switch, retry,
  fallback, provider/model selection, shell, network, or coding-harness launch.
- [ ] Run exact targeted command and require zero. Scan source imports/text for
  forbidden router/coordinator/invoker/adapter imports and direct provider
  names; any match outside type documentation fails.
- [ ] Run all five shared verification commands; every status participates.

**EXACT MUTATION:** Exact mode-dependent E2 owned manifest.

**POST-CHANGE DIFF:** Only persisted bridge paths and evidence.

**ACCEPTANCE CHECK:** Observed RED for expected reason, GREEN targeted pass,
repository gate pass, and all current non-executable decisions preserved.

**SECURITY CHECK:** Public AiExecutor call only; no dynamic loading, secret,
fallback, or command execution.

**SCOPE CHECK:** Exact E2 manifest.

**ROLLBACK POINT:** Exact new files or evidence only.

**PROPOSED COMMIT:** Load E2's exact mode-dependent list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-e2-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: add minimal injected AiExecutor bridge"
```

---

### Task E3: Wire the exact bridge into ROUTED

**Phase:** E

**Goal:** Make the native workflow consume E1's literal bridge command/hook and
map results without changing AI Cost System behavior.

**Why:** Path B belongs behind AiExecutor; Path A remains independent.

**Files:** Modify exact C2 workflow/overlay; create
`phase-e3-routing-map.json`, `phase-e3-owned-files.txt`, and targeted workflow
fixtures.

**Interfaces:** LOCAL/CHEAP_CLOUD accept returned coordinator results; CACHE and
DETERMINISTIC record unchanged decisions; STRONG records manual handoff;
APPROVAL_REQUIRED pauses for human approval; STOP maps reason to the applicable
blocked state. No non-executable decision is made executable.

**Preconditions:** E2 pass or E1 existing executable proven.

**PRE-CHANGE EVIDENCE:** Task-start status and workflow pre-hash.

- [ ] Load/validate exact bridge run argv; bind only a validated Task Contract
  routing payload. No shell interpolation of prompt/model output.
- [ ] Implement the seven-variant table above and test each variant. Provider
  invocation failure becomes BLOCKED_PROVIDER/FAILURE_TRIAGE evidence and never
  triggers another route.
- [ ] Verify Path A tasks bypass ROUTED and still use active Spec Kit integration.
- [ ] Run bridge tests and exact workflow validation.

**EXACT MUTATION:** Workflow plus E3 mapping/tests/evidence in exact manifest.

**POST-CHANGE DIFF:** E3 manifest only.

**ACCEPTANCE CHECK:** Seven variants and Path A bypass pass.

**SECURITY CHECK:** No router import/call in Phase E files, no second decision
schema, no hidden provider fallback, no coding-agent selection.

**SCOPE CHECK:** Exact E3 manifest.

**ROLLBACK POINT:** Exact workflow restore after provenance proof; remove new E3
files by hash.

**PROPOSED COMMIT:** Load E3's exact list:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-e3-owned-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "feat: wire Path B through public AiExecutor"
```

---

### Task E4: Phase E verification

**Phase:** E

**Goal:** Prove the public boundary, seven decisions, no fallback, and full
repository health.

**Why:** Path B is architecture/security sensitive.

**Files:** Create `phase-e4-verification.md`.

**Interfaces:** Produces Phase E checkpoint.

**Preconditions:** E3 complete.

**PRE-CHANGE EVIDENCE:** Task-start status and E1–E3 manifests.

- [ ] Run bridge/workflow targeted tests, exact validation, constitution guard,
  complete protected check, exact secret scan, and all five shared commands.
- [ ] Search Phase E owned files for router construction/evaluation, new routing
  schemas, provider fallbacks, dynamic module loading, and coding-harness launch.
  Review every match; architecture terms in evidence are harmless only when
  they describe prohibitions.

**EXACT MUTATION:** One verification file.

**POST-CHANGE DIFF:** One file.

**ACCEPTANCE CHECK:** All checks pass; current AiExecutor semantics unchanged.

**SECURITY CHECK:** Security review verdict approve; authorization/privacy/data
exposure are not applicable because no product endpoint/data path changes.

**SCOPE CHECK:** One path.

**ROLLBACK POINT:** Exact evidence file.

**PROPOSED COMMIT:** Exact one-file array:

```bash
AUTHORIZED_FILES=("docs/superpowers/plans/artifacts/phase-e4-verification.md")
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --check
git diff --cached
git commit -m "chore: verify public AiExecutor workflow integration"
```

---

## Phase F — One exact DOCS_ONLY pilot

### Task F1: Deterministically discover and approve the documentation pilot

**Phase:** F

**Goal:** Select one real, bounded documentation defect and persist exact task,
scope, commands, and ownership before execution.

**Why:** A pilot with invented filenames does not prove scope governance.

**Files:** Create `phase-f1-candidates.tsv`, `phase-f1-human-decision.env`,
`phase-f1-task-contract.json`, `phase-f1-task-owned-files.txt`,
`phase-f1-link-check.argv`, and the exact native Spec Kit task artifact path
determined by B1. Use transient `/tmp/ikimetr-doc-link-check.mjs`; do not commit
it.

**Interfaces:** Candidate is one tracked Markdown file under `docs`, excluding
governance, ADRs, generated mirrors, this design/plan, artifacts, and AI policy.

**Preconditions:** E4 complete; exact C1 workflow commands and B1 task creation
mechanism available.

**PRE-CHANGE EVIDENCE:** Task-start status and hash of every candidate inspected.

- [ ] Create the transient Node checker with standard library only. It obtains
  eligible inputs from literal `git ls-files` results, parses Markdown links,
  ignores URLs/mail/fragment-only links and fenced code, resolves relative file
  targets under repository root, parses target headings with deterministic
  lowercase/hyphen anchor normalization, and emits TSV sorted by file then
  line. It is read-only and rejects parent traversal outside root.
- [ ] Record the transient checker SHA-256 and persist exact argv in
  `phase-f1-link-check.argv`. Load that argv and run it over eligible tracked
  Markdown. Emit candidates only for broken relative file/anchor links, with
  file, line, literal link target, and deterministic repair evidence. Do not
  choose a wording/style-only change.
- [ ] If no candidate exists, stop and ask a human for one exact eligible docs
  defect; validate it with the same checker before persistence.
- [ ] Human selects one exact candidate line. Persist target file, line, defect,
  expected repaired target, `DOCS_ONLY`, budget `NONE`, data class `internal`,
  no Path B, and literal approval.
- [ ] Create Task Contract with allowed files equal to the selected doc, exact
  native task artifact, all predeclared F1/F2/F3 evidence and authorization
  files, and no others. Forbidden scope
  includes canonical constitution, AGENTS, AI policy/config/system, app/package
  code, secrets, and all non-selected docs.
- [ ] Record pre-hash/state for every allowed path. Create native task through
  the exact B1 mechanism and validate it.

**EXACT MUTATION:** Exact F1 artifacts and native task artifact; selected doc is
not changed yet.

**POST-CHANGE DIFF:** F1 owned manifest only.

**ACCEPTANCE CHECK:** Real defect reproducible; exact file/line/repair and human
approval persisted; Task Contract validates.

**SECURITY CHECK:** No secrets/PII; budget NONE; Path B disabled.

**SCOPE CHECK:** Exact F1 owned manifest.

**ROLLBACK POINT:** Exact new artifacts only.

**PROPOSED COMMIT:** None; pilot execution and evidence are committed in F3.

---

### Task F2: Execute the DOCS_ONLY pilot through the native workflow

**Phase:** F

**Goal:** Run the approved task end-to-end through Path A and produce complete
verification evidence.

**Why:** This is the first controlled real mutation by the workflow.

**Files:** Modify only the selected literal doc; create exact F2 run/evidence
paths already listed in F1 ownership.

**Interfaces:** Uses C1 run/status/resume argv, B1 Task Contract, D evidence
recorder, active/default integration, and fixed scanner wrapper.

**Preconditions:** F1 literal approval and clean status relative to F1 start.

**PRE-CHANGE EVIDENCE:** Revalidate all F1 pre-hashes and allowed paths; capture
selected doc hash and failing link-check result.

- [ ] Execute READY → PRECHECK → CONTEXT_READY → RED_OR_BASELINED. Context is
  Task Contract, exact spec/plan refs, selected doc, and link-check evidence only.
- [ ] Skip ROUTED because budget is NONE and this is Path A. At the human gate,
  re-display exact allowed files and approved repair.
- [ ] Execute through active/default integration. The coding harness may change
  only the selected doc and predeclared evidence paths.
- [ ] TARGETED_VERIFY reruns the exact link check and requires the original
  defect absent with no new broken link.
- [ ] FULL_VERIFY records docs acceptance, diff whitespace, and link validation;
  unit/integration/type/lint/build are NOT_APPLICABLE with reason because the
  Task Contract changes documentation only.
- [ ] SECURITY_VERIFY records NOT_APPLICABLE for product security boundaries but
  requires the fixed secret scan. SCOPE_VERIFY compares task-start/current state
  against the exact allowed array, including tracked/untracked/staged sets.
- [ ] Any failure enters D1 classifier. DOCS correction counts against the same
  maximum two corrections. Record final immutable evidence and state trace.

**EXACT MUTATION:** Selected doc and predeclared F2 evidence only.

**POST-CHANGE DIFF:** Exact F1 allowed-file set; no additional path.

**ACCEPTANCE CHECK:** Original deterministic defect repaired; workflow reaches
VERIFIED with evidence.

**SECURITY CHECK:** Fixed secret scan passes; no policy/security content changed.

**SCOPE CHECK:** Exact allowed array, with staged set empty before F3.

**ROLLBACK POINT:** Restore selected tracked doc from F1 task-start commit only
after pre-hash proof; remove new evidence by exact hash.

**PROPOSED COMMIT:** None until F3 reviews evidence.

---

### Task F3: Audit and commit the DOCS_ONLY pilot

**Phase:** F

**Goal:** Recheck evidence and stage exactly the approved pilot files.

**Why:** Workflow success is not the final commit gate.

**Files:** Create `phase-f3-retrospective.md` and
`phase-f3-authorized-files.txt`; read F1/F2 exact ownership.

**Interfaces:** Produces Phase F checkpoint.

**Preconditions:** F2 VERIFIED.

**PRE-CHANGE EVIDENCE:** F2 record, task-start/current scope comparison.

- [ ] Re-run targeted link check, constitution guard, complete protected check,
  secret scan, and whitespace diff.
- [ ] Load F1 task-owned list, append the selected doc and exact F2/F3 evidence
  paths already authorized by the Task Contract, reject duplicates, and compare
  with actual changed paths.
- [ ] Record timing, transitions, checks, correction count, and limitations.

**EXACT MUTATION:** Retrospective and exact authorization manifest.

**POST-CHANGE DIFF:** Exact approved pilot set.

**ACCEPTANCE CHECK:** Evidence is internally consistent and all docs gates pass.

**SECURITY CHECK:** Secret scan exact approved set.

**SCOPE CHECK:** Changed and authorized sorted lists are byte-identical.

**ROLLBACK POINT:** F1/F2 exact provenance rules.

**PROPOSED COMMIT:** Build the authorization file only from the human-approved
F1 Task Contract, then load it:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-f3-authorized-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "docs: validate DOCS_ONLY Agent Loop pilot"
```

---

## Phase G — One actual PURE_LOGIC TDD pilot

### Task G1: Discover and approve one source/test pair

**Phase:** G

**Goal:** Select an actual small pure function and existing unit-test file from
the repository, persist exact paths/goal, and obtain human approval.

**Why:** The pilot may not invent package names or leave source/test paths for
manual command substitution.

**Files:** Create `phase-g1-candidates.tsv`, `phase-g1-human-decision.env`,
`phase-g1-task-contract.json`, native task artifact, and
`phase-g1-task-owned-files.txt`.

**Interfaces:** Exactly one tracked source and one tracked unit-test path in one
package; `packages/ai-cost-system`, auth, database, network, filesystem,
environment, time/randomness, migrations, and cross-module candidates are
excluded.

**Preconditions:** F3 checkpoint.

**PRE-CHANGE EVIDENCE:** Task-start status and candidate hashes.

- [ ] Enumerate tracked TypeScript source/test pairs under packages, sorted by
  package/path. Keep files below 300 lines whose imports and symbols show a
  deterministic side-effect-free function and an existing unit-test harness.
- [ ] For each candidate record package name, source, test, symbol, current
  behavior, one small missing boundary rule, and exact targeted Vitest argv.
- [ ] Human selects one row and approves the boundary rule. Persist literal
  `PACKAGE_NAME`, `SOURCE_FILE`, `TEST_FILE`, `SYMBOL`,
  `EXPECTED_RED_TEST_NAME`, targeted command argv, and approval. Re-read and
  validate files are tracked, in one package, and not forbidden.
- [ ] Task Contract allowed files are exactly source, test, native task artifact,
  and all predeclared G1/G2/G3 evidence and authorization files. Required
  tests: unit true; integration/e2e false.
  Budget NONE and no Path B.
- [ ] Record task-start hashes/states for every allowed path and validate native
  task artifact through B1 mechanism.

**EXACT MUTATION:** G1 artifacts/task only; source/test unchanged.

**POST-CHANGE DIFF:** G1 owned manifest only.

**ACCEPTANCE CHECK:** Actual validated pair and test command persisted; human
approved precise behavior and scope.

**SECURITY CHECK:** Pure logic only; no AI/provider/auth/data boundary.

**SCOPE CHECK:** Exact G1 manifest.

**ROLLBACK POINT:** Exact new artifacts.

**PROPOSED COMMIT:** None until G3.

---

### Task G2: Execute real RED, GREEN, bounded correction, and verification

**Phase:** G

**Goal:** Run the approved PURE_LOGIC task through Path A with genuine TDD and
at most two CODE_FIXABLE correction cycles.

**Why:** A passing test added after implementation does not prove the loop.

**Files:** Modify exact persisted source/test; create predeclared run, red,
green, verification, and execution records.

**Interfaces:** Uses literal G1 argv and D1/D2 gates.

**Preconditions:** G1 approved; all allowed pre-hashes revalidate.

**PRE-CHANGE EVIDENCE:** Task-start status, source/test hashes, current targeted
test pass, and allowed-scope manifest.

- [ ] Run workflow to RED_OR_BASELINED. Add only the approved test first.
- [ ] Load targeted argv and execute with pipefail/tee. Require nonzero, require
  `EXPECTED_RED_TEST_NAME` in output, and require the failure assertion matches
  the approved missing behavior. Compile/config/environment failures are not a
  valid RED and enter classifier.
- [ ] Implement the minimum source change, then rerun exact targeted argv and
  require zero. Record red/green command, status, and summary.
- [ ] Run applicable PURE_LOGIC gates exactly:

  ```bash
  set -o pipefail
  pnpm lint 2>&1 | tee /tmp/g2-lint.log; LINT_STATUS=${PIPESTATUS[0]}
  pnpm typecheck 2>&1 | tee /tmp/g2-typecheck.log; TYPECHECK_STATUS=${PIPESTATUS[0]}
  pnpm test:unit 2>&1 | tee /tmp/g2-unit.log; UNIT_STATUS=${PIPESTATUS[0]}
  pnpm build 2>&1 | tee /tmp/g2-build.log; BUILD_STATUS=${PIPESTATUS[0]}
  if (( LINT_STATUS != 0 || TYPECHECK_STATUS != 0 || UNIT_STATUS != 0 || BUILD_STATUS != 0 )); then exit 1; fi
  ```

- [ ] On any failure, enter FAILURE_TRIAGE. Only CODE_FIXABLE may change source
  or test, consuming one global correction. Maximum two; targeted verification
  is rerun after each. Environment/provider/spec/security/architecture/test
  infrastructure never edits code. One flaky reproduction maximum.
- [ ] SECURITY_VERIFY records NOT_APPLICABLE with pure-logic reason but fixed
  secret scan still runs. SCOPE_VERIFY compares tracked, untracked, and staged
  sets with exact Task Contract files. Record immutable evidence and final state.

**EXACT MUTATION:** Exact source/test plus predeclared G2 evidence.

**POST-CHANGE DIFF:** Only exact allowed files.

**ACCEPTANCE CHECK:** Expected RED, minimal GREEN, targeted pass, four
applicable repository checks pass, corrections at most two, final VERIFIED.

**SECURITY CHECK:** No secrets, I/O, auth/data/provider boundary, or scope
expansion.

**SCOPE CHECK:** Exact G1 Task Contract array; staged set empty before G3.

**ROLLBACK POINT:** Restore source/test from G1 task-start commit only after hash
proof; remove exact evidence files by hash.

**PROPOSED COMMIT:** None until G3.

---

### Task G3: Audit and commit the PURE_LOGIC pilot

**Phase:** G

**Goal:** Independently re-run all applicable checks and stage only exact pilot
files/evidence.

**Why:** Bounded execution needs an external commit gate.

**Files:** Create `phase-g3-retrospective.md` and
`phase-g3-authorized-files.txt`.

**Interfaces:** Produces Phase G checkpoint.

**Preconditions:** G2 VERIFIED.

**PRE-CHANGE EVIDENCE:** G1/G2 task contract, manifests, and verification record.

- [ ] Re-run exact targeted command, lint, typecheck, unit, build, constitution
  guard, complete protected check, and secret scan. Gate every executed status.
- [ ] Confirm integration tests are NOT_APPLICABLE for this exact PURE_LOGIC
  Task Contract and record the reason; do not execute and ignore them.
- [ ] Verify correction counter, failure classifications, red/green evidence,
  no extra changed path, and exact staged set.

**EXACT MUTATION:** Retrospective and exact authorization manifest.

**POST-CHANGE DIFF:** Exact G approved set.

**ACCEPTANCE CHECK:** Fresh targeted/repository evidence passes and records are
consistent.

**SECURITY CHECK:** Fixed scanner and pure-logic boundary pass.

**SCOPE CHECK:** Actual changed list equals exact allowed list.

**ROLLBACK POINT:** G1/G2 exact provenance rules.

**PROPOSED COMMIT:** Build the authorization file only from the human-approved
G1 Task Contract, then load it:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-g3-authorized-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "test: validate PURE_LOGIC Agent Loop pilot"
```

---

## Phase H — Future integration decision and safe procedure

### Task H1: Decide native, generic, ADR, or no change

**Phase:** H

**Goal:** Determine whether a demonstrated coding-harness need remains after the
pilots and persist exactly one decision.

**Why:** Integrations are installed for actual work, never speculation.

**Files:** Create `phase-h1-decision.md` and `phase-h1-decision.env`.

**Interfaces:** Decision enum is `NO_CHANGE`, `NATIVE`, `GENERIC`, or
`CUSTOM_REQUIRES_ADR`.

**Preconditions:** G3 checkpoint.

**PRE-CHANGE EVIDENCE:** Current exact integration status argv/output and pilot
limitations.

- [ ] Document the unsatisfied harness requirement and acceptance criteria. If
  none, persist `NO_CHANGE`.
- [ ] Check exact pinned integration inventory. If a matching native integration
  exists, persist `NATIVE` plus key. Otherwise inspect the exact generic probe;
  if it meets every criterion, persist `GENERIC` plus literal commands-dir/
  options. Otherwise persist `CUSTOM_REQUIRES_ADR` and stop before code.
- [ ] Human approves the literal decision and key/options. Re-read and validate
  against A2 allowlists.

**EXACT MUTATION:** Two decision files.

**POST-CHANGE DIFF:** Exact two files.

**ACCEPTANCE CHECK:** Demonstrated need, deterministic priority native then
generic then ADR, literal approval.

**SECURITY CHECK:** No profile permission, provider/model selection, or
speculative agent.

**SCOPE CHECK:** Two paths.

**ROLLBACK POINT:** Exact files.

**PROPOSED COMMIT:** Do not commit alone; H3 includes final decision.

---

### Task H2: Execute the approved native or generic integration safely

**Phase:** H

**Goal:** Apply one approved integration mutation with complete manifests, or
record no mutation/ADR block.

**Why:** Native is preferred, generic is second, and custom work requires a
separate accepted ADR.

**Files:** Modify only H1-approved, A2-probe-predicted integration paths; create
`phase-h2-pre.json`, `phase-h2-owned-files.txt`, and `phase-h2-audit.md`.

**Interfaces:** Consumes exact A2 argv and H1 literals.

**Preconditions:** H1 approved.

**PRE-CHANGE EVIDENCE:** Task-start commit/status, complete protected manifest,
and SHA-256 inventory of every expected shared path.

- [ ] For `NO_CHANGE`, write audit stating no integration command ran and skip
  mutation steps.
- [ ] For `NATIVE`, load exact key-specific `install.argv`; verify pinned binary,
  exact key, and A2 predicted paths. Execute once, derive owned paths only by
  iterating the preapproved prediction, reject every other status path, and run
  complete protected/shared manifest comparisons.
- [ ] For `GENERIC`, create the exact commands directory and option files at the
  H1-approved project-local paths first. Validate their schemas with the pinned
  help/example, then load exact generic install argv and execute once. Audit
  generated/shared paths against the generic probe prediction.
- [ ] Query current default via exact status argv. Execute exact use argv only
  if the approved integration must become default and a second literal human
  approval is `true`. Capture full pre/post shared manifests and reject any
  unexpected refresh.
- [ ] For `CUSTOM_REQUIRES_ADR`, create no adapter/code. Record terminal
  `BLOCKED_ARCHITECTURE` with required ADR contents: unmet invariant, native and
  generic evidence, security/maintenance/rollback consequences.
- [ ] Rollback may use exact uninstall argv only when A2 proved it manifest-safe
  for this key and current hashes match; otherwise exact file-level provenance.

**EXACT MUTATION:** Mode-dependent approved integration paths and three evidence
files; no custom code in ADR mode.

**POST-CHANGE DIFF:** Exact H2 owned manifest only.

**ACCEPTANCE CHECK:** Selected procedure completed or blocked at the precise ADR
gate; no speculative integration.

**SECURITY CHECK:** No router/provider changes, no unsafe shared refresh, no
unproven uninstall.

**SCOPE CHECK:** Task-start plus exact H2 owned paths.

**ROLLBACK POINT:** Manifest-aware uninstall only when proven safe; otherwise
exact path-scoped restore/removal.

**PROPOSED COMMIT:** None until H3 verification.

---

### Task H3: Final verification checkpoint

**Phase:** H

**Goal:** Verify the final workflow/integration state and commit only exact H
evidence/approved changes.

**Why:** This closes the implementation plan with current reproducible evidence.

**Files:** Create `phase-h3-final-checkpoint.md`,
`phase-h3-verification-evidence.json`, and
`phase-h3-authorized-files.txt`.

**Interfaces:** Final status is VERIFIED, NO_CHANGE_VERIFIED, or the exact
blocked ADR status from H2.

**Preconditions:** H2 has a terminal result.

**PRE-CHANGE EVIDENCE:** H1/H2 manifests and task-start status.

- [ ] For non-blocked modes, run exact integration status, workflow validation,
  pause/status/resume smoke test, constitution guard, complete protected check,
  scanner over the exact H-owned list, and all five shared verification
  commands. Every executed status participates.
- [ ] For ADR-blocked mode, verify no integration/code mutation occurred and
  record the blocker without claiming completion.
- [ ] Audit Path A/Path B separation, registry non-selection, no second router,
  no fallback, attempt budget, exact staging, and rollback manifests.
- [ ] Build `AUTHORIZED_FILES` from H1 fixed files, H2 preapproved owned manifest,
  and H3 fixed files; compare with actual status before staging.

**EXACT MUTATION:** Three H3 files plus the already approved H2 set.

**POST-CHANGE DIFF:** Exact H authorization only.

**ACCEPTANCE CHECK:** Fresh final gates pass or exact ADR blocker is truthful.

**SECURITY CHECK:** Fixed scanner, canonical/protected guards, no provider or
permission authority drift.

**SCOPE CHECK:** Authorized/current/staged lists are byte-identical.

**ROLLBACK POINT:** H2 exact mode-specific provenance rules; H3 files exact.

**PROPOSED COMMIT:** Only for verified non-blocked/no-change modes, build the H3
authorization file from the two fixed H1 paths, preapproved H2 owned manifest,
and three fixed H3 paths, then run:

```bash
mapfile -t AUTHORIZED_FILES < docs/superpowers/plans/artifacts/phase-h3-authorized-files.txt
bash tools/secret-scanner/scan.sh -- "${AUTHORIZED_FILES[@]}"
git add -- "${AUTHORIZED_FILES[@]}"
git diff --cached --name-only
git diff --cached --check
git diff --cached
git commit -m "chore: complete Spec Kit Agent Loop verification checkpoint"
```

Do not commit a blocked implementation as complete.

---

## Plan self-review record

### Repository truth used

- The approved design is byte-identical to commit
  `49c166f3d3ffb90519de7e5a90298abe3663a35e`.
- Current `AiExecutor` is a public class that evaluates once, dispatches only
  LOCAL/CHEAP_CLOUD through the existing coordinator, and returns all other
  decisions unchanged.
- The current package config CLI is a configuration validator, not an
  AiExecutor execution boundary.
- `AI_COST_SYSTEM_HANDOFF.md` is historical and says Phase 3G.4 had not started;
  current source, exports, and sixteen direct AiExecutor tests supersede that
  stale execution-state sentence for this plan.
- The only directly referencing test found by targeted search is
  `packages/ai-cost-system/test/ai-executor.test.ts`.

### Mechanical invariants

- Eight phases: A through H.
- Thirty-one atomic task headings.
- Unknown runtime values use discovery, validation, literal persistence, argv
  loading, and direct execution.
- No executable substitution markers remain.
- A0 gates on lint, typecheck, unit, integration, and build.
- Scanner selection/pinning precedes CLI inspection; later gates call one fixed
  wrapper.
- Spec Kit stable tag resolves automatically through `gh` and is persisted.
- Each integration receives a separate validated disposable project; generic
  options are constructed only in its probe.
- The real pre-init gate verifies the complete protected manifest immediately
  before init.
- Default integration and force approval are literal validated human values.
- Rollback is exact-path and provenance checked; managed uninstall requires a
  safe disposable proof.
- Commit authorization is task-designed or human-approved and never inferred
  from all repository changes.
- Constitution tests mutate only temporary fixtures and cover canonical hash,
  mirror body, and metadata.
- Task Contract fields are mapped from the installed version; absent fields are
  extensions.
- Profiles are capability metadata; unknown is false; registry does not select.
- Phase C persists actual mechanism, source, ID, paths, commands, and validation.
- Phase D specifies classification precedence, transitions, counters, evidence
  fields, invalid cases, and storage behavior.
- Phase E has one exact fail-closed bridge choice and preserves all current
  non-executable decisions without a router call or fallback.
- Phase F/G select real repository candidates, persist exact paths, require
  human approval, execute exact gates, and stage exact task-owned files.
- Phase H spells out native, generic, ADR, manifests, default refresh, rollback,
  and final verification.

*End of implementation plan — revision 4.*
