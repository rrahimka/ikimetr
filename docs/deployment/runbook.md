# İkiMetr — Deployment Runbook

> Scope: API + Worker + Web (Next.js) on a single host behind a reverse proxy.
> Postgres + Redis are provided by `infrastructure/compose.yaml` (local) and by
> managed services in production. Container images for the apps are NOT provided
> yet — build them or run the compiled output directly under a process manager.

## 1. Prerequisites

- Node.js 24.x, pnpm 10.x.
- Postgres 17 (+ PostGIS) reachable; Redis 8 reachable.
- Payment provider credentials (Stripe or Epoint) for production.
- A reverse proxy (Caddy/Traefik/nginx) for TLS + public edge. **Not** shipped.

## 2. Build

```bash
pnpm install --frozen-lockfile
pnpm build                 # builds shared, validation, database, ai-cost-system, api, worker, web
```

## 3. Environment (production)

```
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3001
DATABASE_URL=postgresql://<user>:<pw>@<host>:5432/<db>
REDIS_URL=redis://<host>:6379
SESSION_SECRET=<32+ random bytes>
PAYMENT_PROVIDER=stripe            # NEVER "test" in production
PAYMENT_PROVIDER_SECRET=<webhook signing secret>
INGESTION_SERVICE_TOKEN=<32+ random bytes>   # omit to disable ingestion
API_CORS_ORIGINS=https://app.example.com,https://www.example.com   # comma-separated allowlist
```

`loadApiEnvironment()` validates required vars and `createPaymentProvider`
refuses `test` when `NODE_ENV=production`. Secrets must come from a secret
manager, never from the image or VCS.

## 4. Database migration (release step)

Run migrations once per environment, in a transaction, before starting the apps:

```bash
pnpm db:migrate            # applies packages/database/migrations in order
```

Verify on a fresh DB in staging first (the exact path is exercised by every
integration test). Keep `manifest.json` in sync with the migration files.

## 5. Start

Use a process manager (systemd / pm2 / container) for each long-running app:

```bash
node apps/api/dist/server.js      # API (serves /health, /api/v1/*)
node apps/worker/dist/server.js   # Worker (consumes app.jobs + Redis queue)
# Web is a static Next.js build served by its own node server or the proxy.
```

The API and worker both read `.env` via `loadEnvFile('.env')` if present, then
validate the environment.

## 6. Health & readiness

- `GET /health` → `200 {"status":"ok"}` when DB **and** Redis are reachable.
- `503` when either dependency is down (used for readiness/liveness probes).
- The check is dependency-only (no deep query) — safe for frequent probes.

## 7. Graceful shutdown

- `SIGTERM`/`SIGINT` → `app.close()` (closes DB + Redis) → exit `0`.
- Proxies should stop routing, then send `SIGTERM`, and allow `~10s` for
  in-flight requests before `SIGKILL`.

## 8. Backup & restore

```bash
# Backup (custom format)
docker exec ikimetr-postgres-1 pg_dump -U <user> -d <db> -Fc -f /tmp/ikimetr.dump
# Restore to a fresh DB
docker exec ikimetr-postgres-1 psql -U <user> -d postgres -c "CREATE DATABASE ikimetr_restore;"
docker exec ikimetr-postgres-1 pg_restore -U <user> -d ikimetr_restore --no-owner --no-privileges /tmp/ikimetr.dump
```

The migration + restore path was verified end-to-end (see completion report §4).
Schedule nightly dumps; test restore quarterly.

Redis holds the transient job queue — use AOF/RDB persistence; on Redis loss,
reconcile `app.jobs WHERE status='queued'` back into the queue.

## 9. Rollback

- Code: redeploy previous image/tag.
- DB: migrations in this release are additive (no destructive migration); if a
  future migration is destructive, take a pre-deploy backup (§8) and document a
  down-migration before applying.
- Feature flags: entitlement gating already isolates paid features; disable a
  plan feature via `app.subscription_features` if needed.

## 10. Monitoring (recommended, not yet built)

- pino → structured log shipping.
- Add `/metrics` (Prometheus) and trace propagation before public launch.
- Alert on `5xx` rate, `/health` `503`, and job-queue depth.
