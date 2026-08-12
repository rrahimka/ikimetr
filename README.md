# İkiMetr

İkiMetr is a realtor-first workspace. The repository contains a Next.js web
app, Fastify API, independent worker, PostgreSQL/PostGIS, Redis, and the
database migration foundation. No business database tables exist yet.

## Prerequisites

- Node.js 24 and Corepack in the shell used for development
- pnpm 10 (Corepack selects the pinned version)
- Docker Engine and Docker Compose

## Local Setup

Run the following commands from one Linux or macOS shell. On Windows, use the
Ubuntu WSL shell with Docker Desktop's WSL integration enabled, then change to
the repository path under `/mnt/c/`.

1. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   corepack pnpm install --frozen-lockfile
   ```

3. Start PostgreSQL and Redis:

   ```bash
   docker compose --env-file .env -f infrastructure/compose.yaml up -d --wait
   ```

4. Export the local environment into the current shell, verify the immutable
   migration manifest, and apply pending migrations explicitly:

   ```bash
   set -a
   . ./.env
   set +a
   corepack pnpm db:migrate:verify
   corepack pnpm db:migrate:up
   ```

5. Start the web app, API, and worker:

   ```bash
   corepack pnpm dev
   ```

The web app listens on `http://127.0.0.1:3000`. The API listens on
`http://127.0.0.1:3001`, and its health endpoint is
`http://127.0.0.1:3001/health`.

The example credentials are local-only placeholders. `.env` files are ignored
by Git; use explicit environment configuration outside development.

Application, worker, and web startup never run migrations. Migration execution
is always an explicit operator or deployment action.

## Database Migrations

Every committed migration is immutable and pinned by exact-byte SHA-256 in
`packages/database/migrations/manifest.json`. Before applying migrations, run:

```bash
corepack pnpm db:migrate:verify
corepack pnpm db:migrate:up
```

`DATABASE_URL` must already be present in the command environment. Never print
or commit it. Production and managed environments must inject a dedicated
deployment-only connection whose role can install the approved extensions,
create the NOLOGIN group roles and schemas, and establish the approved
ownership. API and worker runtime credentials must not receive migration
privileges.

Create a migration with a descriptive snake-case name:

```bash
corepack pnpm db:migrate:create -- descriptive_name
# Replace the example path with the file reported by the create command.
migration_file=packages/database/migrations/1786492800000_descriptive_name.ts
corepack pnpm exec prettier --write "$migration_file"
sha256sum "$migration_file"
```

Review the migration, add its repository-relative path and exact lowercase
SHA-256 to `packages/database/migrations/manifest.json`, then rerun
`corepack pnpm db:migrate:verify`. Do not update a hash blindly: any byte change
requires review. The migration loader excludes only `manifest.json`; the
verifier still requires an exact one-to-one match between manifest entries and
migration files.

Only local disposable/development recovery may run one guarded rollback:

```bash
NODE_ENV=development corepack pnpm db:migrate:down:local
```

This command rolls back exactly one database-local migration and retains the
cluster-wide `ikimetr_app`, `ikimetr_worker`, and `ikimetr_migrator` NOLOGIN
roles. Production is forward-only: ship a new corrective migration instead of
running `down`.

Stop deployment and request a separate design decision if a managed provider
cannot create the approved roles/extensions transactionally, cannot establish
the specified ownership, or would require broader runtime privileges. Do not
weaken the migration or runtime security boundary to make deployment pass.

## Validation

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm build
corepack pnpm audit:prod
```

Validate Compose independently:

```bash
docker compose --env-file .env.example -f infrastructure/compose.yaml config --quiet
```

Stop local infrastructure without deleting its named volumes:

```bash
docker compose --env-file .env -f infrastructure/compose.yaml down
```

## Project Rules

Read `AGENTS.md`, the task specification under `specs/`, and the documents in
that task's `Read first` section before changing code. Architecture changes
require an ADR.
