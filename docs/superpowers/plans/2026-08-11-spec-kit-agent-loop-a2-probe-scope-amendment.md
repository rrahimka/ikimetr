# İkiMetr Spec Kit + Agent Loop — A2 Probe-Scope Amendment

**Status:** Mechanical efficiency correction to the approved implementation plan.

**Applies to:** `docs/superpowers/plans/2026-08-11-spec-kit-agent-loop-implementation.md`, Phase A, Task A2 only.

**Scope:** This amendment changes only which integration keys receive full disposable init/install/use/uninstall probes. Every other A2 requirement, security invariant, argv rule, cleanup rule, evidence rule, and commit gate remains unchanged.

## Why this correction is required

Spec Kit v0.16.2 exposes a broad built-in integration catalog. Probing every built-in coding-agent integration would multiply temporary projects, file inventories, install/use/uninstall exercises, evidence artifacts, runtime, and review cost without improving İkiMetr's near-term architecture.

The approved İkiMetr design does not require a one-time exhaustive compatibility matrix for every coding agent supported by Spec Kit. It requires a safe native-first integration path for the coding harnesses relevant to the project, while keeping a generic fallback for future agents.

Therefore A2 must still discover the complete set exposed by the pinned local CLI, but full mutation probes are bounded to the project-relevant target set below.

## Authoritative A2 target set

The ordered target set is:

```text
codex
claude
qwen
opencode
agy
generic
```

Rationale:

- `codex`: current primary high-value coding agent.
- `claude`: planned coding agent.
- `qwen`: current low-cost coding agent.
- `opencode`: previously selected candidate for a unified coding harness when direct implementation work expands.
- `agy`: Antigravity integration already relevant to the user's development environment.
- `generic`: required future-proof fallback for DeepSeek/local/future coding harnesses that do not have a native Spec Kit integration.

No provider/model routing is introduced here. This is coding-harness integration discovery only.

## Corrected discovery and persistence rule

A2 must:

1. Run the pinned local CLI's actual global and `init --help` commands exactly as already required.
2. Record the complete discovered integration-key set in `phase-a2-probes.md` for evidence only.
3. Intersect that discovered set with the authoritative target set above.
4. Persist only the confirmed intersection, in the target-set order above, to `phase-a2-integration-keys.txt`.
5. For a target key not exposed by the pinned CLI, record `NOT_AVAILABLE` for that key in the summary and do not invent argv or force support.
6. Full disposable init/status/install/use/uninstall probing is required only for keys persisted in `phase-a2-integration-keys.txt`.
7. Do not probe unrelated built-in or community integrations merely because the pinned CLI lists them.

If none of `codex`, `claude`, or `qwen` is available, stop with `BLOCKED_ARCHITECTURE` before creating mutation-probe evidence. `generic` alone is not sufficient to silently replace all native options.

## Per-key probe requirements unchanged

For every persisted key, retain the original A2 contract:

- one separate base probe under a validated `/tmp/ikimetr-spec-kit-probe-${key}-...` path;
- exact literal `init.argv` validated and executed as an argv array;
- generic-only options remain confined to the generic probe;
- project-local integration commands run only after disposable initialization;
- status is read-only;
- install/use/uninstall mutation exercises run only in a second throwaway copy/probe so the base probe remains evidence;
- pre/post path inventories and SHA-256 evidence are recorded;
- `UNINSTALL_MANIFEST_SAFE=true` only when the original strict condition is proven;
- unsupported operations contain the single literal `NONE`;
- workflow namespace/capabilities are discovered from actual help/generated files;
- every recursive removal is restricted to a validated task-owned `/tmp` prefix and never a project path.

## Evidence and ownership

`phase-a2-owned-files.txt` remains the sole authorization source for the A2 commit. It must be created before the first A2 repository artifact write and contain only A2-owned evidence paths.

The complete discovered integration catalog is evidence, not commit authorization and not a mandate to probe every key.

## Commit and next-step rule

A2 may commit with the original message only after all persisted target integrations satisfy the original acceptance/security/scope gates:

```text
chore: record pinned Spec Kit disposable probes
```

Do not start A3 in the same task. A3 remains the human/default-integration gate and must consume only the confirmed target keys persisted by A2.

## Security invariants unchanged

- No command-string execution or `eval`.
- No project-local pre-init integration mutation.
- No arbitrary integration or provider selection.
- No force flags unless explicitly required by a later human-approved task.
- No secret material in evidence.
- No deletion outside validated task-owned `/tmp` probe paths.
- No production code, `AGENTS.md`, AI cost routing, or provider/model behavior changes.
- Ollama/local-model execution is not required for A2 and must remain unloaded.
