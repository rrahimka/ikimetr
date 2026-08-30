# İkiMetr — Provisioning Checklist

Use before promoting V1 to production. Items marked ☐ are not yet implemented
in-repo and are external/tracked separately.

## Infrastructure

- [x] Postgres 17 + PostGIS reachable (compose provided for local).
- [x] Redis 8 reachable (compose provided for local).
- [x] DB + Redis bound to private network / `127.0.0.1`; not publicly exposed.
- [ ] Container images for api / worker / web (Dockerfiles) — external task.
- [ ] Reverse proxy (Caddy/Traefik/nginx) for TLS + edge — external task.
- [ ] TLS certificates + automatic renewal.

## Secrets & config

- [x] `NODE_ENV=production`.
- [x] `PAYMENT_PROVIDER` set to a real provider (NOT `test`).
- [x] `PAYMENT_PROVIDER_SECRET` (webhook signing) configured.
- [x] `SESSION_SECRET` ≥ 32 bytes, from secret manager.
- [x] `INGESTION_SERVICE_TOKEN` configured (or intentionally omitted to disable).
- [x] `API_CORS_ORIGINS` allowlist set (no wildcard).
- [x] `.env` is untracked and excluded from VCS; secrets never committed.

## Database

- [x] Migrations applied on a fresh DB in staging (proven by test suite).
- [x] `manifest.json` matches migration files.
- [x] Real backup (`pg_dump`) scheduled; restore tested.
- [ ] Point-in-time recovery (PITR) configured on managed Postgres.
- [ ] Read replica for analytics (optional).

## App runtime

- [x] `pnpm build` succeeds for all apps.
- [x] API boots; `/health` → `200` with DB+Redis up.
- [x] `/health` → `503` when a dependency is down (readiness probe).
- [x] SIGTERM graceful shutdown → exit 0.
- [ ] Process manager unit files (systemd/pm2) created.
- [ ] Log shipping + retention configured.

## Security

- [x] CORS allowlist enforced.
- [x] Security headers present (`nosniff`, `DENY`, `no-referrer`, CSP).
- [x] Session: scrypt + constant-time compare; revoked/expired rejected.
- [x] IDOR/RBAC enforced server-side.
- [x] Ingestion endpoint authenticated; disabled when no token.
- [x] Payment webhook HMAC-verified; idempotent; amount-checked.
- [x] No `swagger`/`/docs` route in production.
- [x] Startup errors do not leak secrets.
- [ ] **Rate limiting on auth endpoints — NOT yet implemented.**
- [ ] WAF / DDoS edge protection.

## Verification before launch

- [x] Unit suite green (420 pass / 3 skip external).
- [x] Integration suite green (117 pass).
- [x] `pnpm audit --prod` → 0 vulnerabilities.
- [x] Lint / typecheck / format pass.
- [ ] Independent code review complete (PENDING).
- [ ] Load / pagination / query-plan testing (recommended pre-launch).
