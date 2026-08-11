# İkiMetr Spec Kit + Agent Loop — A0 Security Fixture Amendment

**Status:** Mechanical security-fixture correction to the approved implementation plan.

**Applies to:** `docs/superpowers/plans/2026-08-11-spec-kit-agent-loop-implementation.md`, Phase A, Task A0 only.

**Scope:** This amendment supersedes only the synthetic GitHub PAT fixture and its exit-code assertion in Task A0. Every other A0 requirement, file allowlist, scanner-selection rule, security gate, staging rule, and stop condition remains unchanged.

## Why this correction is required

Task A0 revision 4 used:

```bash
printf 'token=ghp_%036d\n' 0 > /tmp/a0-fake-secret.txt
```

With the pinned scanner selected during A0 (`gitleaks v8.30.1`), that produces `ghp_` followed by 36 zeroes. The official `github-pat` rule in gitleaks v8.30.1 requires both:

- the lexical form `ghp_[0-9a-zA-Z]{36}`; and
- entropy of at least `3`.

A 36-zero suffix has effectively zero character entropy, so it is intentionally not a valid positive fixture for that rule. The official rule's own true-positive generator uses a 36-character alphanumeric secret, while low-entropy repeated-character examples are treated as false positives.

This is a defect in the test fixture, not a reason to weaken the scanner, disable entropy checking, change the pinned scanner, or bypass `BLOCKED_SECURITY`.

## Corrected mandatory fixture

Use this exact deterministic synthetic value instead:

```bash
printf '%s\n' 'token=ghp_0123456789abcdefghijklmnopqrstuvwxyz' > /tmp/a0-fake-secret.txt
```

The suffix is exactly 36 alphanumeric characters and has sufficient character diversity for the pinned gitleaks rule while remaining a synthetic, non-credential fixture.

## Corrected mandatory assertion

The wrapper contract distinguishes a finding (`1`) from scanner/runtime failures. Therefore the fixture gate must require **exactly exit code 1**, not merely any nonzero status:

```bash
set +e
bash tools/secret-scanner/scan.sh -- /tmp/a0-fake-secret.txt
FAKE_SECRET_STATUS=$?
set -e

if [ "$FAKE_SECRET_STATUS" -ne 1 ]; then
  printf '%s\n' "BLOCKED: fake secret expected finding status 1, got $FAKE_SECRET_STATUS" >&2
  exit 1
fi
```

A status of `0` means the synthetic secret was missed and remains `BLOCKED_SECURITY`. A status greater than `1` is a scanner/runtime failure and also remains blocked.

## Resume rule for the currently blocked A0 execution

The current A0 run may resume from its existing five authorized untracked files and pinned external scanner binary only after all of the following are revalidated:

1. branch and expected ancestor are correct;
2. no unexpected tracked, untracked, or staged repository changes exist;
3. the five existing A0 files are still the only A0 repository mutations;
4. the pinned scanner path, tag, and SHA-256 still match the recorded A0 evidence;
5. this amendment is present in the local branch history.

Then rerun, in order:

1. wrapper generation if needed from the already validated scanner metadata;
2. clean fixture;
3. corrected synthetic GitHub PAT fixture above, requiring exit code exactly `1`;
4. wrapper self-scan;
5. exact five-file scanner gate;
6. exact scope/staging/diff checks from Task A0.

Do not repeat scanner selection/download when the persisted scanner identity and live binary hash revalidate exactly. Do not start A1. Do not commit the five A0 files until independent review authorizes it.

## Security invariants unchanged

- No real credential is used or persisted.
- Scanner entropy requirements remain enabled.
- No allowlist is added for the fixture.
- No scanner configuration is weakened.
- No fallback scanner is introduced.
- Findings remain exit code `1`; scanner/runtime failures remain distinct and blocking.
- Task A0's five-file repository mutation boundary remains unchanged.
