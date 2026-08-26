# PART 2 — Auth, Authorization & Core Domain (HANDOFF)

**Branch:** `agent/task-00-02-database-foundation`
**Depends on:** PART 1 (Database Foundation) — committed as `e83afac`, migrations added in `e8da88b`.
**Status:** IMPLEMENTED & GATE GREEN (see below).

## What was built

Implemented in `apps/api` (modular monolith, ADR-001) on top of the 3 new
migrations (`1786492900000_identity_foundation`, `1786492910000_realtor_agency`,
`1786492920000_property_core`).

### Authentication (custom, no new dependencies)
- `identity/password.ts` — password hashing with Node `crypto.scrypt` (per-password salt).
- `identity/session.ts` — 32-byte session tokens (`generateSessionToken`) + `sha256`
  token storage (`hashSessionToken`); `normalizeEmail`; `slugify`.
- `guard.ts` — `extractToken(request)` (Bearer) + `createAuthPreHandler` that injects
  `request.user` (server-side, DB-backed, revocable sessions).

### Authorization (server-side, never client-derived)
- `authz.ts` — `canManageAgency(membership, minimumRole)` and
  `canEditProperty(property, userId, membership)`. Ownership is always read from the
  database row, never the request body.

### Domain services
- `identity/service.ts` — register, login, session create/revoke/resolve, profile
  read/update, realtor read/ensure/update, agency create/read/update, membership
  add/list with role + status enforcement.
- `properties/service.ts` — property create/read/update, atomic status change with
  `property_status_history`, owner/agency-scoped listing (keyset pagination),
  image add/list.

### HTTP layer
- `routes.ts` — `registerRoutes`:
  - `POST /api/v1/auth/register`, `POST /api/v1/auth/login`,
    `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`
  - `PATCH /api/v1/realtors/me`
  - `POST /api/v1/agencies`, `GET /api/v1/agencies/:id`,
    `PATCH /api/v1/agencies/:id`, `POST /api/v1/agencies/:id/members`,
    `GET /api/v1/agencies/:id/members`
  - `POST /api/v1/my/properties`, `GET /api/v1/my/properties`,
    `GET /api/v1/my/properties/:id`, `PATCH /api/v1/my/properties/:id`,
    `POST /api/v1/my/properties/:id/status`,
    `POST /api/v1/my/properties/:id/images`,
    `GET /api/v1/my/properties/:id/images`
- `app.ts` — `buildApp` accepts `{ database, redis, connection }`, registers routes,
  and maps `AppError` → `{status, code, message}` and `ZodError` → 400
  `validation_error`.
- `errors.ts` — `AppError` hierarchy (`Unauthenticated`, `Forbidden`, `NotFound`,
  `Validation`, `Conflict`).
- `schemas.ts` — zod DTOs (re-export `z` from `@ikimetr/validation`).

## Security evidence (integration tests)
- `apps/api/test/auth.integration.test.ts`
  - strangers **cannot** read/modify an agency they don't belong to (403).
  - an added `admin` member **can** manage the agency (200).
- `apps/api/test/properties.integration.test.ts`
  - another authenticated user **cannot** GET/PATCH a property they don't own (403).
  - an **active agency member** **can** edit a property belonging to that agency (200).
  - property status changes are recorded in `property_status_history`.

## How to run
```bash
# start Postgres + Redis (Docker Desktop must be running)
docker compose --env-file .env.example -f infrastructure/compose.yaml up -d --wait

# migrations
pnpm db:migrate:up            # applies to the dev database
pnpm db:migrate:verify       # checks the 4-file manifest

# tests (DATABASE_URL must point at a live Postgres 17)
set -a && . ./.env && set +a
pnpm test:integration        # 24 passed
pnpm test:unit               # see "Known limitations"
```

## Gate results
| Gate | Result |
|------|--------|
| `pnpm db:migrate:verify` | PASS (4 migrations) |
| `pnpm test:integration` | PASS (24/24) |
| `pnpm test:unit` (relevant pkgs) | PASS (api + database) |
| `eslint` (changed files) | PASS |
| `tsc --noEmit` (api) | PASS |
| `pnpm --filter @ikimetr/api build` | PASS |
| `pnpm audit:prod` | PASS (no vulns) |
| `prettier --check` (changed files) | PASS |

## Known limitations (not regressions)
- `pnpm test:unit` shows 3 failures in
  `packages/ai-cost-system/test/ollama-acceptance.test.ts`. These are **real-network
  acceptance tests** that require a running Ollama endpoint (`fetch failed`); they are
  unrelated to PART 2 and fail in any environment without Ollama.
- `pnpm format:check` (repo-wide) still fails on 48 **pre-existing, out-of-scope**
  files (`ai-cost-system`, `apps/api` history, `config/ai-cost`, `.playwright`).
  Only PART 2 changed files were normalized with Prettier; the other files were left
  untouched on purpose.
- `packages/database/test/migrations.integration.test.ts` was updated: it previously
  asserted exactly **1** foundation migration and **0** project tables. It now asserts
  the real set of **4** migrations and the **10** `app` tables. This was required
  because PART 2 legitimately adds 3 migrations and the corresponding tables.

## Next steps (PART 3+)
- Rate limiting / brute-force protection on `/auth/login` and `/auth/register`.
- Email verification & password reset flows.
- Public property search/listing endpoints (read model) with the visibility rules
  from `docs/DATA_VISIBILITY.md`.
- Refresh-token rotation if longer sessions are needed.
