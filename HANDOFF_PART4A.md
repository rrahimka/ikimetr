# PART 4A Handoff — Messaging, Notifications, Background Worker

**Branch:** `agent/part-04a-messaging-notifications-worker` (from `1b74215`, PART 3 tip)
**Status:** COMPLETE
**Stack:** Real PostgreSQL (per `infrastructure/compose.yaml`) + Real Redis. No mocked queue or DB in integration evidence.

## What was built

### Migrations (new, existing 8 untouched)
- `1786494100000_messaging` — `app.conversations`, `app.conversation_participants`, `app.messages`. Read state via `conversation_participants.last_read_message_id`.
- `1786494200000_notifications` — `app.notifications` (with `idempotency_key` UNIQUE, `visible_after` for DND) and `app.notification_preferences` (disabled types + DND window).
- `1786494300000_jobs` — `app.jobs` audit/state table (`status`, `attempts`, `max_attempts`, `last_error`, `scheduled_at`).
- `packages/database/migrations/manifest.json` extended with verified sha256 hashes.

### Messaging API (`apps/api/src/messaging/*`, wired in `routes.ts`)
- `POST /api/v1/conversations` (creates a direct conversation; reuses an existing one; rejects self/non-existent users).
- `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`, `GET /api/v1/conversations/:id/messages` (keyset pagination, bounded).
- `POST /api/v1/conversations/:id/messages` (sender derived from session, never trusted from body).
- `POST /api/v1/conversations/:id/read`.
- Participant membership is server-authorized; non-participants get `404` (IDOR-protected).

### Notifications API (`apps/api/src/notifications/*`, wired in `routes.ts`)
- `GET /api/v1/notifications` (per-user, `visible_after <= now()`), `POST /api/v1/notifications/:id/read` (owner-scoped `404`).
- `GET /api/v1/notification-preferences`, `PATCH /api/v1/notification-preferences` (category disable + DND window).
- Outbound `notification.deliver` jobs are enqueued through the real `JobEnqueue` dependency (idempotent `app.jobs` row + Redis LPUSH).

### Worker (`apps/worker/src/*`, new deps: `@ikimetr/database`, `@ikimetr/shared`)
- `job-queue.ts` — Redis list queue, retry z-set, dead-letter list (shared keys from `@ikimetr/shared`).
- `job-processor.ts` — conditional claim, bounded exponential-backoff retries for transient errors, permanent/invalid-payload → `dead`, observable dead-letter, `recoverStale()` for crash safety.
- `handlers/notifications.ts` — delivers to the correct user only, honors preferences (suppressed types) and DND scheduling; idempotent insert via `ON CONFLICT (idempotency_key) DO NOTHING`.
- `handlers/stale-listing.ts` — real stale-listing processing foundation.
- `worker.ts` now connects to the DB, runs the processor, and keeps the heartbeat.

## Verification (all green)
- `pnpm run db:migrate:verify` — 11 migrations verified.
- `pnpm run test:integration` — **77 passed / 77** (messaging, notifications, worker job-processing, plus PART 1–3 regression).
- `pnpm run test:unit` — **420 passed**; the only 3 failures are the pre-existing `ollama-acceptance` tests (live Ollama network, unrelated to PART 4A).
- `pnpm run lint`, `prettier --check` (PART 4A files), `pnpm run typecheck`, `pnpm run build`, `pnpm run audit:prod` (no vulnerabilities) — all clean.
- `git diff --check` clean; working tree clean.

## How to run
```
set -a && . ./.env && set +a      # provides DATABASE_URL + REDIS_URL
pnpm run db:migrate:up             # apply all migrations
pnpm --filter @ikimetr/worker run dev   # worker (DB + Redis)
pnpm --filter @ikimetr/api run dev       # API (enqueues jobs to Redis)
```

## Notes / deferred
- No SMS/email/Telegram delivery, no full-text search over messages, no typing indicators, no real-time websockets (polling-friendly API only). Per spec, in-app delivery first.
- DND affects delivery visibility, not record creation (in-app records are always created; `visible_after` defers listing).
- Rate limiting not implemented (no explicit infra requirement); documented as deferred.
- `format:check` across the whole repo also flags ~48 pre-existing files in `packages/ai-cost-system` (unrelated to PART 4A; not modified here).

## Definition of done — checklist
- [x] Messaging real (conversations, participants, messages, read state).
- [x] IDOR proven for conversations + notifications (404 for non-owners).
- [x] Notifications real (per-user, preference + DND aware).
- [x] Worker real: Redis queue, bounded retries, dead-letter, crash recovery.
- [x] Duplicate side effects prevented (idempotent notification insert + job key).
- [x] PostgreSQL + Redis integration tests pass; build passes; working tree clean.
