# Phase A0 secret-scanner selection

Latest non-draft, non-prerelease GitHub release metadata was queried on 2026-08-11 before any asset download.

| Repository | Latest tag | Published UTC | WSL installation form | Pinning method | Standalone Linux x64 asset |
| --- | --- | --- | --- | --- | --- |
| `gitleaks/gitleaks` | `v8.30.1` | `2026-03-21T02:17:58Z` | Standalone Linux x64 tar archive | GitHub tag, exact asset, binary SHA-256 | Yes: `gitleaks_8.30.1_linux_x64.tar.gz` |
| `Yelp/detect-secrets` | `v1.5.0` | `2024-05-06T18:05:06Z` | Python package | Release tag / exact Python package version | No |
| `trufflesecurity/trufflehog` | `v3.96.0` | `2026-07-24T18:23:23Z` | Standalone Linux amd64 tar archive | GitHub tag, exact asset, binary SHA-256 | Yes: `trufflehog_3.96.0_linux_amd64.tar.gz` |
| `secretlint/secretlint` | `v13.0.4` | `2026-07-22T01:05:38Z` | Node/npm package | Release tag / exact npm package version | No |

## Deterministic selection

- Rule: select gitleaks only when its latest tag is strict `vMAJOR.MINOR.PATCH` and exactly one asset has the literal name derived as `gitleaks_VERSION_linux_x64.tar.gz`.
- Outcome: pass; the exact match count was one.
- Repository: `gitleaks/gitleaks`
- Tag: `v8.30.1`
- Asset: `gitleaks_8.30.1_linux_x64.tar.gz`
- Asset URL: `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz`
- Published UTC: `2026-03-21T02:17:58Z`
- Validation: the persisted literals matched `gh release view` for the exact tag before download.
- Binary path: /home/rahim/.local/bin/gitleaks-v8.30.1
- Binary SHA-256: 88f91962aa2f93ac6ab281d553b9e125f5197bbbce38f9f2437f7299c32e5509

## Installation and CLI validation

- The resolved uv tool directory was the existing, user-writable, nonsymlink directory /home/rahim/.local/bin.
- The download directory used the required /tmp/ikimetr-gitleaks- prefix, resolved beneath /tmp, and was removed after extraction.
- The installed binary reported version 8.30.1.
- The real dir help confirmed literal file sources, JSON reports, redaction, a report path, no banner, and no color.
- The literal separator and fixed arguments in phase-a0-scanner.env passed a clean single-file probe.
- The clean probe returned status 0 with an empty JSON report at mode 0600.

No fallback scanner was selected.
