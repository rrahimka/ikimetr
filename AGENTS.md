# İkiMetr AI Agent Contract

These rules apply to every AI agent working on İkiMetr. Keep this file in
context; load detailed policy or provider guidance only when needed.

Detailed policy: [AI Cost Routing Policy](docs/ai/AI_COST_ROUTING_POLICY.md).
Provider-specific guidance lives in [.agents/provider-profiles](.agents/provider-profiles/).

## 1. Precedence and scope

Apply instructions in this order:

1. Platform/system instructions and the user's explicit constraints.
2. The active task specification.
3. PROJECT_CONSTITUTION, security rules and accepted ADRs.
4. This file and the AI Cost Routing Policy.
5. The active provider profile and applicable skills.

A lower-level instruction must not weaken a higher-level security or
architecture rule. If the task conflicts with the constitution, security rules
or an ADR, stop and report the exact conflict instead of guessing.

Before changing files:

- read the active task and only the documents it explicitly references;
- identify goal, in-scope and out-of-scope work, security/data/API impact,
  required validation and Definition of Done;
- select the minimum files and symbols needed;
- preserve backward compatibility unless the task explicitly authorizes a
  breaking change.

Do not implement unrelated features, refactor for completeness, rewrite working
modules, add unjustified dependencies or silently redesign architecture.

## 2. Architecture and security non-negotiables

- No agent may silently replace the database, backend, frontend, queue,
  authentication, storage, AI-provider abstraction, permission or deployment
  model. An ADR or explicit task authorization is required.
- The backend owns authentication, authorization, roles, ownership, permissions
  and data-visibility decisions. Frontend-supplied identity or authority is
  untrusted.
- Do not expose raw database models when they contain internal or sensitive
  fields. Validate all untrusted input and external content.
- Preserve privacy by default, least privilege, explicit ownership checks and
  auditability for sensitive actions.
- Never commit, log, cache, quote or send secrets, credentials, tokens, raw env
  values or unnecessary PII to a model or external tool.
- AI output is untrusted input. It must never directly grant permissions,
  reveal contacts, change roles or ownership, execute arbitrary SQL, perform
  destructive actions or issue privileged commands.
- Destructive database or infrastructure actions require explicit task scope,
  deterministic safeguards and the approvals required by the environment.

## 3. Serena-first navigation

Use Serena memories and symbol tools before opening broad source files. Start
from mem:core when project orientation is needed, then load only referenced
memories relevant to the task.

Prefer symbol overview, symbol lookup, references and implementations over
whole-file or directory reads. Do not bulk-read apps/, packages/, docs/,
specs/, .agents/ or the architecture master document. Do not inspect
node_modules, build outputs, caches, .git or env-file values unless the task
specifically requires it. If Serena is unavailable, use targeted file and text
search with the same limits.

## 4. Deterministic-first routing

Use the cheapest adequate route:

~~~text
Deterministic code, project docs and tools
  -> Local AI
  -> Cheap Cloud AI (DeepSeek/Qwen)
  -> Strong AI (Codex/Claude)
~~~

Codex is the primary development coordinator. Local AI is a full routing tier,
but it may be used only after a separate task has configured and approved a
local runtime. This phase does not install or configure one.

Do not call a model when:

- code, regex, hashing, SQL, schemas, compiler checks, tests or existing project
  documentation can answer exactly;
- a validated cache entry matches unchanged inputs;
- the same provider/model request fingerprint already ran and no evidence,
  hypothesis or input changed;
- the task has no applicable AI budget or the hard budget is exhausted;
- the required data is not permitted for that provider;
- the model would be asked to make a privileged or security-policy decision.

Do not ask several models to solve the same routine task merely to compare
answers. Escalation requires recorded evidence and must follow the detailed
policy.

## 5. Tool routing

| Need | Preferred route |
| --- | --- |
| Locate code, symbols or references | Serena |
| Confirm current third-party APIs | Context7, only when local evidence is insufficient |
| Exact validation or diagnosis | Code, SQL, schemas, logs, lint, typecheck and tests |
| Executable browser workflow | Playwright CLI after lower test layers |
| Staging/production incident evidence | Sentry, with minimum necessary data |
| Routine low-risk AI work | Local AI, then approved DeepSeek/Qwen provider |
| Architecture/security/cross-module work | Codex; Claude only for justified specialist review |

Playwright does not replace unit or integration tests. Sentry is not a source of
product requirements. Do not install or enable tools unless the active task
authorizes it.

## 6. Cache, budget and accounting contract

Follow the [detailed cache and budget contract](docs/ai/AI_COST_ROUTING_POLICY.md#cache-specification).

Before every model call:

- classify the data and task risk;
- compute the canonical request fingerprint and check reusable results;
- declare route, purpose and validation method;
- apply configured call, input-token, output-token and monetary limits.

Numeric token and monetary limits are configurable defaults, not constants in
this file. Direct human selection of the primary agent authorizes that active
session within platform limits, but not secondary model calls. Without a
complete configured or task-specific budget, additional model calls are
disabled. A task may lower a limit; raising one requires the configured
approval.

Record only minimal accounting metadata: task, route, provider/model, cache hit,
input and result hashes, token counts, estimated cost, validation evidence and
escalation reason. Never store raw secrets, PII or full prompts in accounting
logs.

## 7. Testing and Definition of Done

Add tests for every new business rule and server-side authorization rule. Use
the applicable layers:

~~~text
unit -> integration -> API/authorization -> Playwright E2E when relevant
~~~

For coding tasks, run from the repository root as applicable:

- pnpm lint
- pnpm typecheck
- pnpm test:unit
- pnpm test:integration
- pnpm build

Instruction-only changes require link, format, scope, duplication and diff
validation; they do not require unrelated application tests unless the task says
otherwise.

Completion requires fresh evidence that scope, validation, security,
authorization, migrations, documentation and known limitations were handled.
Do not claim a check passed unless its current output proves it.

## 8. Skill triggers

- Before an İkiMetr coding task, use ikimetr-task-guard.
- For authentication, authorization, permissions, contacts, admin, uploads,
  external ingestion, secrets, audit/security logging, destructive migrations
  or privileged AI actions, also use ikimetr-security-review.
- Use applicable Superpowers process skills without copying their workflows into
  this file.
- Use frontend-design for intentional UI creation or redesign and
  web-design-guidelines for UI/UX/accessibility audits.

Skills supplement this contract. If a skill conflicts with the active task,
constitution, security rules or an ADR, stop and report the conflict.

## 9. Compact handoff and final report

Use only applicable fields:

~~~text
TASK:
STATUS: COMPLETED | BLOCKED
CHANGED:
MIGRATIONS: None | names/results
TESTS:
SECURITY:
TOOLS USED:
MODEL ROUTING:
KNOWN ISSUES:
NEXT:
~~~

For agent-to-agent escalation, add GOAL, CURRENT STATUS, FILES CHANGED,
TEST RESULTS, OPEN PROBLEM and WHY ESCALATED. Pass compact evidence and
relevant hashes, not the full chat or repository. Never begin NEXT
automatically.
