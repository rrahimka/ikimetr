# İkiMetr

İkiMetr is a realtor-first workspace. This repository currently contains the
Task 00.01 technical foundation only: a Next.js web app, Fastify API,
independent worker, PostgreSQL/PostGIS, and Redis.

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

4. Start the web app, API, and worker:

   ```bash
   corepack pnpm dev
   ```

The web app listens on `http://127.0.0.1:3000`. The API listens on
`http://127.0.0.1:3001`, and its health endpoint is
`http://127.0.0.1:3001/health`.

The example credentials are local-only placeholders. `.env` files are ignored
by Git; use explicit environment configuration outside development.

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
