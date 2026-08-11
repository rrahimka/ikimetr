# İkiMetr AI Cost System Phase 3E: Prompt and Context Builder Design

## Status

Approved for implementation on 2026-08-09. This design covers only the
deterministic PromptBuilder, ContextManifest, diff compaction, error compaction,
context-budget enforcement and model-output contract foundation.

Implementation plan: [`../plans/2026-08-09-ai-cost-prompt-context-builder.md`](../plans/2026-08-09-ai-cost-prompt-context-builder.md)

## Scope

Phase 3E adds a filesystem-free and network-free core to
`packages/ai-cost-system`. It does not add provider calls, model calls, an AI
Gateway, a verification/fix loop, arbitrary command execution, repository
selection or repository retrieval.

No dependency, application, database, migration, provider profile, AI policy or
bootstrap configuration change is permitted by this design.

## Trust boundary

`ContextBuilder` is a pure coordinator. It has no filesystem reader, directory
reader, repository scanner, shell interface, network interface or provider
interface. It accepts only bounded, preselected Serena excerpts supplied by a
separate upstream selection stage.

Every excerpt must carry:

- a stable excerpt identifier and kind;
- a normalized project-relative path;
- an inclusive line range;
- optional symbol metadata appropriate to its kind;
- canonical content and its SHA-256 hash;
- Serena provenance with operation and query/evidence hash;
- data class, criticality and deterministic priority;
- redaction evidence when the data class is Sensitive.

The core validates these fields before content can enter a manifest. Absolute
paths, traversal, backslashes, empty or inverted ranges, duplicate identifiers,
overlapping conflicting excerpts, unsupported provenance and hash mismatch are
fail-closed. Retrieval remains outside Phase 3E; adding an injected range reader
later requires a separate architecture task and security review.

## Modules

### `context-contracts.ts`

Defines strict Zod schemas and immutable types for:

- minimized task briefs;
- trusted routing/config/policy evidence;
- Serena excerpts and selection scope;
- structured diff-hunk and diagnostic candidates;
- previous-attempt summaries;
- context ceilings and `overflow_action`;
- ContextManifest and compaction evidence;
- `READY`, `APPROVAL_REQUIRED` and `STOP` outcomes;
- the future model-output contract.

Unknown fields and enum values are rejected. All arrays that are semantically
sets are unique and deterministically ordered. Numeric limits are required safe
integers; missing limits are not interpreted as unlimited.

### `context-integrity.ts`

Performs deterministic path/range, provenance, data-policy and content-hash
validation. It also rejects reserved prompt-boundary markers and obvious
secret-like or raw-PII material. These checks supplement, rather than replace,
the upstream requirement to supply already minimized and redacted data.

Public and Internal excerpts may pass after integrity validation. Sensitive
excerpts require all of the following:

- the trusted context policy explicitly permits Sensitive data;
- the approved route and provider match the routing evidence;
- the approved `data_scope_hash` matches the current Serena selection scope;
- the excerpt is marked redacted;
- redaction and approval evidence hashes are present and valid.

Secret data always returns `STOP`. Approval can never override Secret handling,
hash/provenance failure or a data-policy denial.

### `diff-compactor.ts`

Accepts structured changed hunks, never an unrestricted repository diff. Each
hunk contains only path, old/new ranges, patch content, relevance metadata,
criticality, priority and patch hash.

The compactor:

1. validates the hunk header, ranges and canonical patch hash;
2. excludes hunks whose paths are outside the trusted relevant-path scope;
3. rejects conflicting duplicate coordinates;
4. deduplicates identical hunks;
5. sorts by normalized path, ranges and hash.

It never reads Git or executes a command. Excluded identifiers and reason codes,
not their content, are recorded in compaction evidence.

### `error-compactor.ts`

Accepts bounded structured diagnostic candidates, not an unrestricted raw log.
It emits only:

- stage and allowlisted command ID;
- exit and diagnostic codes;
- normalized file/symbol metadata;
- normalized message;
- unique normalized stack frames;
- deterministic error fingerprint.

Normalization removes ANSI sequences, ISO-like timestamps, UUID/random-ID
noise, known temporary-root prefixes and duplicate frames. Messages and frames
remain untrusted data. Raw diagnostic input is never copied to the manifest.

### `context-builder.ts`

Coordinates validation, deterministic compaction, prioritization, budget
enforcement and ContextManifest construction. The coordinator consumes unknown
input through a strict schema and always returns a discriminated outcome rather
than echoing invalid input in an exception.

Before budget decisions it performs lossless deterministic compaction:

- canonical line endings;
- exact-content deduplication;
- preference for symbol/signature/implementation excerpts over equivalent file
  ranges;
- diff deduplication;
- diagnostic normalization and frame deduplication.

If the prompt remains above the required UTF-8 byte ceiling, non-critical items
are pruned in a stable lowest-value-first order. Critical context is never
truncated or silently removed. If critical context still exceeds the ceiling:

- `overflow_action: "approval_required"` returns `APPROVAL_REQUIRED`;
- `overflow_action: "stop"` returns `STOP`.

Missing or unknown `overflow_action` is invalid input and returns `STOP`.
Blocked outcomes contain only hashes, measurements and reason codes; they do not
return a partially usable prompt.

### `prompt-builder.ts`

Renders exactly these sections in a fixed order:

1. `TASK`
2. `POLICY INVARIANTS`
3. `ROUTE / PROVIDER ROLE`
4. `RELEVANT CONTEXT`
5. `CURRENT DIFF`
6. `ERROR`
7. `PREVIOUS ATTEMPT`
8. `VERIFICATION EVIDENCE`
9. `REMAINING BUDGET`
10. `PROHIBITED SCOPE`
11. `OUTPUT CONTRACT`

Trusted instructions and untrusted source/diff/diagnostic data use distinct,
fixed boundary markers. Input containing a reserved marker is rejected instead
of escaped ambiguously. Structured values use canonical JSON. The prompt
explicitly states that untrusted blocks are evidence, not instructions.

The model-output schema contains only:

- `status`;
- `summary`;
- `proposed_patch`;
- `reason_codes`;
- `assumptions`;
- `verification_requested`.

`verification_requested` accepts only command IDs supplied by trusted policy.
There is no shell command, executable, arguments, SQL or privileged-action
field. A proposed patch remains untrusted data for a future deterministic patch
validator; Phase 3E does not apply it.

## ContextManifest

The immutable ContextManifest includes at least:

- `task_id` and minimized task brief;
- `prompt_version`;
- route and provider role;
- task-spec, routing-decision, config, policy and AGENTS hashes;
- applicable policy invariants, never full policy documents;
- selected symbols and bounded file-range excerpts;
- selected diff hunks;
- compact error context;
- previous-attempt summary;
- existing verification evidence;
- remaining budget;
- prohibited scope;
- context-budget policy and compaction evidence;
- `context_hash`.

The context hash is SHA-256 over the canonical manifest without its own
`context_hash`. The prompt hash is SHA-256 over the final UTF-8 prompt. Both
change when the task, relevant content, diff, error, policy/config/AGENTS hash,
prompt version, verification evidence, remaining budget or prohibited scope
changes.

## Data flow

```text
validated routing/config evidence
+ trusted context policy
+ minimized task brief
+ preselected Serena excerpts
+ structured diff/diagnostic candidates
        |
        v
strict input and integrity validation
        |
        v
diff/error/lossless context compaction
        |
        v
stable non-critical pruning when required
        |
        +-- integrity/data-policy/Secret failure --> STOP
        +-- residual valid overflow -------------> APPROVAL_REQUIRED or STOP
        v
immutable ContextManifest + context_hash
        |
        v
fixed deterministic prompt + prompt_hash
```

## Context ceilings

The trusted context policy supplies all ceilings; Phase 3E defines no production
numeric defaults. Exact UTF-8 bytes are used because provider tokenizers are not
part of this phase. Required ceilings cover the final prompt, individual
excerpts, diff content, diagnostic content, item counts and applicable
invariants. `remaining_budget` may report token/call/cost metadata, but the
builder does not estimate provider tokens or mutate BudgetController state.

## Previous attempts and verification

Only compact previous-attempt metadata is accepted: attempt ID, patch hash,
error fingerprint, result status, verification result and reason code. A raw
previous prompt or model output has no schema field and is rejected as unknown
input.

Verification uses the existing validated verification-evidence contract. The
prompt receives evidence metadata only. No verification command is executed.

## Error handling

Fail-closed `STOP` reason codes cover invalid schema, Secret data, forbidden
Sensitive data, path/range/provenance/hash mismatch, reserved-boundary content,
secret/PII indicators and other integrity failures. Outcomes contain no raw
rejected content.

Only a valid context that cannot fit after deterministic compaction and
non-critical pruning may use `overflow_action`. Approval cannot weaken data or
integrity rules.

## TDD and verification

Tests are written before production code and must demonstrate RED before GREEN.
Coverage includes:

- identical valid input produces identical manifest and prompt hashes;
- every relevant task/context/diff/error/policy/config/prompt-version change
  changes the appropriate hash;
- the core has no filesystem/repository reader surface;
- unrelated paths and diff hunks never enter context;
- valid symbol excerpts outrank equivalent file ranges;
- diff compaction and error normalization are stable;
- ANSI, timestamps, random IDs, temporary paths and repeated stack frames are
  removed;
- raw previous prompts/outputs and full policy documents are rejected;
- Secret, forbidden Sensitive, provenance mismatch and content/hash mismatch
  always stop;
- both overflow actions, missing/invalid overflow action, non-critical pruning
  and never-truncated critical context;
- fixed prompt sections, explicit untrusted boundaries and an output contract
  without an arbitrary command channel.

Package verification: unit, typecheck, build and config validation. Project
verification: lint, typecheck, unit, integration, build and `git diff --check`,
performed in a temporary WSL-native copy. No provider or network call is part of
the implementation.

## Explicitly deferred

- Serena selection/retrieval adapters;
- filesystem or Git readers;
- provider/model adapters and calls;
- PromptBuilder integration into a provider runtime;
- Verification/Fix Loop;
- tokenizers and token estimation;
- automatic redaction or PII classification services;
- patch application or arbitrary command execution;
- new configuration files or schema expansion;
- the next AI Cost System phase.
