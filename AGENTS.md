<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may differ from standard Next.js guidance. Read the relevant guide in node_modules/next/dist/docs/ before making code changes and heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# IkiMetr AI Operating Manual

## 1. Project Mission

IkiMetr is a modern, maintainable web application built with Next.js and TypeScript. The primary goal is to deliver a reliable product experience while keeping the codebase modular, well-documented, and easy to evolve.

## 2. Technology Stack

- Framework: Next.js 16
- UI: React 19
- Language: TypeScript
- Styling: Tailwind CSS
- Linting: ESLint
- Package manager: npm
- Runtime target: modern web browsers

## 3. Folder Responsibilities

- app/: App Router pages, layouts, and route-level entry points.
- components/: Reusable presentational UI components.
- features/: Feature-specific modules and domain logic.
- hooks/: Custom React hooks.
- lib/: Shared infrastructure and support modules.
  - lib/auth/: Authentication-related logic.
  - lib/database/: Database access and persistence logic.
  - lib/api/: API client and server integration helpers.
  - lib/ai/: AI-related services and integrations.
  - lib/validation/: Validation and schema checks.
- services/: External service integrations and application-facing adapters.
- types/: Shared TypeScript types and interfaces.
- utils/: Small reusable helpers and utilities.
- docs/: Product, architecture, and process documentation.
- assets/: Static assets and media files.
- config/: Environment and configuration modules.
- constants/: Shared constants and enums.
- providers/: Context providers and global state wrappers.
- stores/: State management modules.
- styles/: Global and shared styling primitives.

## 4. Coding Standards

- Prefer TypeScript for all new code.
- Keep code clear, readable, and intentionally structured.
- Favor small, focused modules over large monolithic files.
- Preserve existing behavior unless a change is explicitly requested.
- Avoid introducing unnecessary dependencies.
- Follow existing project conventions and keep changes scoped.
- Write code that is easy to test, review, and extend.

## 5. Naming Conventions

- Components: PascalCase, e.g. UserCard.
- Functions and variables: camelCase, e.g. getUserProfile.
- Constants and enums: UPPER_SNAKE_CASE, e.g. API_BASE_URL.
- Files and folders: lowercase with hyphens when needed, e.g. auth/session.ts.
- Type names: PascalCase, e.g. UserProfileResponse.

## 6. Security Rules

- Never hardcode secrets, API keys, tokens, or passwords.
- Use environment variables for sensitive configuration.
- Do not log sensitive user or system data.
- Validate and sanitize all user input before use.
- Avoid introducing insecure patterns or unsafe data handling.
- Respect privacy and data minimization principles.

## 7. Documentation Rules

- Update documentation when behavior, architecture, or workflows change.
- Keep product and architecture docs in docs/ current and relevant.
- Use clear, professional Markdown with concise explanations.
- Document significant changes, decisions, and trade-offs.

## 8. Architecture Principles

- Separate UI, business logic, and infrastructure concerns.
- Keep shared logic in lib/, services/, hooks/, or providers/ rather than embedding it in UI components.
- Favor modularity and maintainability over shortcuts.
- Avoid circular dependencies and unnecessary coupling.
- Preserve the existing architecture unless the task explicitly requires restructuring.

## 9. Git Workflow

- Work from a dedicated branch for each change.
- Keep commits small, focused, and meaningful.
- Use clear commit messages that describe the intent of the change.
- Rebase or merge carefully to avoid introducing unrelated changes.
- Do not push or publish changes without review when the repository policy requires it.

## 10. Pull Request Checklist

- The change is scoped and easy to understand.
- The implementation follows project conventions.
- Relevant documentation has been updated.
- No unrelated files were changed.
- The build and lint checks succeed.
- The change does not introduce regressions.

## 11. Code Review Checklist

- Is the solution correct and aligned with the request?
- Is the code readable and maintainable?
- Are naming and structure consistent with the repository?
- Are security and validation concerns addressed?
- Is the change minimal and properly scoped?
- Are tests or verification steps included where appropriate?

## 12. Rules for AI Agents

- Follow the repository instructions before making changes.
- Prefer minimal, targeted edits over broad rewrites.
- Preserve application behavior unless the request explicitly requires otherwise.
- Ask for clarification when the request is ambiguous or high risk.
- Do not make destructive changes without explicit approval.
- Keep the user informed about meaningful progress and blockers.

## 13. Forbidden Actions

- Do not modify application logic unless explicitly requested.
- Do not delete or overwrite user data.
- Do not introduce secrets or insecure credentials.
- Do not create unrelated demo pages or temporary scaffolding.
- Do not bypass validation, linting, or review processes.
- Do not make broad refactors without a clear architectural reason.

## 14. Definition of Done

A task is complete when:

- The requested work has been implemented.
- The code remains consistent with the repository architecture.
- The change is documented where appropriate.
- The project still builds and passes relevant checks.
- No regressions are introduced.
- The result is ready for review.

