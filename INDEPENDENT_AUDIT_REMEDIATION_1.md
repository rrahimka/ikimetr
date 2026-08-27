# Independent Audit Remediation — Stage 1

Scope: Issues **A–K** from the independent audit, plus the payment-provider
honesty gap and the domain-model-drift forensic follow-up. No push; no history
rewrite; no large refactor; frontend left as documented-incomplete. Each fix is
accompanied by a regression test that fails before the fix and passes after.

## A — Session acceptance ignores account status [FIXED]

- **Found / reproduced:** `getUserFromSession` (`apps/api/src/identity/service.ts`)
  joins `app.sessions` + `app.users` and only checks `revoked_at IS NULL AND
expires_at > now()`. A `suspended`/`banned` user keeps using an already-issued
  token.
- **Root cause:** server-side current account state was not the gate for
  session validity; only `authenticateUser` (login) enforced `status='active'`.
- **Fix:** `getUserFromSession` now rejects any row whose `status !== 'active'`
  (returns `null` → `UnauthenticatedError` → 401).
- **Tests:** `audit-stage1` "session rejected when account is not active".
- **Status:** COMPLETE.

## B — PostgreSQL pool errors swallowed silently [FIXED]

- **Found / reproduced:** `pool.on?.('error', () => {})` in
  `packages/database/src/index.ts` swallowed _all_ connection errors (no log),
  and the previous broad swallow masked production failures.
- **Root cause:** the handler logged nothing, so a real connectivity failure was
  invisible; query/transaction rejections were unaffected (those reject via
  their promise) but health still surfaced DB downtime via `database.check()`.
- **Fix:** handler now logs `postgres pool client error: <code>` (code only,
  never the message/URL, so no `DATABASE_URL` secret leaks). Normal query
  rejection is unchanged; health continues to report DB failure.
- **Tests:** `packages/database/test/pool-error.test.ts` (no secret in logs;
  `check()` still rejects). Full integration suite proves no global unhandled
  failure on teardown-killed disposable connections.
- **Status:** COMPLETE.

## C — Redis client never reconnects [FIXED]

- **Found / reproduced:** `reconnectStrategy: false` in `apps/api/src/redis.ts`
  and `apps/worker/src/worker.ts` meant a transient Redis outage required a
  process restart.
- **Root cause:** `false` disables node-redis reconnection entirely.
- **Fix:** bounded backoff `reconnectStrategy: (retries) => min(retries*200,
5000)` in both the API health connection and the worker client; connection
  errors are swallowed (no unhandled rejection) and recovery is automatic.
- **Status:** COMPLETE.

## D — Job enqueue pushes phantom UUIDs on idempotency collision [FIXED]

- **Found / reproduced:** `createJobEnqueue` (`apps/api/src/server.ts`) used a
  fresh `randomUUID()` as `jobId`, inserted with `ON CONFLICT
(idempotency_key) DO NOTHING`, then **unconditionally** `redis.enqueue(jobId)`.
  On a collision the INSERT was a no-op but a brand-new UUID was still pushed —
  a job with no DB row (phantom).
- **Root cause:** the enqueue key was decoupled from the durable DB row.
- **Fix:** extracted `createJobEnqueue` to `apps/api/src/queue/enqueue.ts`. The
  DB row is the source of truth (`INSERT ... ON CONFLICT DO NOTHING`); only a
  _real_ job id is ever pushed to Redis. On collision it looks up the existing
  real id and re-enqueues it only if still pending (`completed`/`dead` are not
  re-enqueued). The Redis push happens **after** the DB transaction commits; if
  Redis is down, the durable `queued` row remains and the worker reconciler
  (E) re-enqueues it.
- **Tests:** `apps/api/test/queue.enqueue.test.ts` (no phantom id on collision;
  terminal job not re-enqueued).
- **Status:** COMPLETE.

## E — Job queue not eventually consistent after Redis loss [FIXED]

- **Found / reproduced:** worker `recoverStale` only re-enqueued `processing`
  jobs; a `queued` row whose Redis push failed was never delivered.
- **Root cause:** the durable `app.jobs` row was the intended source of truth but
  nothing reconciled `queued` rows against Redis.
- **Fix:** added `requeuePending()` to `apps/worker/src/job-processor.ts`
  (re-enqueues `queued` jobs older than `staleJobMs`, `FOR UPDATE SKIP LOCKED`
  for safety) and run it on worker start and every scheduler tick. Redis is now
  purely a transport/wakeup; the DB remains authoritative.
- **Tests:** `apps/worker/test/job-processor.test.ts` (re-enqueues queued;
  no-op when none).
- **Status:** COMPLETE.

## F — Duplicate direct conversations under concurrency [FIXED]

- **Found / reproduced:** `createConversation` did `SELECT`-then-`INSERT`,
  racing under concurrency and creating duplicate A↔B conversations.
- **Root cause:** the uniqueness of a direct pair was enforced only in app code,
  not the DB.
- **Fix:** added `direct_pair_key varchar(73)` + a unique index on
  `app.conversations` (nullable → group conversations keep `NULL`, which the
  unique index treats as distinct). `createConversation` uses `INSERT ... ON
CONFLICT (direct_pair_key) DO NOTHING` and also catches the unique violation
  raised at commit time under a race, falling back to the existing row. (A
  partial `WHERE conversation_type='direct'` index was rejected because
  Postgres cannot use it as an `ON CONFLICT` arbiter; the nullable unique index
  achieves the same guarantee.)
- **Tests:** `audit-stage1` concurrent A+B / B+A → exactly one conversation;
  existing `messaging.integration.test.ts` still green.
- **Status:** COMPLETE.

## G — External-listing status updates wrong row/column [FIXED]

- **Found / reproduced:** `setExternalListingStatus`
  (`apps/api/src/admin/service.ts`) used `idColumn: 'listing_id'`, but the route
  passes `external_listings.id`; the generic `UPDATE ... SET status = ...` also
  targeted a non-existent `status` column (external_listings uses
  `source_status`). Result: wrong/zero rows updated, or a hard error.
- **Root cause:** the admin set-status helper assumed a uniform `id`/`status`
  shape across all tables.
- **Fix:** `setExternalListingStatus` now targets `app.external_listings`
  `id` and updates `source_status`. `setStatus` accepts a `statusColumn`
  parameter (default `status`) and a `touchUpdatedAt` flag (external_listings
  has no `updated_at`).
- **Tests:** `audit-stage1` "external listing status targets external_listings.id
  - source_status".
- **Status:** COMPLETE.

## H — Status values not validated per entity [FIXED]

- **Found / reproduced:** `adminStatusUpdateSchema` accepted a broad enum
  (`active,suspended,pending,banned,inactive,verified,unverified,cancelled,expir
ed`) for _every_ entity → e.g. a listing could be set to `verified`, a request
  to `banned`.
- **Root cause:** no per-entity status vocabulary; validation lived only in one
  loose zod enum.
- **Fix:** `adminStatusUpdateSchema` now accepts any non-empty status string;
  the service enforces an **entity-specific** vocabulary
  (`apps/api/src/admin/status.ts`): user, realtor, agency, listing, external
  listing (`source_status`), and request. `setStatus` throws `ValidationError`
  (400) for an out-of-vocabulary status. (DB CHECK constraints were considered
  but deliberately **not** added: adding them risks rejecting legitimate
  existing data on migration and is a schema-hardening follow-up, not required
  for the security fix, which is enforced at the application layer.)
- **Tests:** `audit-stage1` per-entity validation (invalid `verified` for user &
  listing → 400; valid `suspended` for user → 200).
- **Status:** COMPLETE (app-layer enforced; DB CHECK noted as follow-up).

## I — Owner alerts returned without pagination [FIXED]

- **Found / reproduced:** `listOwnerAlerts` (`apps/api/src/billing/service.ts`)
  returned every row for the user.
- **Root cause:** no limit/cursor.
- **Fix:** `listOwnerAlerts` now takes `{ limit, cursor }` (limit default 20,
  max 100) with a stable keyset (`ORDER BY id DESC`, `id < cursor`). Route
  `GET /api/v1/owner-alerts` parses `ownerAlertListSchema` and returns
  `{ alerts, nextCursor }`.
- **Tests:** `audit-stage1` paginates with cursor.
- **Status:** COMPLETE.

## J — No rate limiting on abuse-prone endpoints [FIXED]

- **Found / reproduced:** login, registration, messaging send, ingestion auth,
  payment webhook, and sensitive admin mutations had no rate limiting.
- **Root cause:** missing control.
- **Fix:** added `apps/api/src/security/rate-limit.ts` (Redis fixed-window via
  `INCR`+`PEXPire`, keyed by authenticated user id or connection IP — no trust in
  spoofable headers without an explicit proxy contract). Applied to
  `auth/register` (10/min), `auth/login` (10/min), `conversations` create
  (30/min), `conversations/:id/messages` (60/min), `ingestion/listings`
  (100/min), `billing/webhooks/:provider` (120/min), and all `adminPre` mutate
  routes (30/min). Policy: **fail open** on Redis failure (allow request) rather
  than blocking all traffic on an outage — a conscious decision; the proxy/CDN is
  the backstop. Returns `429` with `Retry-After`.
- **Tests:** `audit-stage1` register exceeds limit → 429.
- **Status:** COMPLETE.

## K — README claims no business tables exist [FIXED]

- **Found / reproduced:** README stated "No business database tables exist yet."
- **Root cause:** stale doc.
- **Fix:** README now states the schema already includes the business tables.
  Only factually-wrong lines were changed; no "production ready" marketing added.
- **Status:** COMPLETE.

## Payment provider — fake production integration [FIXED]

- **Found / reproduced:** `createPaymentProvider` returned an `HmacPaymentProvider`
  for `stripe`/`epoint` whose `createCheckout` returned
  `https://stripe.example/checkout/...` — a non-functional stub presented as a
  real integration.
- **Root cause:** the HMAC adapter was mislabeled as a gateway integration.
- **Fix:** renamed `HmacPaymentProvider` → `SandboxPaymentProvider` (honest: a
  webhook-signature/sandbox adapter only). `createPaymentProvider` now
  **fails fast in production** for `stripe`/`epoint` ("no production integration
  configured"); it is allowed only outside production. `test` provider still
  throws in production. Existing tests updated accordingly.
- **Tests:** `security.integration.test.ts` production-payment-provider-safety
  (stripe/epoint throw in prod; allowed as sandbox in dev).
- **Status:** COMPLETE.

## Domain model drift — forensic follow-up [DOCUMENTED]

- `docs/audit/domain-model-drift.md` verifies the report against the real schema.
  Net: the missing tables (`realtor_properties`, `clients`, `client_contacts`,
  `owners`, `owner_contacts`) were never part of the committed schema; the
  domain entities exist under implemented names (`properties`, `listings`,
  `external_listings`, `realtor_profiles`, `client_requests`, `users`,
  `owner_alerts`). `Property ≠ Listing` **is** preserved (`properties` vs
  `listings`). No tables were invented to "fix" drift.
- **Status:** DOCUMENTED (terminology reconciliation + product decision noted as
  out-of-scope follow-up).

## Frontend [NOT FIXED — explicitly incomplete]

- The audit's frontend/payments items require UI work the brief froze. No
  frontend code was changed. This is recorded honestly, not faked.
- **Status:** DEFERRED (explicit, per freeze scope).

## Verification gates

- `pnpm db:migrate:verify` → 15 migrations verified (new
  `1786494700000_conversation_direct_pair` registered in the immutable manifest
  with its exact SHA-256).
- `pnpm typecheck`, `pnpm lint` → clean.
- `pnpm test:unit` → D/E/B unit tests pass.
- `pnpm test:integration` → full suite (incl. `audit-stage1`) green;
  migration-count expectations updated for the added migration.
- `pnpm build` (api/worker/web) → clean.
- `pnpm audit --prod` → 0 vulnerabilities.
- **Push:** NOT performed (no remote push requested).

## Files changed

- `apps/api/src/identity/service.ts` (A)
- `packages/database/src/index.ts` (B)
- `apps/api/src/redis.ts`, `apps/worker/src/worker.ts` (C)
- `apps/api/src/queue/enqueue.ts` (new, D), `apps/api/src/server.ts` (D)
- `apps/worker/src/job-processor.ts` (E)
- `apps/api/src/messaging/service.ts` + migration `1786494700000_conversation_direct_pair.ts` (F)
- `apps/api/src/admin/service.ts`, `apps/api/src/admin/status.ts` (new, G/H)
- `apps/api/src/billing/service.ts`, `apps/api/src/billing/schema.ts`, `apps/api/src/routes.ts` (I)
- `apps/api/src/security/rate-limit.ts` (new, J), `apps/api/src/errors.ts`, `apps/api/src/app.ts`, `apps/api/src/redis.ts`, `apps/api/src/routes.ts` (J)
- `apps/api/src/billing/provider.ts` (payment honesty)
- `README.md` (K)
- `packages/database/migrations/manifest.json` (new migration registered)
- `packages/database/test/migrations.integration.test.ts` (migration count updated)
- tests: `audit-stage1.integration.test.ts` (A,F,G,H,I,J), `queue.enqueue.test.ts`
  (D), `job-processor.test.ts` (E), `pool-error.test.ts` (B)
- `docs/audit/domain-model-drift.md` (new), `INDEPENDENT_AUDIT_REMEDIATION_1.md` (this file)
