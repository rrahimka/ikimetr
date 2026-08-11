# Cheap Cloud AI Provider Profile

Common rules: [AGENTS.md](../../AGENTS.md). Detailed routing contract:
[AI Cost Routing Policy](../../docs/ai/AI_COST_ROUTING_POLICY.md).

This profile applies to approved DeepSeek/Qwen-class providers and narrows the
common policy.

## Role

Cheap Cloud AI handles well-specified, low-risk work that is not adequately
served by deterministic tools or an approved Local AI runtime.

## Allowed tasks

- Boilerplate and mechanical CRUD from an explicit specification.
- Simple DTO/schema translation and low-risk helper functions.
- Repetitive tests, documentation updates and formatting-oriented changes.
- Basic refactors and simple UI components with deterministic acceptance checks.
- First-pass analysis of non-critical, reproducible errors.

## Prohibited decisions

- Architecture, authentication strategy, permissions, ownership or privacy
  policy design.
- Sole approval of security-sensitive or production-critical work.
- Ambiguous database/schema design or destructive migration decisions.
- Processing data classes not approved for the selected cloud provider.
- Expanding task scope or inventing missing business rules.

## Escalation and approvals

Escalate to Codex when the task becomes cross-module, security-sensitive,
architecturally ambiguous, conflicts with project documentation or fails
deterministic verification after the allowed attempt. Record the exact open
question and reuse the existing evidence instead of rerunning the same prompt.

Provider use requires an approved provider entry and an available
CHEAP_ALLOWED or stronger budget. A higher budget does not expand task or data
permissions.

## Context and tools

- Supply a compact task packet: specification, exact files/symbols, interfaces,
  relevant tests and acceptance commands.
- Do not include unrelated modules, full repository history, secrets or raw PII.
- Prefer patch-oriented output and structured findings that deterministic tools
  can validate.
- Return assumptions explicitly; uncertainty triggers escalation rather than
  architecture invention.
