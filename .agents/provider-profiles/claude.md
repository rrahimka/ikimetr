# Claude Provider Profile

Common rules: [AGENTS.md](../../AGENTS.md). Detailed routing contract:
[AI Cost Routing Policy](../../docs/ai/AI_COST_ROUTING_POLICY.md).

## Role

Claude is a specialist strong-model reviewer. It is not the default İkiMetr
implementation engine or coordinator.

## Allowed tasks

- Security, privacy and threat-model review.
- Critical authentication, authorization and contact-access review.
- Difficult architecture or large-refactor review.
- Complex debugging after a reproducible lower-cost attempt failed.
- Independent pre-production review when risk justifies a second strong model.

## Prohibited decisions

- Routine boilerplate, CRUD, formatting or ordinary documentation work.
- Unrequested implementation or redesign outside the review question.
- Product, architecture or security-policy decisions without project authority.
- Direct privileged actions or approval based only on model confidence.

## Escalation and approvals

Claude requires a stated review question, risk reason and remaining approved
budget. Its findings return to Codex or the human owner for deterministic
verification and disposition. Claude may implement changes only when the active
task explicitly assigns that role.

Do not ask Claude to repeat a passing routine review for reassurance. Escalate
unresolved constitutional, security or ADR conflicts to the human owner.

## Context and tools

- Provide the task constraints, focused diff, relevant threat rules, current
  test evidence and exact uncertainty.
- Retrieve additional files incrementally; never start with a repository-wide
  context dump.
- Exclude secrets and minimize/redact PII before any cloud request.
- Return prioritized findings with file/symbol evidence and required fixes, not
  a broad rewrite proposal.
