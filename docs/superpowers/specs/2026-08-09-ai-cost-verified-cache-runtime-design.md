# AI Cost Verified Cache Runtime Design

**Status:** Approved

**Scope:** Phase 3C only. This design adds a repository-local verified cache
runtime above the Phase 3B cache-key, protected-input, ledger, and single-flight
foundations in `@ikimetr/ai-cost-system`.

## Constraints

- Store cache data only below repository-local `.ai-cost/cache/`.
- Use immutable content-addressed revisions. Do not use a mutable single-file
  cache and do not split metadata and payload into separately published files.
- Do not add a database, Redis, migrations, dependencies, provider calls,
  routing, PromptBuilder, Verification/Fix Loop, Ollama, or cloud adapters.
- Do not read env values, execute shell commands, or persist raw prompts, raw
  source, raw logs, secrets, env values, or raw PII.
- Keep `apps/web`, `apps/api`, `apps/worker`, database, migrations, business
  logic, provider profiles, AI policy, and Phase 3B budget behavior unchanged.

## Storage model

Each cache record is one strict canonical JSON document containing metadata,
payload, verification evidence, provenance, and its checksum. The final path is:

```text
.ai-cost/cache/<namespace>/<cache-key-prefix>/<cache-key>/<entry-hash>.json
```

`namespace` is an allowlisted enum. Cache keys and entry hashes are lowercase
SHA-256 values. No task, provider, model, payload, or user string participates
directly in a path.

Writes use a temporary file in the destination directory, exclusive no-follow
creation, complete write, file `fsync`, close, and atomic rename. A revision is
never overwritten. An already-present byte-identical revision is idempotent;
different revisions remain visible for deterministic lineage validation.

Every directory component is checked to be inside the real repository root and
not a symbolic link. A symlink, non-regular final file, malformed JSON, partial
record, unexpected filename, invalid schema, or checksum mismatch is fail-closed.

## Entry schema and content integrity

The strict entry includes at least:

- `schema_version`, `entry_id`, `entry_hash`, `parent_entry_hash`;
- `cache_key`, `namespace`, `state`, `task_type`, `route`, `provider`;
- `model_revision`, `prompt_version`, `policy_version`, `config_hash`;
- `verification_profile_hash`, `task_spec_hash`, ordered `input_hashes`;
- `diff_hash`, `error_fingerprint`, `result_hash`, `patch_hash`;
- `verification_evidence_hash`, `created_at`, `expires_at`;
- strict `provenance`, `data_class`, tool/dependency versions;
- exactly one strict payload representation or a state-appropriate null payload.

`entry_hash` is SHA-256 over the canonical entry with `entry_hash` omitted. It
covers metadata, payload, evidence, and provenance. `result_hash` covers the
canonical plaintext result. Verification evidence has its own canonical hash.

Public and internal payloads use a strict envelope with an allowlisted result
kind and a canonical JSON value. The runtime rejects unsupported JSON values,
non-finite numbers, prohibited raw-content/PII field names, secret-like keys or
values, and values beyond the explicitly supplied byte ceiling. The runtime
does not claim semantic PII detection; the caller remains responsible for
correct data classification and minimization.

## Sensitive and secret data

Secret data is never persistent-cache eligible.

Sensitive persistent caching is denied unless all of the following hold:

1. The ledger contains an effective approved `ApprovalEvent` for the task and
   `sensitive-cache` scope, with no later denial or revocation.
2. Input protection is `hmac-sha256`; low-entropy identifiers are never plain
   SHA-256 preimages.
3. An injected local `SensitiveCacheCodec` is available.
4. An injected HMAC implementation is available for plaintext integrity.

The codec receives canonical bytes and returns a strict sealed envelope. The
package neither implements key management nor reads a codec/key from env.
Without approval, HMAC, or codec, writes and reads fail closed. Persistent
entries contain only the sealed payload and non-secret metadata.

## State machine

Allowed lifecycle transitions are:

```text
none -> pending
pending -> unverified
pending -> negative
unverified -> verified
unverified -> negative
pending|unverified|verified|negative -> quarantined
```

`negative -> verified`, `quarantined -> verified`, and every transition out of
`quarantined` are rejected. `verified` and `negative` are terminal within one
lineage except for quarantine caused by integrity failure.

An expired negative result may be recomputed only as a new lineage that records
the terminal revision it supersedes. It is not a `negative -> verified`
transition. A unique valid head is required. Conflicting roots, parents,
children, provenance, or transition sequences quarantine the lookup rather
than selecting a winner.

Only a dedicated verification-publication method can create `verified`. It
requires an injected `VerificationAuthority` to validate the evidence. Generic
provider/untrusted write methods accept only `pending`, `unverified`, and
policy-allowed `negative` outcomes.

## Verification evidence

Evidence metadata is strict and contains:

- required and completed stage IDs;
- one result for each completed stage;
- allowlisted command ID, exit code, evidence hash, and tool version;
- bounded duration and UTC `verified_at`;
- trusted authority ID/version and verification profile hash.

Every required stage must be completed successfully, with no duplicate or
unknown command IDs. Command IDs must be enabled by the immutable verification
configuration. The evidence profile and compatibility context must match the
entry. The runtime validates supplied evidence but never executes commands.
Phase 3C tests use an injected trusted fixture authority.

## Lookup and invalidation

A lookup supplies the full expected compatibility context and recomputes the
cache key. Verified reuse requires:

- a unique schema-valid `verified` lineage head;
- unexpired TTL;
- exact policy, config, prompt, route, provider/model, task/input, diff, error,
  tool/dependency, verification-profile, and data-policy compatibility;
- valid entry, result, payload, evidence, and provenance hashes;
- effective data permission and a matching trusted authority;
- a matching successful cache write event in ledger replay.

Expected-version or TTL differences are deterministic misses/invalidation, not
corruption. Corrupt internal provenance, checksum, evidence, lineage, or audit
linkage is quarantine. Stale valid revisions are retained and ignored.

Negative cache entries require a separate explicit expiry. A null negative TTL
disables negative persistence. Transient failures are cacheable only when an
explicit runtime policy allows their reason class; provider outage alone is
never proof that a task is impossible.

## Ledger integration

The strict `CacheEvent` action set supports:

```text
lookup, hit, miss, write, invalidate, quarantine,
negative-hit, verified-reuse
```

Events contain only hashes, enum metadata, identifiers, timestamps, and reason
codes. No raw content is logged.

The runtime allocates the cache write event ID before publishing an entry,
stores that ID in provenance, atomically publishes the entry, then appends and
syncs the ledger event. An entry without a corresponding successful ledger
event is unaudited and never reusable. Lookup/audit append failure also denies
reuse.

## Single-flight integration

The existing process-local `SingleFlight` instance coordinates by validated
cache/request fingerprint. Concurrent callers share exactly one operation.
The in-memory key is removed after success or failure, so a process crash cannot
leave a persistent lock. Cross-process safety comes from immutable revisions
and deterministic conflict quarantine, not a mutable lock file.

## Errors and recovery

- Validation, storage, transition, evidence, security, compatibility, and audit
  failures use typed errors and never return a reusable artifact.
- Malformed, partial, checksum-invalid, or provenance-conflicting entries are
  rejected and emit a quarantine event when the ledger remains writable.
- The runtime does not repair, truncate, overwrite, or silently delete stale or
  corrupt cache data in Phase 3C.
- No cache garbage collector, mutable head index, snapshot, distributed lock,
  or recovery UI is added.

## Test strategy

Use TDD with real temporary repositories, actual atomic file operations, and
the real append-only ledger. Tests cover valid write/read, deterministic paths,
traversal and symlink denial, malformed/partial data, checksums, provenance,
the complete state machine, verified evidence and compatibility, TTL and
negative policy, public/internal payload canonicalization, sensitive approval
and injected cryptography gates, secret/PII/raw-field rejection, ledger events,
and process-local single-flight behavior.

Full verification runs from a WSL-native checkout using the approved
loopback-only temporary Compose procedure. Phase 3D is not started.

## Self-review

- **Duplication:** Phase 3B key/HMAC/single-flight/ledger code is reused; Phase
  3C adds storage and orchestration instead of parallel replacements.
- **Cache poisoning:** strict construction APIs, immutable revisions, trusted
  verification publication, ledger linkage, and lineage ambiguity quarantine
  prevent provider self-promotion and untrusted overwrite.
- **Crash safety:** one canonical entry per revision prevents metadata/payload
  tearing; no mutable pointer or persistent lock is introduced.
- **Privacy:** raw prompt/log/source/PII fields and secret-like data are denied;
  Sensitive requires scoped approval, HMAC, and an injected sealed codec.
- **Residual risk:** deterministic scanners cannot prove that an arbitrary
  string contains no hidden PII. Correct upstream classification and result
  minimization remain mandatory and are enforced again by the caller-facing
  data-class contract.
- **YAGNI:** no router, provider, command runner, cache GC, framework, database,
  Redis, distributed lock, or production TTL is added.
