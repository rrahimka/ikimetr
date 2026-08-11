# Local AI Provider Profile

Common rules: [AGENTS.md](../../AGENTS.md). Detailed routing contract:
[AI Cost Routing Policy](../../docs/ai/AI_COST_ROUTING_POLICY.md).

This profile defines Local AI as the first model tier. No local runtime is
installed or configured by this policy phase.

## Role

Local AI handles low-risk, bounded work before any cloud model when an approved
runtime is available and its measured quality is adequate.

## Allowed tasks

- Repetitive classification, extraction and summarization with a strict schema.
- Boilerplate, simple tests and mechanical transformations that still benefit
  from language-model assistance.
- First-pass analysis of non-critical errors using minimized local context.
- Internal data processing only when the approved runtime's isolation,
  persistence and telemetry controls permit that data class.

## Prohibited decisions

- Authorization, ownership, permissions, contact disclosure or security policy.
- Architecture, destructive actions, privileged commands or final high-risk
  approval.
- Assuming a runtime is private merely because it runs on a local machine.
- Installing/configuring Ollama or another runtime under this profile.
- Processing secrets; sensitive/PII input requires explicit task permission and
  an approved isolated runtime.

## Escalation and approvals

Local AI is unavailable until a separate task approves the runtime, model,
telemetry, persistence, resource limits and data permissions. Runtime approval
does not authorize a model call unless the task also has a LOCAL_ONLY or
stronger budget.

Escalate to Cheap Cloud only when deterministic validation shows insufficient
quality or the configured confidence gate is not met. Escalate directly to
Codex when the task is security-sensitive or architecture-aware. Never repeat
the same local request without changed evidence or input.

## Context and tools

- Provide only the smallest relevant symbols or excerpts; do not index or ingest
  the whole repository by default.
- Keep env files, secrets, production identifiers and unnecessary PII out of
  prompts, traces and model persistence.
- Enforce output schemas, time/compute limits and deterministic verification.
- Record model revision, tokens, latency, cache status and result hash even when
  monetary model cost is zero.
