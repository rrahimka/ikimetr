# İkiMetr Spec Kit + Agent Loop — A0 Security Fixture Amendment

**Status:** Mechanical security-fixture correction to the approved implementation plan, revision 2.

**Applies to:** `docs/superpowers/plans/2026-08-11-spec-kit-agent-loop-implementation.md`, Phase A, Task A0 only.

**Scope:** This amendment supersedes only the synthetic GitHub PAT fixture and its exit-code assertion in Task A0. Every other A0 requirement, file allowlist, scanner-selection rule, security gate, staging rule, and stop condition remains unchanged.

## Why this correction is required

Task A0 revision 4 originally used:

```bash
printf 'token=ghp_%036d\n' 0 > /tmp/a0-fake-secret.txt
```

That produces `ghp_` followed by 36 zeroes. The pinned scanner selected during A0 is gitleaks v8.30.1. Its official `github-pat` rule requires:

- lexical form `ghp_[0-9a-zA-Z]{36}`; and
- entropy of at least `3`.

The 36-zero suffix therefore is not a valid positive fixture for that rule.

The first amendment replaced it with:

```text
ghp_0123456789abcdefghijklmnopqrstuvwxyz
```

That suffix has sufficient entropy, but the pinned gitleaks v8.30.1 global allowlist contains the stopword `abcdefghijklmnopqrstuvwxyz`. Gitleaks stopwords are applied to the detected secret case-insensitively by substring matching, so the first amended fixture is intentionally suppressed as well.

This remains a fixture defect. It is not a reason to weaken the scanner, disable entropy checking, remove stopwords, change the pinned scanner, add an allowlist exception, or bypass `BLOCKED_SECURITY`.

## Revision 2 mandatory fixture

Use this exact deterministic synthetic value:

```bash
printf '%s\n' 'token=ghp_A1B2C3D4E5F6G7H8J9K0L1M2N3P4Q5R6S7T8' > /tmp/a0-fake-secret.txt
```

The suffix is exactly 36 alphanumeric characters. Its Shannon entropy is approximately `4.72548`, above the rule threshold of `3`.

Its lowercase form is:

```text
a1b2c3d4e5f6g7h8j9k0l1m2n3p4q5r6s7t8
```

It does not contain either stopword present in the pinned v8.30.1 global base configuration:

- `abcdefghijklmnopqrstuvwxyz`
- `014df517-39d1-4453-b7b3-9930c563627c`

It is synthetic and is not a real credential.

## Mandatory preflight before the wrapper fixture gate

Before treating the revision 2 fixture as authoritative evidence, probe the exact pinned scanner directly against the exact fixture without weakening configuration:

```bash
set +e
"$SCANNER_PATH" dir --no-banner --no-color --redact --report-format json --report-path /tmp/a0-direct-fixture-report.json -- /tmp/a0-fake-secret.txt
DIRECT_FIXTURE_STATUS=$?
set -e

rm -f -- /tmp/a0-direct-fixture-report.json

if [ "$DIRECT_FIXTURE_STATUS" -ne 1 ]; then
  printf '%s\n' "BLOCKED: direct pinned-scanner fixture expected finding status 1, got $DIRECT_FIXTURE_STATUS" >&2
  exit 1
fi
```

Use only the exact CLI form already confirmed by the pinned scanner's real `dir --help` during A0. If the persisted confirmed argv differs mechanically from the example above, load and execute the already validated literal argv form instead; do not invent flags or weaken scanner behavior.

A direct result other than exactly `1` is still `BLOCKED_SECURITY` and must stop execution before wrapper self-scan or staging.

## Corrected mandatory wrapper assertion

After direct preflight succeeds, the wrapper must independently detect the same exact fixture and return exactly exit code `1`:

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

Interpretation:

- `0` = fixture was missed → `BLOCKED_SECURITY`;
- `1` = expected finding → PASS for this gate;
- `>1` = scanner/wrapper failure → `BLOCKED_SECURITY`.

## Resume rule for the currently blocked A0 execution

The current A0 run may resume from its existing five authorized untracked files and pinned external scanner binary only after all of the following are revalidated:

1. branch contains this revision 2 amendment commit and remains a descendant of the approved A0 start lineage;
2. no unexpected tracked, untracked, or staged repository changes exist;
3. the five existing A0 files are still the only A0 repository mutations;
4. the five existing A0 files remain byte-for-byte identical to the hashes reported at the prior block unless a change is explicitly required by this amendment;
5. the pinned scanner repository, tag, asset, path, version, and SHA-256 still match the recorded A0 evidence;
6. no scanner configuration, entropy threshold, stopword list, allowlist, or provider/tool policy was weakened.

Then rerun, in order:

1. wrapper generation only if required from already validated scanner metadata;
2. clean fixture;
3. create the revision 2 synthetic GitHub PAT fixture;
4. direct pinned-scanner preflight, requiring exit code exactly `1`;
5. wrapper fixture gate, requiring exit code exactly `1`;
6. wrapper self-scan;
7. exact five-file scanner gate;
8. exact scope/staging/diff checks from Task A0.

Do not repeat scanner selection/download when the persisted scanner identity and live binary hash revalidate exactly. Do not rerun the full five-command baseline solely because this fixture amendment changed; the previously completed baseline evidence remains the A0 baseline unless repository/product/test/config state changed outside this amendment. If such state changed, stop and restart baseline verification.

Do not start A1. Do not commit the five A0 files until independent review authorizes it.

## Security invariants unchanged

- No real credential is used or persisted.
- Scanner entropy requirements remain enabled.
- Global stopword behavior remains enabled.
- No allowlist is added for the fixture.
- No scanner configuration is weakened.
- No fallback scanner is introduced.
- Findings remain exit code `1`; scanner/runtime failures remain distinct and blocking.
- Task A0's five-file repository mutation boundary remains unchanged.
- Direct preflight and wrapper detection must agree on the same exact synthetic fixture.
