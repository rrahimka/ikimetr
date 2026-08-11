# İkiMetr Spec Kit + Agent Loop Design

**Date:** 2026-08-11
**Status:** DESIGN — no implementation yet
**Phase:** post-3G.4 checkpoint, pre-Spec-Kit installation
**Branch:** `chore/spec-kit-agent-loop`
**Baseline commit:** `e8b7a3576bf460d928ec19770646002ba7cd763b` (Phase 3G.4 checkpoint, committed and pushed; main synchronized before branch creation)
**Revision:** 3

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Current Project Inventory](#2-current-project-inventory)
3. [Concept Separation](#3-concept-separation)
4. [Collision Analysis](#4-collision-analysis)
5. [Target Architecture](#5-target-architecture)
6. [Source of Truth Hierarchy](#6-source-of-truth-hierarchy)
7. [Future Coding Agent Architecture](#7-future-coding-agent-architecture)
8. [Atomic Task Contract](#8-atomic-task-contract)
9. [Agent Loop State Machine](#9-agent-loop-state-machine)
10. [Failure Classifier](#10-failure-classifier)
11. [Attempt Budget](#11-attempt-budget)
12. [AI Cost Router Integration](#12-ai-cost-router-integration)
13. [Context Handoff](#13-context-handoff)
14. [Tool Policy](#14-tool-policy)
15. [Git Safety](#15-git-safety)
16. [Security](#16-security)
17. [Verification Matrix](#17-verification-matrix)
18. [Definition of Done](#18-definition-of-done)
19. [Execution Audit](#19-execution-audit)
20. [Spec Kit Customization Strategy](#20-spec-kit-customization-strategy)
21. [Constitution Strategy](#21-constitution-strategy)
22. [Spec Kit Workflow Security Model](#22-spec-kit-workflow-security-model)
23. [Installation Safety Design](#23-installation-safety-design)
24. [Update Strategy](#24-update-strategy)
25. [Concurrency](#25-concurrency)
26. [Recovery](#26-recovery)
27. [Phased Delivery](#27-phased-delivery)
28. [Pre-Install Collision Matrix](#28-pre-install-collision-matrix)
29. [Non-Goals](#29-non-goals)
30. [Open Implementation-Time Verifications](#30-open-implementation-time-verifications)
31. [Rollback](#31-rollback)

---

## 1. Purpose

Standardize future İkiMetr development so every coding agent works from the same
canonical artifacts:

- specification
- plan
- task breakdown
- project rules (AGENTS.md, PROJECT_CONSTITUTION, ADRs)
- AI Cost Routing Policy
- verification gates

while minimizing token waste and preventing agents from making uncontrolled
changes.

GitHub Spec Kit provides the specification/planning/task workflow foundation
with its native workflow engine. İkiMetr Agent Loop adds thin project-specific
execution governance as a native Spec Kit workflow/overlay — NOT as a custom
orchestration engine. Together they replace ad-hoc agent prompts with a
reproducible, auditable development process.

**Core design rule:**

> Prefer native Spec Kit workflow primitives. Custom TypeScript Agent Loop
> runtime code is allowed ONLY when Phase A demonstrates a concrete required
> invariant that cannot be enforced safely using supported Spec Kit
> workflow/overlay/preset/extension mechanisms.

`packages/agent-loop` is NOT an assumed destination. It may appear only as
**FALLBACK — implementation-time evidence required.**

---

## 2. Current Project Inventory

### 2.1 Component Matrix

| COMPONENT | CURRENT OWNER | PURPOSE | KEY FILES | MUST PRESERVE? | POTENTIAL SPEC KIT COLLISION? | MIGRATION ACTION |
|---|---|---|---|---|---|---|
| AGENTS.md | Project root | Universal AI agent contract | `AGENTS.md` | YES — authoritative | Implementation-time verification required | Spec Kit may supplement agent context; AGENTS.md remains authoritative |
| AI Cost Routing Policy | `docs/ai/` | Provider-neutral routing/cost/cache/data-protection policy | `docs/ai/AI_COST_ROUTING_POLICY.md` | YES — sole routing authority | LOW — policy docs are project-owned | No migration needed |
| AI Cost System | `packages/ai-cost-system/` | Deterministic routing, budgeting, caching, provider adapters, execution coordinator | 30 src files, 32 test files | YES — implementation; contains public API surface: CostRouter, AiExecutor, ExecutionCoordinator, LocalInvoker, CheapCloudInvoker, provider adapters | NONE — pure code | No migration needed |
| Cost Config | `config/ai-cost/` | Provider/budget/router/pricing/verification JSON configs | 5 JSON files | YES — routing configuration | NONE — JSON config | No migration needed |
| Provider Profiles | `.agents/provider-profiles/` | Agent-specific capability/permission narrowing | 4 markdown profiles | YES — agent governance | LOW — profiles are project-owned | No migration needed |
| Agent Skills | `.agents/skills/` | Codex skills (ikimetr-task-guard, ikimetr-security-review, frontend-design, web-design-guidelines) | 4 skill dirs | YES — current agent workflow | **Spec Kit WILL touch parent `.agents/skills/` when Codex integration installed** | PRESERVE existing skills; merge Spec Kit additions |
| Claude Skills | `.claude/skills/` | Claude skills (playwright-cli, frontend-design, web-design-guidelines) | 3 skill dirs | YES — Claude integration | **Spec Kit WILL touch parent `.claude/skills/` when Claude integration installed** | PRESERVE existing skills; merge Spec Kit additions |
| Qwen Integration | Not present | N/A | No `.qwen/` directory | N/A | **Spec Kit may create `.qwen/commands/` for Qwen integration** | Expected new directory; no collision |
| Serena Config | `.serena/project.yml` | Code navigation and symbol indexing | `project.yml` | YES — Serena-first navigation | LOW | No migration needed |
| Playwright Config | `.playwright/` | Browser automation via msedge | `cli.config.json` | YES — E2E capability | NONE | No migration needed |
| Superpowers Specs | `docs/superpowers/specs/` | 7 phase design specs + this document | 8 markdown files | YES — architectural record | NONE — docs | Spec Kit specs live separately or alongside |
| Superpowers Plans | `docs/superpowers/plans/` | 7 implementation plans | 7 markdown files | YES — implementation record | NONE — docs | Spec Kit plans live separately or alongside |
| Project Constitution | `docs/PROJECT_CONSTITUTION.md` | 20 architecture/product rules | 1 file | YES — non-negotiable canonical source | MEDIUM — Spec Kit constitution feature; see §21 | Constitution mirror strategy in §21 |
| Root Package | Root | pnpm monorepo, scripts, devDeps | `package.json`, `pnpm-workspace.yaml` | YES | LOW | No migration needed |
| ESLint/TS/Prettier | Root | Code quality | `eslint.config.js`, `tsconfig.json`, `prettier.config.js` | YES | NONE | No migration needed |
| Vitest | Root | Testing | `vitest.config.ts`, `vitest.integration.config.ts` | YES | NONE | No migration needed |
| .gitignore | Root | Git exclusions | `.gitignore` | YES | LOW — Spec Kit may suggest additions | Merge if needed |
| .env.example | Root | Environment template (placeholders only) | `.env.example` | YES — no secrets | NONE | No migration needed |

### 2.2 Current Green Baseline

Phase 3G.4 checkpoint is committed and pushed:

- Commit: `e8b7a3576bf460d928ec19770646002ba7cd763b`
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test:unit` — 32 files / 379 tests PASS
- `pnpm test:integration` — 3 files / 3 tests PASS
- `pnpm build` — PASS

Remote main and local main were synchronized before `chore/spec-kit-agent-loop`
branch was created.

---

## 3. Concept Separation

Six distinct concepts must never be conflated:

### A. MODEL
An LLM model (e.g., `qwen2.5-coder:7b`, `deepseek-chat`, `claude-sonnet-4`).
A model has capabilities and limitations. It is NOT a coding agent.

### B. PROVIDER / RUNTIME
The API or runtime that supplies a model:
- Ollama (local runtime)
- DeepSeek API
- Qwen API
- Anthropic / OpenAI endpoints

A provider exposes one or more models. It is NOT a coding agent.

### C. CODING AGENT / HARNESS / EXECUTOR
The tool that consumes a task specification, interacts with a model/provider,
reads/writes files, runs tests, and produces verifiable output:
- Codex CLI
- Claude Code
- Qwen Code
- OpenCode
- future coding harnesses

A coding agent MAY use one or more providers/models. The mapping is not 1:1.
Ollama is a provider/runtime, NOT a coding agent. A generic "DeepSeek API" is
a provider, NOT a coding agent, unless a distinct coding harness exists that
is explicitly profiled as such.

### D. TOOL
A specialized capability used by coding agents during execution:
- Serena (symbol navigation)
- Context7 (external documentation)
- Playwright (browser/E2E)
- Sentry (incident diagnostics)
- Git (version control)

### E. WORKFLOW / ORCHESTRATOR
The system that governs the specification→task→execution→verification
pipeline:
- GitHub Spec Kit (native workflow engine)
- İkiMetr Agent Loop (thin project-specific governance, implemented as
  native Spec Kit workflow/overlay where possible)

### F. ROUTER
The existing İkiMetr AI Cost Router (`packages/ai-cost-system`).
Sole authority for provider/model/cost routing decisions.
NOT a coding-agent selector.

**These six concepts must never be merged into a single registry, profile, or
decision point.**

---

## 4. Collision Analysis

### 4.1 Files/Directories Spec Kit Installation May Touch

Based on current Spec Kit integration architecture:

| PATH | RISK | CLASSIFICATION |
|---|---|---|
| `AGENTS.md` | Implementation-time verification required — Spec Kit may supplement agent context | **MUST PRESERVE** — İkiMetr AGENTS.md is authoritative; Spec Kit supplement is additional context, not replacement |
| `.agents/skills/` | **Spec Kit WILL touch parent directory** when Codex integration is installed | **MUST PRESERVE** — existing skills; managed integration files are designed not to overlap unsafe paths; verify exact installed version |
| `.claude/skills/` | **Spec Kit WILL touch parent directory** when Claude integration is installed | **MUST PRESERVE** — existing skills; merge only non-conflicting additions |
| `.qwen/commands/` | Expected new directory for Qwen integration | **SAFE** — no existing content to collide with |
| `.specify/` | Spec Kit working directory — expected to be NEW | **SAFE** — new directory |
| `.agents/provider-profiles/` | Not expected to be touched | LOW — project-owned |
| `docs/PROJECT_CONSTITUTION.md` | Spec Kit constitution feature; see §21 | **MUST PRESERVE** — canonical source; Spec Kit mirror is derived |
| `docs/superpowers/specs/` | Spec Kit may generate specs in its own output directory | **SAFE** — existing specs are separate architectural record |
| `docs/superpowers/plans/` | Similar to specs | **SAFE** |
| `config/ai-cost/` | Not expected to be touched | NONE |
| `packages/ai-cost-system/` | Not expected to be touched | NONE |
| `package.json` | May add devDependencies or scripts | **POTENTIAL COLLISION** — review diffs carefully |
| `.gitignore` | May append entries | **SAFE** — merge if conflict-free |
| `.serena/` | Not expected to be touched | NONE |
| `.playwright/` | Not expected to be touched | NONE |

### 4.2 Multi-Install Semantics

"Multi-install-safe" does NOT mean "directory untouched." It means managed
integration files are designed not to overlap unsafe paths. Spec Kit has one
active/default integration at a time. Multiple safe integrations may coexist,
but default integration is an operational configuration — NOT a Cost Router
decision. Switching the default integration must not change project governance,
Cost Router policy, task semantics, or security requirements.

### 4.3 Protection Rules

1. Spec Kit installer never receives automatic permission to overwrite existing
   İkiMetr policy, agent configuration, or cost system files.
2. All generated files must be inspected via `git diff` before commit.
3. Any file collision requires human review before merging.
4. Phase A must verify exact installed version and integration behavior before
   any commitments are made.

---

## 5. Target Architecture

There are TWO distinct execution paths. They must not be conflated.

### 5.1 Path A — Coding-Agent Workflow Execution

```text
                     CANONICAL PROJECT STATE
                    (constitution, ADRs, AGENTS.md,
                     AI Cost Routing Policy, configs)
                              │
                     GitHub Spec Kit
                    (native workflow engine:
                     specification, clarification,
                     planning, task decomposition)
                              │
                     approved atomic task
                              │
                     İkiMetr Agent Loop
                    (thin Spec Kit workflow/overlay:
                     execution governance for
                     ONE atomic approved task)
                              │
            active/default Spec Kit coding-agent integration
           (native integration: Codex / Claude / Qwen /
            generic / FUTURE_GENERIC_AGENT)
                              │
                     Coding Agent / Harness
           (Codex CLI / Claude Code / Qwen Code /
            OpenCode / future harness)
                              │
                        VERIFICATION
                    (targeted → full →
                     security → scope)
```

Spec Kit default integration is operational harness configuration, NOT AI Cost
Router output. The CodingAgentRegistry does NOT select a coding agent based on
RoutingDecision.

### 5.2 Path B — Routed Model/Provider Execution

When a workflow/task needs routed AI model execution (e.g., a coding agent
needs to call an LLM for a specific sub-operation), it uses the existing AI
Cost System:

```text
workflow/task needs routed AI model execution
        │
        ▼
EXISTING AiExecutor (public API from packages/ai-cost-system)
        │
        ▼
CostRouter.evaluate(routingRequest, routingContext)
        │
        ▼
ExecutionCoordinator.execute(...)
        │
        ▼
LocalInvoker / CheapCloudInvoker
        │
        ▼
Provider adapter (OllamaAdapter / DeepSeekAdapter)
        │
        ▼
Model / Provider runtime
```

### 5.3 Existing AiExecutor is NOT a Coding-Agent Launcher

AiExecutor routes model/provider calls through the Cost Router. It does NOT
launch Codex CLI, Claude Code, Qwen Code, or any coding harness. Do not place
a CodingAgentAdapter after AiExecutor. Do not claim RoutingDecision selects
the coding harness.

### 5.4 Responsibility Boundaries

| LAYER | OWNS | DOES NOT OWN |
|---|---|---|
| **Spec Kit** | Specification workflow, clarification, planning, task decomposition, consistency analysis, native workflow execution, human gates, pause/resume, coding-agent integration (operational config) | Model/provider selection, cost decisions, execution governance beyond native workflow steps |
| **Agent Loop** | Thin execution governance as native Spec Kit workflow: one-task-at-a-time, context minimisation, TDD/baseline enforcement, bounded correction, verification gates, human approval gates, STOP boundaries | Specification authoring, routing decisions, model selection, provider invocation, coding-agent selection |
| **AI Cost System** | Sole routing authority (CostRouter), execution coordination (ExecutionCoordinator), provider invocation (LocalInvoker, CheapCloudInvoker), budgeting, caching, pricing — for Path B routed model execution | Task decomposition, specification, verification, coding-agent selection |
| **Spec Kit Integration** | Operational configuration: which coding harness is the active/default for Spec Kit workflow steps | Routing decisions, model selection |
| **Coding Agent** | Code generation, test execution, debugging within approved task scope and Agent Loop constraints | Autonomous scope expansion, provider selection, policy modification |
| **Tools** | Serena (symbols/navigation), Context7 (external docs), Playwright (E2E), Sentry (incidents), Git (version control) | Policy decisions, routing |

### 5.5 Existing AI Cost System Reuse

The existing public API surface from `packages/ai-cost-system` already contains:

- `CostRouter` — sole routing authority
- `AiExecutor` — execution boundary for routes it supports (Path B)
- `ExecutionCoordinator` — invoker dispatch with 4-condition authorization
- `LocalInvoker` — LOCAL route enforcement
- `CheapCloudInvoker` — CHEAP_CLOUD route enforcement
- Provider adapters (OllamaAdapter, DeepSeekAdapter)

Agent Loop must NOT duplicate:
- RoutingDecision schema
- RoutingRequest construction
- Provider invocation
- Retry logic
- Provider selection
- Execution coordination

Agent Loop provides approved task/routing context. For Path B execution, the
existing `AiExecutor` remains the boundary. For Path A, Spec Kit native
integration handles coding-agent launch.

Non-executable routing decisions must preserve current Phase 3G.4 behavior.
Do not silently convert them into executable routes.

Strong/non-executable decisions must preserve current behavior and may require
bounded/manual handoff exactly as current public AI Cost System allows.
Exact future automation mechanism: IMPLEMENTATION-TIME VERIFICATION REQUIRED.

---

## 6. Source of Truth Hierarchy

```text
PROJECT CONSTITUTION / security invariants
        │  (never weakened)
        ▼
accepted ADRs
        │
        ▼
AGENTS.md
        │
        ▼
AI Cost Routing Policy
        │
        ▼
approved feature specification   ← Spec Kit output
        │
        ▼
approved implementation plan     ← Spec Kit output
        │
        ▼
approved atomic task             ← Spec Kit output + Agent Loop input
        │
        ▼
Agent Loop execution state       ← runtime only, not canonical
        │
        ▼
individual agent output          ← ephemeral, validated against canonical
```

**Critical rule:** A lower layer NEVER weakens a higher layer. If a spec,
plan, or agent output contradicts the constitution, AGENTS.md, or the routing
policy, the contradiction must be resolved at the higher layer.

**AI conversation history is NOT canonical state.** Only committed artifacts
(specs, plans, tasks, test results, audit records) carry forward.

---

## 7. Future Coding Agent Architecture

The system must not depend on specific agent brands. Any coding agent that can
consume a task contract and produce verifiable output is supported through a
profile and native Spec Kit integration.

### 7.1 CodingAgentProfile (canonical schema)

This profile describes coding agent CAPABILITIES. It does NOT make routing
decisions. Cost/provider/model information belongs to the existing AI Cost
System, not to this profile.

```json
{
  "schema_version": 1,
  "agent_id": "string",
  "display_name": "string",
  "integration_type": "cli | api | session | mcp",
  "spec_kit_integration": "native | generic | custom_adapter",
  "_spec_kit_integration_note": "Prefer native. Custom adapter is FALLBACK only.",
  "capabilities": {
    "routine_implementation": true,
    "complex_implementation": false,
    "architecture_review": false,
    "security_review_capability": false,
    "test_generation": true,
    "documentation": true,
    "debugging": true
  },
  "limitations": [
    "no_git_operations",
    "no_shell"
  ],
  "tool_access": {
    "_note": "DECLARED capability/availability metadata only. Actual permission is granted by project policy + task contract + workflow gates + runtime enforcement. Profile alone NEVER grants privileged tool permission.",
    "serena": true,
    "context7": false,
    "playwright": false,
    "sentry": false,
    "shell": true,
    "git": true,
    "browser": false,
    "mcp": false,
    "code_execution": true
  },
  "supported_task_classes": [
    "DOCS_ONLY",
    "PURE_LOGIC",
    "API",
    "UI"
  ],
  "structured_output": true,
  "enabled": true
}
```

**Explicitly removed from profile:**
- `cost_class` — routing authority belongs to AI Cost System
- `trust_class` — all AI output is untrusted until verified; no brand-based trust

**Tool access authority model:**
- `CodingAgentProfile.tool_access` = declared capability/availability metadata
- Actual permission = project policy + task contract + workflow gates + runtime/environment enforcement
- Profile alone NEVER grants privileged tool permission

### 7.2 Coding Agent Selection Strategy

For supported coding agents:

1. **FIRST:** native Spec Kit integration (Codex, Claude, Qwen each have
   isolated native integrations)
2. **SECOND:** Spec Kit generic integration for unknown future coding agents
3. **ONLY AS FALLBACK:** custom CodingAgentAdapter/bridge when native/generic
   integration cannot meet a documented requirement

Do NOT create custom adapters for Codex, Claude, or Qwen merely because they
exist — use their native Spec Kit integrations.

CodingAgentProfile remains as a project capability description. It does not
select the harness at runtime.

### 7.3 CodingAgentRegistry

Minimal registry mapping `agent_id → { profile }`. Describes available agents
and their capabilities. Does NOT select agents. Agent selection is through
Spec Kit's active/default integration configuration.

### 7.4 Known Coding Agent Classes

| CODING AGENT | SPEC KIT INTEGRATION | PRIMARY USE |
|---|---|---|
| Codex CLI | Native | Architecture, security, cross-module, coordination |
| Claude Code | Native | Specialist security/architecture review |
| Qwen Code | Native | Routine implementation, testing, docs |
| OpenCode | Generic or custom (implementation-time verification required) | Routine implementation (future) |
| FUTURE_GENERIC_AGENT | Generic or custom (implementation-time verification required) | To be profiled when available |

Ollama is a PROVIDER/RUNTIME (see §3), NOT a coding agent. Generic DeepSeek API
is a PROVIDER, NOT a coding agent, unless a distinct coding harness exists and
is explicitly profiled.

No agent name that cannot be confirmed through project configuration is
hardcoded as an architectural constant. No brand is a permanent default.

---

## 8. Atomic Task Contract

One Agent Loop execution = ONE atomic task. Canonical machine-readable format:

```json
{
  "schema_version": 1,
  "task_id": "string (uuid)",
  "feature_id": "string (from Spec Kit feature)",
  "goal": "string (what to accomplish, one sentence)",
  "spec_refs": ["path/to/spec.md"],
  "plan_refs": ["path/to/plan.md"],
  "dependencies": ["task_id_1"],
  "allowed_scope": {
    "files": ["allowed/path/**"],
    "symbols": ["ClassName", "functionName"],
    "packages": ["@ikimetr/ai-cost-system"]
  },
  "forbidden_scope": {
    "files": ["forbidden/path/**"],
    "packages": ["@ikimetr/database"]
  },
  "acceptance_criteria": [
    "criterion 1",
    "criterion 2"
  ],
  "security_class": "none | low | standard | high | critical",
  "risk_class": "low | standard | high | security_critical",
  "task_class": "DOCS_ONLY | PURE_LOGIC | API | DATABASE | AUTH_SECURITY | UI | INFRA | AI_PROVIDER | CROSS_MODULE",
  "required_tests": {
    "unit": true,
    "integration": false,
    "e2e": false
  },
  "routing_constraints": {
    "_comment": "Constraints for the Cost Router.",
    "routing_hint": "deterministic | local | cheap_cloud | strong | null",
    "_routing_hint_note": "NON-AUTHORITATIVE HINT. Cost Router MAY ignore this. Does not select provider/model.",
    "budget_class": "NONE | LOCAL_ONLY | CHEAP_ALLOWED | STRONG_ALLOWED",
    "_budget_class_note": "HARD CONSTRAINT. Cost Router MUST NOT exceed this.",
    "allowed_data_classes": ["public", "internal"],
    "_allowed_data_classes_note": "HARD CONSTRAINT. Cost Router MUST NOT select a provider not approved for these data classes.",
    "required_capabilities": ["routine-implementation"],
    "_required_capabilities_note": "HARD CONSTRAINT. Cost Router MUST select a provider meeting these capabilities.",
    "risk_class_constraint": "HARD CONSTRAINT from parent task.risk_class."
  },
  "budget_constraints": {
    "_note": "HARD CEILINGS. Cost Router MUST NOT exceed these.",
    "max_calls": null,
    "max_input_tokens": null,
    "max_output_tokens": null,
    "max_cost_micros": null
  },
  "attempt_budget": {
    "max_implementation_attempts": 1,
    "max_correction_cycles": 2
  },
  "previous_failure_evidence": null,
  "environment_requirements": {
    "docker": false,
    "database": false,
    "redis": false,
    "ollama": false
  },
  "status": "READY"
}
```

### 8.1 Routing Fields: Hints vs Hard Constraints

**NON-AUTHORITATIVE HINT:**
- `routing_hint` — Cost Router MAY ignore. Expresses a preference, not a
  requirement. Does NOT select a provider, model, or route.

**HARD CONSTRAINTS — Cost Router MUST NOT violate:**
- `budget_class` — maximum budget tier
- `allowed_data_classes` — data classification ceiling
- `required_capabilities` — minimum provider capabilities
- `risk_class_constraint` — derived from task risk_class
- `budget_constraints` — numeric ceilings (calls, tokens, cost)
- Security/policy restrictions from project configuration

Cost Router MAY ignore `routing_hint`. Cost Router MUST NOT violate hard
project/task policy constraints.

**No implicit scope expansion.** If the agent discovers a needed change outside
`allowed_scope`, it must STOP and report, not expand.

---

## 9. Agent Loop State Machine

### 9.1 States

| STATE | MEANING |
|---|---|
| `READY` | Task accepted, no work started |
| `PRECHECK` | Environment, dependencies, scope validated |
| `CONTEXT_READY` | Minimum context loaded, handoff prepared |
| `RED_OR_BASELINED` | Code/bug tasks: TDD RED or reproduced failure. Docs/config/design tasks: pre-change baseline captured |
| `ROUTED` | For Path B tasks: Cost Router returned valid RoutingDecision via existing AiExecutor boundary. For Path A tasks without routed model execution: skip to EXECUTING |
| `EXECUTING` | Coding agent implementing within approved scope |
| `TARGETED_VERIFY` | Running task-specific verification |
| `FAILURE_TRIAGE` | Verification failed → classify failure before any transition |
| `FULL_VERIFY` | Running broader verification. Every task enters this state. Checks not applicable to the task class record NOT_APPLICABLE. |
| `SECURITY_VERIFY` | Every task enters this state. Non-security tasks record NOT_APPLICABLE with reason. Security-sensitive tasks require real review. |
| `SCOPE_VERIFY` | Verifying no scope expansion occurred |
| `VERIFIED` | All gates passed, evidence recorded |
| `BLOCKED_ENVIRONMENT` | Docker/DB/Redis/Ollama unavailable |
| `BLOCKED_PROVIDER` | Required AI provider unavailable |
| `BLOCKED_SPEC` | Spec/plan ambiguity, contradiction |
| `BLOCKED_SECURITY` | Security gate failed |
| `BLOCKED_ARCHITECTURE` | Task conflicts with constitution or ADR |
| `BLOCKED_TEST_INFRASTRUCTURE` | Test runner, config, or fixture issue |
| `FAILED` | Attempt budget exhausted, task failed |

### 9.2 Valid Transitions

```text
READY → PRECHECK
PRECHECK → CONTEXT_READY | BLOCKED_ENVIRONMENT
CONTEXT_READY → RED_OR_BASELINED | BLOCKED_SPEC
RED_OR_BASELINED → ROUTED | EXECUTING (Path A, no routed model execution needed)
ROUTED → EXECUTING | BLOCKED_PROVIDER
EXECUTING → TARGETED_VERIFY
TARGETED_VERIFY → FULL_VERIFY | FAILURE_TRIAGE
FULL_VERIFY → SECURITY_VERIFY | FAILURE_TRIAGE
SECURITY_VERIFY → SCOPE_VERIFY | BLOCKED_SECURITY
SCOPE_VERIFY → VERIFIED | FAILURE_TRIAGE

FAILURE_TRIAGE → EXECUTING (only when classified CODE_FIXABLE + budget remains)
FAILURE_TRIAGE → BLOCKED_ARCHITECTURE
FAILURE_TRIAGE → BLOCKED_TEST_INFRASTRUCTURE
FAILURE_TRIAGE → BLOCKED_SPEC
FAILURE_TRIAGE → BLOCKED_SECURITY
FAILURE_TRIAGE → BLOCKED_ENVIRONMENT
FAILURE_TRIAGE → BLOCKED_PROVIDER
FAILURE_TRIAGE → FAILED (budget exhausted or FLAKY confirmed)

BLOCKED_* → human review (terminal for this attempt)
FAILED → human review (terminal)
VERIFIED → next task (terminal, success)
```

### 9.3 FAILURE_TRIAGE Gate

**No failed verification may return to EXECUTING until classified.** The
`FAILURE_TRIAGE` state is mandatory between any verification failure and the
next action. Only `CODE_FIXABLE` with remaining correction budget permits
re-entry to `EXECUTING`.

### 9.4 RED_OR_BASELINED for Non-Code Tasks

For code/bug tasks: TDD RED or reproduced failure.

For docs/config/design tasks where RED is not meaningful: capture PRE-CHANGE
BASELINE and acceptance evidence. Do not invent a failing test just to satisfy
the state name.

### 9.5 Conditional Verification States — Consistent Model

**Every task enters `FULL_VERIFY` and `SECURITY_VERIFY`.** Checks not applicable
to the task class record `NOT_APPLICABLE` with a reason. Never fake `PASS` for a
check that did not apply.

- `FULL_VERIFY`: runs the verification layers applicable to the task's
  `task_class` (see §17). Non-applicable layers record `NOT_APPLICABLE`.
- `SECURITY_VERIFY`: non-security tasks record `NOT_APPLICABLE` with reason.
  Security-sensitive tasks (`security_class: high | critical` or
  `risk_class: security_critical`) require real security review evidence.

A `NOT_APPLICABLE` in `FULL_VERIFY` or `SECURITY_VERIFY` is a valid terminal
result for that check — it does not block progression to the next state.

### 9.6 Forbidden Transitions

- `EXECUTING → VERIFIED` (must pass all verification gates)
- `TARGETED_VERIFY → EXECUTING` (must pass through FAILURE_TRIAGE)
- `FULL_VERIFY → EXECUTING` (must pass through FAILURE_TRIAGE)
- `SECURITY_VERIFY → EXECUTING` (must pass through FAILURE_TRIAGE)
- `SCOPE_VERIFY → EXECUTING` (must pass through FAILURE_TRIAGE)
- `BLOCKED_PROVIDER → EXECUTING` (no automatic provider fallback)
- `FAILED → EXECUTING` (no autonomous retry after budget exhaustion)
- Any state → `VERIFIED` without evidence

---

## 10. Failure Classifier

### 10.1 Failure Classes

| CLASS | DESCRIPTION | RESPONSE |
|---|---|---|
| `CODE_FIXABLE` | Implementation error, test failure, lint/type error | Apply correction within attempt budget |
| `ENVIRONMENT` | Docker, DB, Redis, Ollama, network unavailable | Diagnose; no production code changes allowed |
| `PROVIDER` | AI provider unavailable, quota exhausted, timeout | Record; no hidden fallback to another provider |
| `FLAKY` | Non-deterministic test failure | Max 1 controlled reproduction; if still flaky → FAILED |
| `SPEC_AMBIGUITY` | Specification unclear or contradictory | STOP → BLOCKED_SPEC; request human clarification |
| `SECURITY` | Security gate failure or discovered vulnerability | STOP → BLOCKED_SECURITY; require security review |
| `ARCHITECTURE` | Task conflicts with constitution or ADR | STOP → BLOCKED_ARCHITECTURE; require architecture review |
| `TEST_INFRASTRUCTURE` | Test runner, config, or fixture issue | STOP → BLOCKED_TEST_INFRASTRUCTURE; diagnose infrastructure separately |

### 10.2 Classification Rules

- **ENVIRONMENT:** Diagnose environment state. Production code modification is
  forbidden. A cold-start Ollama timeout is an ENVIRONMENT issue, not a reason
  to modify OllamaAdapter.

- **PROVIDER:** No hidden provider escalation. If the routed provider is
  unavailable, transition to `BLOCKED_PROVIDER`. Do not silently select a
  different provider.

- **FLAKY:** Maximum one controlled reproduction. If the failure cannot be
  reliably reproduced, classify as FLAKY and transition to FAILED. Do not loop.

- **ARCHITECTURE:** Stop immediately → `BLOCKED_ARCHITECTURE`. If the task
  would violate PROJECT_CONSTITUTION or an existing ADR, report the conflict.

- **TEST_INFRASTRUCTURE:** Stop immediately → `BLOCKED_TEST_INFRASTRUCTURE`.
  Isolate from code. A broken test runner is not a reason to edit production
  code.

**Anti-pattern explicitly banned:** "test failed → immediately edit production
code" without classification through FAILURE_TRIAGE.

---

## 11. Attempt Budget

### 11.1 Single Counter

There is ONE global code-changing correction counter per atomic task.

| PHASE | MAX ATTEMPTS |
|---|---|
| Initial implementation | 1 |
| CODE_FIXABLE correction cycles | 2 |
| **Total code-changing attempts per task** | **3** |

### 11.2 Budget Rules

1. **The correction counter NEVER resets inside the task.** No attempt
   subdivision. No failure-class-based reset.

2. Any production/code-changing correction consumes one correction cycle.

3. Environment or provider diagnosis does NOT consume a code correction cycle
   unless code is actually changed.

4. After budget exhaustion: STOP → compact handoff → human or stronger reviewer.

5. No unlimited retries. No silently increasing timeout until green.

6. No splitting a task into sub-attempts to circumvent budget.

---

## 12. AI Cost Router Integration (Path B Only)

### 12.1 Two Distinct Paths

**Path A** (coding-agent workflow execution): Spec Kit → Agent Loop → Spec Kit
integration → coding harness. No Cost Router involvement.

**Path B** (routed model/provider execution): when the workflow/task needs to
call an AI model through the existing routing infrastructure. Uses the existing
AiExecutor public API.

### 12.2 Sole Routing Authority

`packages/ai-cost-system/` is the **only** component that selects AI routes,
providers, and models. No other layer may perform this function.

| LAYER | MAY SELECT ROUTE? |
|---|---|
| Spec Kit | NO |
| Agent Loop | NO |
| Spec Kit Integration | NO |
| Coding Agent | NO |
| AI Cost System (CostRouter) | **YES — sole authority** |

### 12.3 Path B Integration Through Existing AiExecutor

When a task requires routed model execution:

```text
Agent Loop prepares:
  - Task Contract (canonical)
  - Routing context (hard constraints + non-authoritative hint)
        │
        ▼
EXISTING AiExecutor (public API from packages/ai-cost-system):
  CostRouter.evaluate(routingRequest, routingContext)
  → RoutingDecision
  → ExecutionCoordinator.execute(...)
  → invoker → adapter
        │
        ▼
Agent Loop receives result
  → routes to verification pipeline
```

### 12.4 The New Workflow Must NOT Invoke CostRouter Directly

Agent Loop integrates through the existing PUBLIC AiExecutor API where routed
model/provider execution is required. If AiExecutor already owns the CostRouter
call, the workflow must not duplicate that call.

### 12.5 What Agent Loop Must NOT Duplicate

- RoutingDecision schema (use existing exported types)
- RoutingRequest construction (use existing CostRouter API via AiExecutor)
- Provider invocation (use existing invokers)
- Retry logic (use existing coordinator)
- Provider selection (use existing CostRouter)
- Execution coordination (use existing ExecutionCoordinator)

Exact exported type names and variants:
> IMPLEMENTATION-TIME VERIFICATION REQUIRED — confirm against
> `packages/ai-cost-system/src/index.ts` at implementation time.

### 12.6 Non-Executable Routing Decisions

Non-executable routing decisions must preserve current Phase 3G.4 behavior.
Do not silently convert them into executable routes.

### 12.7 Provider Unavailability

If the Cost Router selects a provider that is unavailable at execution time:

1. Classify as `BLOCKED_PROVIDER`
2. Do NOT re-route
3. Do NOT fall back to a cheaper or more expensive provider
4. Report: provider, reason unavailable, task state, evidence

### 12.8 Forbidden Behaviors

- Hidden provider fallback (LOCAL unavailable → silently go to CHEAP_CLOUD)
- Hidden escalation (CHEAP_CLOUD → automatically try STRONG)
- Automatic Claude escalation (Claude only when router explicitly selects)
- Budget bypass (exhausted budget → try anyway)
- STOP bypass (router says DENIED → try anyway)
- Provider self-selection by coding agent ("I'll use Claude for this")

---

## 13. Context Handoff

### 13.1 Design Principle

Context handoff must be **minimal, sufficient, reproducible, and
model-independent.** Conversation history is not transferred between agents.

### 13.2 Canonical Handoff Packet

```json
{
  "schema_version": 1,
  "task": { "/* full Task Contract */": "..." },
  "spec_refs": ["path/to/spec.md"],
  "plan_refs": ["path/to/plan.md"],
  "relevant_symbols": ["ClassName", "functionName"],
  "relevant_files": ["path/to/file.ts"],
  "previous_failure": {
    "class": "CODE_FIXABLE",
    "description": "string",
    "evidence": "test output / error"
  },
  "test_evidence": {
    "last_run": "ISO timestamp",
    "results": { "passed": 100, "failed": 1, "skipped": 0 },
    "failed_tests": ["test name"]
  },
  "routing_decision": { "/* RoutingDecision from CostRouter, if Path B was used */": "..." },
  "security_notes": "any security-relevant context",
  "open_problem": "exact unresolved question or null"
}
```

### 13.3 Context Loading Rules

1. Load task contract first; then spec/plan refs; then relevant symbols via
   Serena; then only the files/symbols listed in `allowed_scope`.
2. Never bulk-read `apps/`, `packages/`, `docs/` or the full repository.
3. Use Serena for symbol navigation; Context7 only when local evidence
   insufficient.
4. Do not include `node_modules`, `dist/`, `.git/`, build outputs, caches,
   or `.env` values.

---

## 14. Tool Policy

Tool policy is owned by the project, not by individual coding agents.

### 14.1 Tool Access Authority Model

`CodingAgentProfile.tool_access` = declared capability/availability metadata.

Actual permission to use a tool is granted by:
1. Project policy (AGENTS.md, AI Cost Routing Policy)
2. Task contract (allowed_scope, forbidden_scope)
3. Workflow gates (human approval for sensitive operations)
4. Runtime/environment enforcement (available tools, sandboxing)

**Profile alone NEVER grants privileged tool permission.**

### 14.2 Tool Assignment

| TOOL | PURPOSE | WHEN TO USE | POLICY OWNER |
|---|---|---|---|
| Serena | Symbol/navigation/context | Before broad file reads | Project (Serena config) |
| Context7 | Current third-party docs | Only when local evidence insufficient | Project (AGENTS.md) |
| Playwright | Browser/E2E | After unit/integration/API pass | Project (Playwright config) |
| Sentry | Staging/production incidents | Minimum necessary event data | Project (AGENTS.md) |
| Git | Version control, isolation, evidence | Within Agent Loop safety rules | Project (Git safety rules) |
| Shell | Build, test, lint, typecheck | Bounded commands within task scope; see §22 for security rules | Project (AGENTS.md, §22) |

### 14.3 Tool Access by Coding Agent

Determined by `CodingAgentProfile.tool_access` as declared metadata. Actual
enablement is gated by project policy + task contract + workflow + runtime,
not by the profile field alone.

---

## 15. Git Safety

### 15.1 Branch Model

- `main` = stable protected branch. Never force-push, never reset, never
  delete.
- Feature development = feature branch → isolated worktree (where appropriate)
  → atomic task → verification → review → merge.

### 15.2 Forbidden Without Human Gate

- `git push --force`
- `git reset --hard` on shared branches
- Branch deletion (`git branch -D`)
- Destructive migration execution
- Production deployment
- Secret modification or rotation
- Remote URL changes

### 15.3 Coding Agent Git Permissions

| OPERATION | PERMITTED? | CONDITION |
|---|---|---|
| `git status` | YES | Always |
| `git diff` | YES | Always |
| `git add` (scoped) | YES | Only task-related files, verified against allowed_scope |
| `git commit` | YES | With human-approved message |
| `git push` (feature branch) | YES | After verification PASS |
| `git push --force` | NO | Requires human |
| `git reset --hard` | NO | Requires human |
| `git branch -D` | NO | Requires human |
| `git rebase` | NO | Requires human |

---

## 16. Security

### 16.1 Absolute Prohibitions

- Raw secrets in prompts, specs, plans, or task contracts
- Raw secrets in logs or accounting records
- API keys, tokens, or credentials committed to repository
- PII in accounting records or cache entries
- AI output treated as authority for privileged security decisions
- Automatic lowering of test or security requirements
- Automatic RLS or auth bypass
- Incidental security-boundary changes during non-security tasks

### 16.2 Security-Sensitive Tasks

A task classified as `security_class: high | critical` or
`risk_class: security_critical` must pass an explicit security review gate
(`SECURITY_VERIFY` state) before `VERIFIED`.

The `ikimetr-security-review` skill may **orchestrate** security review — it is
not itself proof. Security evidence must include applicable deterministic checks
and review evidence. High/critical security boundary changes require a
human-authorized review gate according to project policy.

No AI brand receives automatic privileged trust for security decisions.

### 16.3 Secret Scanning

Secret verification is NOT equivalent to manual `git diff` review. The design
requires:

1. **Automated scoped secret scan** (exact tool: IMPLEMENTATION-TIME
   VERIFICATION REQUIRED)
2. **Manual/scoped diff review** for context that scanners miss
3. Never persist raw secret values in evidence

### 16.4 Environment Security

- `.env` and `.env.*` (except `.env.example`) are git-ignored
- `.env.example` contains placeholders only — no real credentials
- Docker containers bind to localhost only
- Ollama endpoint is `127.0.0.1:11434` only — never LAN-exposed
- No automatic production deployment from any coding agent

---

## 17. Verification Matrix

### 17.1 Verification Layers

| LAYER | COMMAND/METHOD | WHEN REQUIRED |
|---|---|---|
| Acceptance criteria | Task-specific assertions | Always |
| Targeted tests | `vitest run <specific-file>` | After implementation |
| Unit tests | `pnpm test:unit` | Coding tasks |
| Integration tests | `pnpm test:integration` | API/database/infra tasks |
| TypeScript | `pnpm typecheck` | Coding tasks |
| Lint | `pnpm lint` | Coding tasks |
| Build | `pnpm build` | Coding tasks |
| Playwright E2E | Playwright CLI | UI tasks after lower layers |
| Security review | ikimetr-security-review + human gate if required | Security-sensitive tasks |
| Automated secret scan | IMPLEMENTATION-TIME VERIFICATION REQUIRED | Every commit for all commit-producing task classes |
| Git diff review | Manual/scoped review + tracked + untracked + staged | Every commit |
| Scope review | Diff against task allowed_scope | After implementation |
| Cost/accounting evidence | Ledger events | AI-involved tasks |

### 17.2 Task Class → Required Verification

| TASK CLASS | REQUIRED LAYERS |
|---|---|
| `DOCS_ONLY` | Acceptance criteria, git diff review, scope review, automated secret scan |
| `PURE_LOGIC` | Unit, typecheck, lint, build, acceptance, scope, automated secret scan |
| `API` | Unit, integration, typecheck, lint, build, acceptance, scope, automated secret scan |
| `DATABASE` | Unit, integration, typecheck, lint, build, acceptance, scope, automated secret scan |
| `AUTH_SECURITY` | All above + security review + automated secret scan |
| `UI` | Unit, integration, Playwright E2E, typecheck, lint, build, acceptance, scope, automated secret scan |
| `INFRA` | Integration, build, acceptance, scope, automated secret scan |
| `AI_PROVIDER` | Unit, integration, typecheck, lint, build, cost accounting, acceptance, scope, automated secret scan |
| `CROSS_MODULE` | Unit, integration, typecheck, lint, build, acceptance, scope (all affected modules), automated secret scan |

**Automated secret scan is required at every commit for all commit-producing
task classes.** It may be recorded as `NOT_APPLICABLE` only with a justified
reason (e.g., the task produces zero new or modified files that could contain
secrets, and this is explicitly documented in the verification evidence).

### 17.3 Verification Evidence Result

Each check produces one of:

- `PASS` — check executed successfully
- `FAIL` — check executed and failed
- `NOT_APPLICABLE` — check not required for this task class; requires a reason

Never fake `PASS` for a check that did not apply.

### 17.4 Tracked, Untracked, and Staged Coverage

Verification design must explicitly cover:

1. **Tracked modifications** — `git diff`
2. **New/untracked task files** — verify against allowed_scope
3. **Staged files before commit** — scoped staging only

Do not use a broad `git add`. Use scoped verification against Task Contract
`allowed_scope`. At commit gate, verify exact staged scope and whitespace.

Do not say "git diff clean" when task modifications intentionally exist.
Use: "diff contains only authorized task scope and passes whitespace validation."

---

## 18. Definition of Done

### 18.1 VERIFIED State Requirements

A coding agent claiming DONE is not proof. The `VERIFIED` state requires
evidence.

### 18.2 VerificationEvidence (canonical)

```json
{
  "schema_version": 1,
  "task_id": "string",
  "checks": [
    {
      "check_name": "unit-tests",
      "command_or_method": "pnpm test:unit",
      "timestamp": "ISO 8601",
      "result": "PASS | FAIL | NOT_APPLICABLE",
      "result_reason": "string (required when NOT_APPLICABLE)",
      "exit_status": 0,
      "artifact_ref": "path/to/output or null",
      "summary": "32 files / 379 tests passed"
    }
  ],
  "final_status": "VERIFIED | FAILED",
  "scope_diff": "files actually changed vs allowed_scope",
  "verified_by": "agent_id",
  "verified_at": "ISO 8601"
}
```

### 18.3 VERIFIED Gate

A task reaches `VERIFIED` only when:
1. All required verification layers (per task class) return PASS or
   NOT_APPLICABLE with reason
2. Scope review confirms no files outside `allowed_scope` were modified
3. Tracked, untracked, and staged changes are all within authorized scope
4. Security review passed (if required by security_class)
5. Automated secret scan passed (if task produced committable files)
6. All VerificationEvidence artifacts are recorded

---

## 19. Execution Audit

### 19.1 Execution Record (canonical)

```json
{
  "schema_version": 1,
  "run_id": "uuid",
  "task_id": "string",
  "agent_profile": "agent_id",
  "execution_path": "path_a | path_b | path_a_and_b",
  "routing_decision": { "/* RoutingDecision from CostRouter, if Path B used */": "..." },
  "attempt": 1,
  "started_at": "ISO 8601",
  "finished_at": "ISO 8601",
  "failure_classification": "CODE_FIXABLE | null",
  "state_transitions": [
    "READY → PRECHECK",
    "PRECHECK → CONTEXT_READY"
  ],
  "checks_executed": ["unit-tests", "typecheck", "lint"],
  "changed_scope": {
    "files": ["changed/file.ts"],
    "lines_added": 42,
    "lines_removed": 3
  },
  "verification_refs": ["evidence-uuid-1", "evidence-uuid-2"],
  "cost_accounting_ref": "ledger-event-uuid",
  "final_status": "VERIFIED | FAILED | BLOCKED_*"
}
```

### 19.2 Audit Storage Rules

- Store execution records as append-only JSONL (same pattern as ledger)
- Never store: raw secrets, full sensitive prompts, unnecessary PII
- Each run produces exactly one execution record
- Records are immutable after write

---

## 20. Spec Kit Customization Strategy

### 20.1 Principle

Do not fork upstream Spec Kit. İkiMetr customizations must be:
- project-local
- minimal
- separated from Spec Kit core
- documented
- upgrade-safe

### 20.2 Native Spec Kit Workflow by Default

Spec Kit has native workflow concepts including:
- ordered steps
- prompt/command/shell steps
- human gates
- conditions
- pause/resume
- persisted workflow run state
- project-local workflow overlays

İkiMetr Agent Loop MUST first be implemented using these native primitives.
Custom TypeScript runtime code (`packages/agent-loop`) is a FALLBACK, permitted
only when Phase A–D produce documented evidence that a required invariant cannot
be enforced safely using supported Spec Kit mechanisms.

### 20.3 Coding Agent Integration Strategy

Default: native Spec Kit integration first.

Current official architecture includes isolated native integrations for:
- Codex
- Claude
- Qwen

Generic integration may support an unknown future coding agent.

Custom project CodingAgentAdapter is FALLBACK only — used only when
native/generic integration cannot meet a documented requirement.

Do NOT create custom adapters for Codex, Claude, or Qwen merely because they
exist. Use their native Spec Kit integrations.

### 20.4 Single Default Integration

Spec Kit has one active/default integration at a time. Multiple safe coding-agent
integrations may coexist. The default integration is an operational
configuration — NOT a Cost Router decision.

Switching the default integration must not change:
- Project governance
- Cost Router policy
- Task semantics
- Security requirements

No brand is hardcoded as a permanent architectural default.

### 20.5 What NOT to Do

- Fork Spec Kit repository
- Patch Spec Kit internals (node_modules modifications)
- Hardcode unverified CLI flags as permanent contracts
- Create a parallel specification system
- Duplicate Spec Kit's planning engine

---

## 21. Constitution Strategy

### 21.1 Single Canonical Source

Canonical governance source: `docs/PROJECT_CONSTITUTION.md`

Spec Kit requires its own runtime constitution location:
`.specify/memory/constitution.md`

### 21.2 Derived Compatibility Mirror

`.specify/memory/constitution.md` is a **derived compatibility mirror**, NOT a
second independently maintained constitution.

Required invariant:
- `docs/PROJECT_CONSTITUTION.md` = canonical human/project governance source
- `.specify/memory/constitution.md` = Spec Kit-compatible generated/synchronized
  projection

The mirror must contain metadata:
- `canonical_source`: `docs/PROJECT_CONSTITUTION.md`
- `canonical_version` or source hash
- `generated_timestamp` / `synchronized_timestamp` where appropriate

### 21.3 Synchronization Rules

1. No independent manual amendments may be made to both files.
2. A synchronization/consistency check must fail closed if they diverge.
3. The default `speckit.constitution` behavior must NOT be allowed to
   independently rewrite governance until a safe override/sync strategy is
   verified and implemented.

Exact mechanism: IMPLEMENTATION-TIME VERIFICATION REQUIRED.

---

## 22. Spec Kit Workflow Security Model

### 22.1 Shell Execution is NOT a Sandbox

Spec Kit workflow shell execution provides orchestration, NOT security
isolation. Do not assume that Spec Kit profile metadata or `requires` fields
enforce OS-level permissions.

### 22.2 Required Shell Security Rules

1. **Shell steps use fixed/allowlisted commands wherever possible.**
   Workflow definitions should specify exact command paths and arguments.

2. **Arbitrary model-generated shell commands are forbidden.**
   A coding agent's output must not be directly interpolated into a shell
   command without validation.

3. **Untrusted/user/model-controlled values must not be interpolated directly
   into shell commands.** If dynamic arguments are required, use an explicit
   validation/escaping strategy appropriate to the shell and platform.

4. **Destructive or sensitive shell steps require a human authorization gate**
   in the workflow before execution. Examples: database migrations, file
   deletions outside task scope, infrastructure changes.

5. **Project security policy remains authoritative.** Spec Kit workflow
   definitions cannot override AGENTS.md, the AI Cost Routing Policy, or
   PROJECT_CONSTITUTION security rules.

6. **If runtime enforcement is required and Spec Kit cannot enforce it
   natively,** use the minimum external guard/helper rather than pretending a
   profile or workflow definition is a sandbox.

### 22.3 Enforcement Mechanism

Exact enforcement mechanism for shell security rules:
IMPLEMENTATION-TIME VERIFICATION REQUIRED — depends on installed Spec Kit
version's workflow capabilities, available guard tools, and platform (WSL).

---

## 23. Installation Safety Design

### 23.1 Installation Procedure (future)

```
1. Create clean feature branch from synchronized main
2. Record pre-install baseline:
   - git status (all files, tracked and untracked)
   - git log -1 (baseline commit hash)
   - inventory of existing agent integration directories
3. Install Spec Kit foundation (minimum required)
4. Immediately inspect:
   - git status (all new/modified files)
   - git diff (exact changes to tracked files)
   - list of new untracked files/directories
5. Collision audit:
   - Compare generated files against pre-install collision matrix (§28)
   - Flag any unexpected overwrites
6. Restore/merge:
   - AGENTS.md must remain authoritative
   - Existing .agents/skills/ and .claude/skills/ files must be preserved
   - Any overwritten project file must be restored or merged
7. Verify project still builds and tests pass
8. Commit: "chore: install Spec Kit foundation with collision-safe integration"
```

### 23.2 Installer Constraints

The Spec Kit installer never automatically:
- Overwrites AGENTS.md without explicit review
- Overwrites existing project skill files
- Modifies config/ai-cost/
- Modifies packages/ai-cost-system/
- Changes package.json without explicit review
- Executes destructive Git operations

---

## 24. Update Strategy

### 24.1 Spec Kit Updates — Manifest-Aware

Prefer the official manifest-aware project update model:

1. Inspect integration status via supported mechanism
2. Upgrade installed integration through the supported integration upgrade path
3. Update extensions/presets/workflows through their supported mechanisms
4. Inspect diffs
5. Preserve locally modified managed files
6. Isolated update branch
7. Full verification before merge

### 24.2 Fallback Only

Re-running broad init with `--force` is FALLBACK only, not routine update
strategy. Exact commands must be confirmed against installed version immediately
before execution. Do not blindly use `--force`.

### 24.3 Design Constraint

The integration must not require manual patching of Spec Kit core after every
upstream upgrade. Customizations live in project space, not in Spec Kit
internals.

---

## 25. Concurrency

### 25.1 Single-Task Rule

Two coding agents must never simultaneously edit:
- The same atomic task
- The same worktree
- The same mutable files

### 25.2 Future Parallel Execution

Parallel execution is permitted ONLY when:
- Tasks are proven independent (no overlapping files, symbols, or packages)
- Each task runs in its own isolated git worktree
- Verification is per-worktree before merge

### 25.3 Explicitly Banned

- Multi-agent swarm on one task
- Shared mutable state between concurrent agents
- Implicit conflict resolution ("agent B overwrites agent A's changes")

---

## 26. Recovery

### 26.1 Recovery Scenarios

| SCENARIO | RECOVERY |
|---|---|
| Agent crash mid-execution | Handoff packet has task state. Next agent loads from `RED_OR_BASELINED` or last checkpoint |
| Provider quota exhaustion | Task transitions to `BLOCKED_PROVIDER`. Wait for quota reset or human re-route |
| Provider outage | `BLOCKED_PROVIDER`. No automatic fallback |
| Context loss (terminal restart) | Load Task Contract + last execution record + verification evidence |
| Partial attempt (committed but unverified) | `git log` shows what was done. Load task, re-run verification from `TARGETED_VERIFY` |
| Verification failure after correction budget exhausted | `FAILED`. Compact handoff to human |

### 26.2 Design Principle

Canonical artifacts (Task Contract, execution records, verification evidence)
must allow a different agent to continue the task without replaying
conversation history.

---

## 27. Phased Delivery

### Phase A — Spec Kit Foundation + Collision-Safe Integration

- **Goal:** Spec Kit installed, initialized on existing repo, zero destructive collisions
- **In scope:** Install Spec Kit, pin version, run init, inspect all diffs, restore protected files, configure project references, verify native workflow capabilities
- **Out of scope:** Agent Loop implementation, task execution, any code changes
- **Expected files:** `.specify/`, integration directories, possibly updated `package.json` (scripts only)
- **Risks:** AGENTS.md conflict, `.agents/skills/` and `.claude/skills/` merge, package.json merge conflict
- **Verification gate:** `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` PASS, git diff reviewed, protected files intact
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline, Spec Kit manifest/hash data, and scoped git diff; follow §31. If provenance is uncertain, STOP for human review.

### Phase B — Canonical Task Contract + Coding Agent Profiles

- **Goal:** Canonical Task Contract schema, CodingAgentProfile definitions, CodingAgentRegistry, mapping to native Spec Kit task artifacts
- **In scope:** JSON schemas, TypeScript types, validation, profile definitions
- **Out of scope:** Agent Loop execution, routing, any code execution
- **Expected files:** Schema/type definitions — IMPLEMENTATION-TIME VERIFICATION REQUIRED: select minimum project-local location after inspecting installed Spec Kit artifact formats.
- **Risks:** Schema mismatch with Spec Kit task format
- **Verification gate:** Schema validation, typecheck, Spec Kit compatibility check
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase C — Thin Agent Loop as Native Spec Kit Workflow

- **Goal:** İkiMetr Agent Loop implemented as native Spec Kit workflow/overlay with human gates and bounded one-task execution
- **In scope:** Spec Kit workflow definition, human approval gates, state tracking via Spec Kit native persistence
- **Out of scope:** Custom orchestration engine, custom state machine runtime, provider/model calls
- **Expected files:** Spec Kit workflow/overlay files in `.specify/` or project space
- **Risks:** Spec Kit workflow primitives insufficient for required invariants
- **Verification gate:** Workflow parses and validates; dry-run with mock task
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase D — Failure Classifier + Verification Evidence

- **Goal:** Failure classification logic, VerificationEvidence schema, evidence recording, security/scope gate semantics
- **In scope:** Classification rules, evidence types, evidence collector — using minimum custom helpers only where Spec Kit primitives cannot express the logic
- **Out of scope:** Custom execution runtime
- **Expected files:** Classification config, evidence schema — IMPLEMENTATION-TIME VERIFICATION REQUIRED: select minimum project-local location after inspecting installed Spec Kit artifact formats.
- **Risks:** Classification too coarse or too fine
- **Verification gate:** Classification rule validation, evidence schema validation
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase E — Integrate with Existing AiExecutor (Path B)

- **Goal:** For Path B routed model execution: integrate through the existing PUBLIC AiExecutor API. No direct CostRouter calls.
- **In scope:** Wire Spec Kit workflow steps to existing AiExecutor public API boundary where routed model/provider execution is required. No router duplication.
- **Out of scope:** Modifying Cost Router, changing routing policy, new invokers, coding-agent selection
- **Expected files:** Workflow step definitions referencing existing `packages/ai-cost-system` public API
- **Risks:** Coupling workflow to Cost Router internals; use public API only
- **Verification gate:** Integration test through existing AiExecutor, no routing policy changes, no CostRouter internals accessed
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase F — One DOCS_ONLY Controlled Pilot

- **Goal:** Execute one real DOCS_ONLY task through full pipeline: Spec Kit → Task Contract → Agent Loop → Spec Kit native integration → Coding Agent → Verify
- **In scope:** One task, one coding agent with native Spec Kit integration (e.g., Qwen Code), full verification pipeline
- **Out of scope:** Multi-agent, multi-task, complex code changes, custom adapters
- **Expected output:** Execution record, verification evidence, audit trail
- **Risks:** Hidden assumptions, tool access issues
- **Verification gate:** Task VERIFIED with all required evidence
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase G — One Small Code Pilot

- **Goal:** Execute one real PURE_LOGIC code task through full pipeline
- **In scope:** One code task, verification, correction cycle if needed
- **Out of scope:** Multi-file, cross-module, database changes
- **Risks:** Code changes require broader verification
- **Verification gate:** Task VERIFIED, all tests pass, scope verified
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Phase H — Additional Coding Agent Integrations (Only As Needed)

- **Goal:** Support additional coding agents ONLY when a documented requirement exists
- **In scope:**
  1. For agents with native Spec Kit integration: enable the native integration (no custom adapter).
  2. For agents without native integration: use Spec Kit generic integration where appropriate.
  3. ONLY AS FALLBACK: create a custom CodingAgentAdapter/bridge when native/generic cannot meet a documented requirement.
- **Out of scope:** Creating custom adapters for Codex, Claude, or Qwen (use their native integrations); changing Agent Loop workflow core
- **Expected files:** Native integration config OR generic integration config OR custom adapter (fallback only)
- **Risks:** Agent-specific quirks; custom adapter maintenance burden
- **Verification gate:** Each integration tested with mock agent workflow; custom adapters require ADR justification
- **Rollback point:** Rollback only phase-owned files proven by phase-start baseline and scoped git diff; follow §31.

### Custom Runtime FALLBACK Gate

Only if Phase A–D produce documented evidence that native Spec Kit mechanisms
cannot enforce a required invariant may a custom `packages/agent-loop` runtime
be introduced. This requires an explicit ADR with:
- The specific invariant that cannot be enforced natively
- Evidence of attempted native implementation
- Justification for custom code
- Rollback and maintenance plan

---

## 28. Pre-Install Collision Matrix

Detailed file-by-file collision prediction based on current project state and
current official Spec Kit integration architecture:

| PATH | CURRENT PURPOSE | CURRENT OWNER | SPEC KIT MAY TOUCH? | RISK | PRESERVE/MERGE/GENERATE | IMPLEMENTATION-TIME CHECK |
|---|---|---|---|---|---|---|
| `AGENTS.md` | Universal AI agent contract | Project | Implementation-time verification required — may supplement agent context | **HIGH** | **PRESERVE** — İkiMetr AGENTS.md is authoritative; Spec Kit context is additional, not replacement | Check: exact agent-context behavior of installed version |
| `.agents/skills/` | Codex skills | Project | **WILL touch parent directory** when Codex integration installed | **HIGH** | **PRESERVE** existing skills; merge Spec Kit additions | Check: exact files generated; verify no overwrite of existing project skills |
| `.claude/skills/` | Claude skills | Project | **WILL touch parent directory** when Claude integration installed | **HIGH** | **PRESERVE** existing skills; merge Spec Kit additions | Check: exact files generated; verify no overwrite |
| `.qwen/commands/` | Not present | N/A | Expected new directory for Qwen integration | LOW | **GENERATE** (safe — no existing content) | Check: exact files/directories created |
| `.specify/` | Not present | N/A | YES — Spec Kit working directory | LOW | **GENERATE** (expected new directory) | Verify directory structure |
| `.agents/provider-profiles/` | Provider capability narrowing | Project | Not expected to be touched | LOW | **PRESERVE** as-is | Verify untouched |
| `.serena/project.yml` | Code navigation config | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |
| `.playwright/cli.config.json` | Browser automation config | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |
| `docs/PROJECT_CONSTITUTION.md` | Architecture rules — canonical source | Project | Spec Kit constitution feature; see §21 | **MEDIUM** | **PRESERVE** as canonical; `.specify/memory/constitution.md` is derived mirror | Check: Spec Kit constitution behavior; implement mirror strategy from §21 |
| `docs/ai/AI_COST_ROUTING_POLICY.md` | Provider-neutral routing policy | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |
| `docs/superpowers/specs/` | 8 design specs | Project | Spec Kit generates specs in its own output directory | LOW | **PRESERVE** both — existing specs are architectural record | Check: Spec Kit default spec output directory |
| `docs/superpowers/plans/` | 7 implementation plans | Project | Similar to specs | LOW | **PRESERVE** both | Check: Spec Kit default plan output directory |
| `config/ai-cost/` | Routing/budget/provider configs | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |
| `packages/ai-cost-system/` | Cost routing implementation | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |
| `package.json` | Root package config | Project | May add devDeps/scripts | **MEDIUM** | **MERGE** carefully — review every diff line | Check: exact package.json changes |
| `pnpm-lock.yaml` | Dependency lock | pnpm | YES — if deps change | LOW | **REGENERATE** via `pnpm install` | Check: lockfile changes are expected |
| `.gitignore` | Git exclusions | Project | May append entries | LOW | **MERGE** — review new entries | Check: gitignore diff |
| `tsconfig.json` | TypeScript config | Project | Not expected to be touched | NONE | **PRESERVE** | Verify untouched |

---

## 29. Non-Goals

Explicitly excluded from this design:

1. **General-purpose autonomous agent swarm** — system is task-at-a-time with human gates
2. **Multiple agents editing one task** — strictly single-agent per task
3. **AI chat as project memory** — only committed artifacts are canonical
4. **Second AI router** — `packages/ai-cost-system` is the sole routing authority
5. **Spec Kit fork** — use upstream, customize through supported mechanisms
6. **Second CI system** — existing pnpm scripts + verification matrix is sufficient
7. **Unlimited retry loop** — hard attempt budget with human escalation
8. **Automatic implementation of entire tasks.md** — one task at a time, human approval between
9. **Production deployment automation** — no agent deploys to production
10. **Automatic security policy modifications** — security changes require human approval
11. **Replacing AGENTS.md** — it remains the root agent contract
12. **Modifying Phase 3G.4 behavior** — existing AI Cost System is frozen until separately approved
13. **Custom TypeScript orchestration runtime** — only if native Spec Kit workflows are proven insufficient
14. **Second independently maintained constitution** — `.specify/memory/constitution.md` is a derived mirror only
15. **Cost routing in coding agent profiles** — routing is AI Cost System's sole domain
16. **Parallel task execution by default** — requires proven task independence and isolated worktrees
17. **AiExecutor as coding-agent launcher** — it routes model/provider calls, not coding harnesses
18. **Custom adapters for agents with native Spec Kit integration** — use native integration

---

## 30. Open Implementation-Time Verifications

Items that depend on the actual installed Spec Kit version. None are
pre-determined.

| # | VERIFICATION | WHY IT MATTERS |
|---|---|---|
| 1 | Installed Spec Kit version (exact semver) | Determines available features, CLI flags, customization points |
| 2 | Official installation method for existing projects | `specify init` vs `specify init --here` vs other — wrong method could overwrite files |
| 3 | Existing-project initialization behavior | Does it detect AGENTS.md? Does it skip generation? Does it warn? |
| 4 | Generated directory paths | `.specify/`, integration directories — exact paths determine collision surface |
| 5 | Agent integration paths for Codex | What exactly does it generate in `.agents/skills/`? |
| 6 | Agent integration paths for Claude | What exactly does it generate in `.claude/skills/`? |
| 7 | Agent integration paths for Qwen | What exactly does it generate in `.qwen/commands/`? |
| 8 | Multi-agent installation behavior | Can multiple integrations coexist? How does default selection work? |
| 9 | Update/upgrade mechanism | What is the supported upgrade path? Is there a manifest-aware update command? |
| 10 | Overwrite behavior on re-init | Running init twice — does it overwrite, merge, or skip? |
| 11 | Constitution feature behavior | Does it generate a constitution? Can we configure it to use a mirror instead? |
| 12 | Workflow customization mechanisms | Templates, overlays, hooks, plugins — what is officially supported? |
| 13 | Native workflow primitives | Ordered steps, human gates, conditions, pause/resume, persisted state — exact capabilities |
| 14 | Workflow shell security capabilities | Can Spec Kit enforce allowlisted commands? Can it sandbox shell execution? |
| 15 | Windows/WSL compatibility | Spec Kit CLI may assume Linux/macOS; WSL path required |
| 16 | Node/Python/uv requirements | What runtime does Spec Kit need? Does it conflict with Node 24.x? |
| 17 | Spec Kit task format | Does it match or conflict with our Atomic Task Contract schema? |
| 18 | Spec Kit spec/plan format | Can we map existing Superpowers specs/plans to Spec Kit format? |
| 19 | Exported types from `packages/ai-cost-system` | Exact type names, variants, and public API surface for Path B integration |
| 20 | Generic integration capabilities | Can Spec Kit generic integration support an unknown future coding agent? |
| 21 | Automated secret scan tool | Which tool to use for scoped secret scanning at commit gate? |

---

## 31. Rollback

### 31.1 Provenance-Based Rollback Architecture

Rollback must be provenance-based, not destructive. Never use broad `rm -rf` or
`git checkout` as automatic rollback commands. Never delete entire directories
without provenance.

**Safety model:**

1. Isolated feature branch/worktree
2. Recorded baseline commit hash before any installation
3. Pre-install inventory (file listing with hashes where practical)
4. Spec Kit install manifest/hash data where available
5. Remove/revert ONLY files proven to have been generated or modified by the
   relevant phase
6. Verify current hash/state before removal
7. Preserve unrelated user/project changes

**If safe provenance cannot be established:** STOP for human review. Never use
global `git clean` or `git reset --hard` as automatic rollback.

### 31.2 Per-Phase Rollback

Each phase has a documented rollback point (see §27 Phased Delivery). Rollback
means:
1. Identify files generated/modified by that phase (from install manifest or
   git diff relative to phase-start commit)
2. Remove/revert ONLY those files — never broad directory deletion
3. Verify `pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build` PASS

### 31.3 Rollback Must Never Affect

- `packages/ai-cost-system/`
- `config/ai-cost/`
- `.agents/provider-profiles/`
- `.agents/skills/` (except Spec Kit-generated additions, if verified safe)
- `.claude/skills/` (except Spec Kit-generated additions, if verified safe)
- `AGENTS.md`
- `docs/PROJECT_CONSTITUTION.md`
- `docs/ai/`
- Existing `docs/superpowers/`

---

## Self-Review

### Placeholder Scan

- Zero `TBD`, `TODO`, `FIXME`, or `???` placeholders
- `FUTURE_GENERIC_AGENT` is an intentional design placeholder — bounded (requires
  profile, no hardcoded assumptions)
- `IMPLEMENTATION-TIME VERIFICATION REQUIRED` markers are explicit, not hidden
  guesses
- Unknown file locations use explicit bounded language: "IMPLEMENTATION-TIME
  VERIFICATION REQUIRED — select minimum project-local location after inspecting
  installed Spec Kit artifact formats"

### Contradiction Scan vs AGENTS.md / AI Cost Routing Policy / PROJECT_CONSTITUTION

- **AGENTS.md §1 Precedence:** Source-of-truth hierarchy (§6) respects this —
  PROJECT_CONSTITUTION and AGENTS.md sit above Spec Kit output. ✓
- **AGENTS.md §2 Architecture non-negotiables:** Agent Loop does not silently
  replace any database, backend, frontend, queue, auth, or permission model. ✓
- **AGENTS.md §4 Deterministic-first routing:** AI Cost Router (§12) remains sole
  routing authority. Agent Loop does not select models. ✓
- **AI Cost Routing Policy:** All routing rules preserved. Agent Loop provides
  constraints; Cost Router makes decisions. No bypass. ✓
- **PROJECT_CONSTITUTION §19 Stepwise development:** Atomic Task Contract enforces
  bounded scope. Agent Loop state machine prevents scope expansion. ✓
- **PROJECT_CONSTITUTION §11 AI provider independence:** CodingAgentProfile
  describes capabilities; native Spec Kit integrations handle agent launch. ✓

### Targeted Correction Scans

| CHECK | RESULT |
|---|---|
| AiExecutor shown as coding-agent launcher? | **ABSENT** — Path A and Path B separated in §5; AiExecutor is Path B only, not a coding-agent launcher (§5.3) |
| Direct CostRouter call from new workflow? | **ABSENT** — Phase E integrates through public AiExecutor API (§27 Phase E); §12.4 explicitly forbids direct CostRouter calls |
| RoutingDecision selects coding harness? | **ABSENT** — Spec Kit default integration selects harness (§7.2); RoutingDecision is Path B only |
| Native Spec Kit integration preceded by custom adapter? | **ABSENT** — strategy is native first, generic second, custom fallback (§7.2, §20.3) |
| CodingAgentProfile grants permissions? | **ABSENT** — tool_access is declared metadata only; actual permission from policy+task+workflow+runtime (§7.1, §14.1) |
| Spec Kit workflow shell treated as sandboxed? | **ABSENT** — §22 explicitly states it is NOT a sandbox; 6 mandatory shell security rules |
| routing_hint conflated with hard constraints? | **ABSENT** — §8.1 separates NON-AUTHORITATIVE HINT from HARD CONSTRAINTS; Cost Router MAY ignore hint, MUST NOT violate constraints |
| TBD/TODO/FIXME/??? placeholders? | **ABSENT** — zero found |
| Broad rollback directory deletion? | **ABSENT** — §31 requires provenance-based, file-level rollback; §27 phases use provenance-safe wording |
| Five vs six concepts? | **CORRECT** — §3 title says "Six distinct concepts" (Model, Provider, Coding Agent, Tool, Workflow, Router) |
| Secret scan missing from DOCS_ONLY? | **ABSENT** — §17.2 includes automated secret scan for all commit-producing task classes including DOCS_ONLY |
| Duplicated RoutingDecision schema? | **ABSENT** — uses existing exported types from `packages/ai-cost-system` (§12.5) |
| `packages/agent-loop` assumed as mandatory? | **ABSENT** — it is FALLBACK only (§1, §20.2, §27 end) |
| Model/provider listed as coding agent? | **ABSENT** — Ollama and generic DeepSeek API correctly classified as providers in §3 and §7.4 |
| `cost_class` used for routing outside AI Cost System? | **ABSENT** — removed from CodingAgentProfile (§7.1) |
| Two independently editable constitutions? | **ABSENT** — mirror strategy in §21 enforces derived-only |
| Unclassified verify→execute transitions? | **ABSENT** — FAILURE_TRIAGE gate mandatory (§9.3) |
| Retry counter reset? | **ABSENT** — single global counter, never resets (§11.2) |
| `git diff --check` treated as covering untracked files? | **ABSENT** — §17.4 explicitly covers tracked, untracked, and staged |
| `git diff` review called a secret scanner? | **ABSENT** — §16.3 distinguishes automated secret scan from manual diff review |
| Destructive rollback commands? | **ABSENT** — §31 requires provenance-based rollback, explicitly bans broad deletion and global git clean |
| Incorrect `.agents/skills` / `.claude/skills` collision assumptions? | **CORRECTED** — §28 acknowledges Spec Kit WILL touch parent directories |
| Conditional verification states inconsistent? | **CONSISTENT** — every task enters FULL_VERIFY and SECURITY_VERIFY; non-applicable checks record NOT_APPLICABLE (§9.5) |

### Security Weakening Scan

- §16: Absolute prohibitions preserved from AGENTS.md and AI Cost Routing Policy. ✓
- §16.2: Security-sensitive tasks require explicit SECURITY_VERIFY gate; skill is
  orchestrator, not self-certifying. ✓
- §16.3: Secret scanning requires automated tool, not just manual review. ✓
- §22: Spec Kit workflow shell explicitly treated as unsandboxed with mandatory
  security rules. ✓
- Source of truth hierarchy (§6) prevents lower layers from weakening security rules. ✓
- No automatic lowering of test requirements (§16.1). ✓
- No brand-based trust for security decisions (§16.2). ✓

### Unclear Ownership Scan

- §5.4: explicit responsibility boundary table for each layer. ✓
- §3: six concepts strictly separated. ✓
- §14: tool policy owned by project; profile is metadata only. ✓
- AGENTS.md remains authoritative root. ✓

### Scope Creep Scan

- Non-goals (§29) explicitly list 18 excluded items. ✓
- This document creates/modifies ONE file. No other changes permitted. ✓
- Phase A explicitly requires collision inspection before any code. ✓

---

*End of design document — revision 3.*
