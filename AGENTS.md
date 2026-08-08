AGENTS.md

These rules apply to any AI coding agent working on İkiMetr.

Core working rules
Read the task specification before changing code.
Read only the project documents explicitly referenced by that task unless additional context is technically necessary.
Do not redesign unrelated modules.
Do not introduce new major dependencies without task justification.
Never weaken authorization, privacy or security rules.
Do not trust frontend-supplied role, ownership or user IDs.
Do not expose raw database models in API responses when they contain internal or sensitive fields.
Do not commit secrets, tokens, API keys, passwords or real production credentials.
Add tests for every new business rule and authorization rule.
Run lint, typecheck, tests and production build before reporting completion.
Do not change architecture silently. Create or report an ADR need instead.
Keep scope narrow. Out-of-scope features must not be implemented “for completeness”.
Prefer deterministic rules before AI.
If blocked by a real architectural conflict, report the conflict instead of guessing.
Prefer modifying existing code over introducing parallel implementations.
Do not rewrite working modules unless the task explicitly requires it.
Preserve backward compatibility unless the task explicitly authorizes a breaking change.
Never use an AI-generated result as a privileged command without deterministic validation.
Never perform destructive database or infrastructure actions unless the task explicitly requires them.
Before using a new library or framework API, verify current documentation when uncertainty exists.
AI CODE ROUTER / AI COST ROUTING POLICY

The goal is to minimize cost, token consumption and duplicated work while preserving engineering quality.

Do not automatically use the strongest or most expensive model for every task.

1. General routing principle

Use this order:

Deterministic tools and existing project documentation
Serena for targeted code navigation
Context7 for current external documentation
Low-cost model for routine implementation
Codex for core implementation and architecture-sensitive work
Claude for high-risk review, complex reasoning or difficult debugging
Playwright for executable UI/E2E verification
Sentry MCP for staging/production incident analysis

Do not ask multiple LLMs to solve the same routine task unless the first result is blocked, uncertain, security-sensitive or failed verification.

2. Codex / ChatGPT role

Codex is the primary coding and coordination agent for İkiMetr.

Prefer Codex for:

architecture-sensitive implementation;
backend domain logic;
database migrations;
authorization and ownership logic;
permissions;
security-sensitive code;
cross-module changes;
difficult bugs;
integration work;
final implementation after another model produced a draft;
reviewing changes before critical checkpoints.

Codex must follow PROJECT_CONSTITUTION, task specifications and architecture documents.

Codex should not waste tokens rereading the entire repository when Serena or task-specific file references are sufficient.

3. DeepSeek role

DeepSeek is the preferred low-cost implementation agent for routine and well-specified tasks.

Prefer DeepSeek for:

boilerplate;
straightforward CRUD;
simple DTO/schema work;
repetitive tests;
basic refactors;
documentation updates;
simple UI components;
formatting and cleanup;
converting already-defined rules into code;
low-risk helper functions;
first-pass analysis of non-critical errors.

DeepSeek must not independently redesign architecture or security rules.

Escalate from DeepSeek to Codex when:

authorization or privacy is involved;
the change affects several domain modules;
database design is ambiguous;
the task conflicts with documentation;
tests expose unexpected behavior;
the agent is uncertain about architectural intent.
4. Claude role

Claude is a specialist and review agent, not the default implementation engine.

Use Claude mainly for:

security review;
threat-model review;
complex debugging after simpler attempts failed;
difficult architectural review;
large refactor review;
critical authentication/authorization review;
ingestion and scraping risk review;
owner-contact privacy review;
pre-production review;
independent review of highly sensitive changes.

Do not send every completed task to Claude.

Claude review is reserved for high-risk checkpoints or unresolved uncertainty.

5. Model escalation policy

Routine task:
DeepSeek first when suitable.

Normal architecture-aware task:
Codex.

Security-critical or highly ambiguous task:
Codex + optional Claude review.

Do not run:

DeepSeek + Codex + Claude

on the same ordinary task merely to compare answers.

Escalation must have a reason.

Examples:

failed tests;
unclear architecture;
security impact;
repeated implementation failure;
difficult production incident.
6. Serena usage

Use Serena to reduce repository-reading cost.

Prefer Serena for:

locating classes, functions, symbols and references;
understanding call relationships;
finding implementations;
navigating large modules;
determining which files are actually relevant.

Do not read entire directories when targeted symbol-level inspection is sufficient.

For large tasks:

Serena → identify relevant code → read only necessary files → implement.

7. Context7 usage

Use Context7 when current external library documentation is needed.

Examples:

Next.js APIs;
Fastify APIs;
Playwright APIs;
database libraries;
Redis/BullMQ;
authentication libraries;
Sentry SDK;
framework configuration.

Do not call Context7 when the required behavior is already defined in project documentation or obvious from local code.

Never assume an external library API from outdated model memory when current documentation can be checked cheaply.

8. Playwright usage

Playwright is the primary automated browser/E2E verification tool.

Use Playwright for workflows that can be tested by actually running the application.

Examples:

registration;
login;
property creation;
request creation;
matching workflow;
permissions visible through UI;
navigation;
forms;
user-facing regressions.

Prefer executable Playwright tests over asking another LLM to reason visually about behavior that can be tested.

Do not use Playwright as a substitute for unit or integration tests.

Testing layers:

unit tests
→ integration tests
→ API/authorization tests
→ Playwright E2E where relevant

9. Sentry MCP usage

Sentry MCP is for staging and production diagnostics.

Use it for:

real application errors;
stack traces;
regressions;
release-specific failures;
performance issues;
production incident investigation.

Do not use Sentry as the source of product requirements.

Never send or expose unnecessary personal or sensitive data through debugging workflows.

10. AI cost control rules

Before calling an LLM, ask:

Can code, SQL, schema validation or deterministic logic solve this?
Can existing tests reveal the answer?
Can Serena locate the relevant implementation?
Can Context7 resolve the documentation question?
Can the result be reused from an unchanged input or prior computation?

Avoid:

repeated repository-wide reads;
repeated AI analysis of unchanged files;
repeated semantic classification of unchanged input;
unnecessary model-to-model review;
long conversational explanations inside coding-agent output.

Prefer:

small task specs;
file/symbol targeting;
cached results;
short structured reports;
deterministic tests.
11. Context budget rule

Each agent should receive only:

AGENTS.md;
the active task specification;
documents explicitly referenced by the task;
relevant source files;
relevant test files.

Do not load unrelated modules unless technically required.

If additional context is needed, retrieve it incrementally.

12. Handoff between agents

When one agent hands work to another, provide a compact handoff:

TASK ID:
GOAL:
CURRENT STATUS:
FILES CHANGED:
TEST RESULTS:
OPEN PROBLEM:
WHY ESCALATED:

Do not force the next agent to reconstruct the entire history from chat.

13. Security-sensitive automatic escalation

The following areas require Codex-level review and may require Claude review before production:

authentication;
authorization;
role and permission changes;
owner contact access;
client contact access;
session management;
password/reset flows;
admin privileges;
file upload security;
SSRF-sensitive ingestion;
secrets;
payment systems;
audit logging;
destructive migrations;
AI actions capable of changing privileged state.

Low-cost models may assist, but must not be the sole reviewer for production-ready changes in these areas.

14. Architecture changes

No agent may silently replace or introduce:

database technology;
backend framework;
frontend framework;
queue system;
authentication strategy;
storage architecture;
major AI provider abstraction;
permission model;
deployment model.

A proposed change requires an ADR or explicit task authorization.

15. Definition of done

A task is not complete only because code was written.

When relevant, completion requires:

implementation matches task scope;
validation added;
ownership/authorization verified;
migrations reviewed;
unit tests pass;
integration tests pass;
authorization tests pass;
Playwright tests pass where required;
lint passes;
typecheck passes;
production build passes;
documentation updated;
no secrets added;
known limitations reported.
Required final report

TASK:

STATUS:
COMPLETED | BLOCKED

CHANGED:
Brief list of created or modified items.

MIGRATIONS:
Migration names/results, or None.

TESTS:
Commands executed and results.

SECURITY:
Security/authorization checks performed.

TOOLS USED:
Serena / Context7 / Playwright / Sentry / None.

MODEL ROUTING:
Which model performed the task and whether escalation occurred.

KNOWN ISSUES:
Remaining issues, or None.

NEXT:
Next task only. Do not begin it automatically.