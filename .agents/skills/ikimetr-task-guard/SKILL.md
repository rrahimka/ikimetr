---
name: ikimetr-task-guard
description: Keeps AI coding agents strictly inside the active IkiMetr task scope, minimizes unnecessary repository reads and token usage, and prevents architectural drift.
---

# IkiMetr Task Guard

Use this skill before implementing any IkiMetr coding task.

## Purpose

Prevent:

- scope creep;
- unnecessary repository reads;
- unnecessary token usage;
- unrelated refactoring;
- architectural drift;
- silent architecture changes.

## Required workflow

Before changing code:

1. Identify the active Task ID.
2. Read the active task specification.
3. Read `AGENTS.md`.
4. Read only documents explicitly listed in the task's `READ FIRST` section.
5. Extract:
   - GOAL
   - SCOPE
   - OUT OF SCOPE
   - SECURITY REQUIREMENTS
   - DATA CHANGES
   - API CHANGES
   - TEST REQUIREMENTS
   - DEFINITION OF DONE
6. Determine the minimum set of source files required.
7. Prefer Serena or symbol-level navigation when available.
8. Do not scan the entire repository unless technically necessary.
9. Check for conflicts with project constitution, security rules, business rules, domain model and ADRs.
10. Only then implement.

## Scope control

Do not:

- modify unrelated modules;
- add features for completeness;
- perform unrelated refactoring;
- redesign existing architecture;
- introduce major dependencies without task justification;
- replace infrastructure selected by existing ADRs.

If another module must be changed, first establish why that change is technically required by the active task.

## Token efficiency

Use context in this order:

1. Active task specification.
2. `AGENTS.md`.
3. Documents explicitly referenced by the task.
4. Relevant source files.
5. Serena targeted symbol navigation.
6. Context7 when current external documentation is actually required.

Avoid:

- repository-wide rereads;
- loading unrelated documentation;
- rereading unchanged files;
- sending large files when a relevant symbol or section is enough;
- asking several models to solve the same routine problem;
- verbose progress commentary.

Do not sacrifice correctness, testing, or security merely to save tokens.

## Rules before AI

Prefer deterministic application rules over AI decisions.

AI must not become the authority for:

- authorization;
- permissions;
- ownership;
- data visibility;
- destructive actions;
- security policy;
- critical business invariants.

## Conflict handling

If the active task conflicts with architecture, security, business rules or an ADR:

STOP.

Report:

TASK:
STATUS: BLOCKED

CONFLICT:
Exact conflict.

SOURCE:
Rule or document involved.

RECOMMENDATION:
Required specification or architecture decision.

Do not guess and do not silently redesign the system.

## Completion check

Before reporting completion verify:

- changes remain inside task scope;
- no unrelated feature was implemented;
- no security rule was weakened;
- no unjustified dependency was introduced;
- required tests were added;
- required validation commands were executed;
- documentation impact was identified.

This skill supplements and does not replace `AGENTS.md`, the active task specification, project constitution, security rules or ADRs.