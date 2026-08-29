# İkiMetr — Independent Audit Remediation 1B

Stage 1 closed most findings. The independent re-audit confirmed four remaining
technical issues plus a documentation correction. All four are fixed here with
regression tests and a live Redis recovery acceptance. No new product features,
no frontend, no domain-model schema rewrite, no push.

## Status

`REMEDIATION STAGE 1B: COMPLETE`

Gates (all green): `db:migrate:verify` (15), `test:unit` (425 passed / 3
skipped), `test:integration` (131 passed / 0 failed), API+worker+web build,
`lint`, `typecheck`, `pnpm audit --prod` (no vulnerabilities), Prettier on
changed files, `git diff --check`.

---

## Issue 1 — Business mutation + job row are not atomic

**Root cause.** The durable `app.jobs` row was created by a _separate_ DB
transaction opened inside `createJobEnqueue`, after the business mutation had
already committed. Two windows existed:

- `message committed → process crashes before app.jobs insert` ⇒ the
  notification job was permanently lost (the worker reconciler cannot recover a
  row that was never written).
- billing webhook opened an outer payment transaction, then `enqueueJob` opened a
  _second_ transaction to insert the job row and committed it _before_ the outer
  transaction. If the outer transaction later rolled back, the worker could
  process a job for a business event that never committed.

**Implementation.** Introduced a transactional outbox
(`apps/api/src/queue/outbox.ts`):

- `insertJobRow(tx, type, payload, idempotencyKey)` inserts the durable job row
  **inside the caller's existing business transaction** using
  `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`, returning the job id (or
  `null` for a terminal/duplicate).
- `wakeJob(redis, id)` pushes the committed id to Redis **only after** the
  transaction commits; failures are swallowed because the durable `queued` row
  survives and the worker reconciler (`requeuePending`) re-enqueues it.

`sendMessage` (messaging) and `handleWebhook` + `apply*` (billing) now insert the
job row inside the same transaction as the business mutation and collect ids,
then call `wake` after the transaction resolves. `createOutbox(redis)` is wired in
`server.ts`; `app.ts` falls back to a no-op wake when no Redis is provided.

**Tests.** `apps/api/test/outbox.integration.test.ts`:

- **A** (crash before Redis wake): `sendMessage` with a wake that never delivers
  still commits the message **and** a `queued` job row; Redis received nothing;
  simulating the reconciler re-enqueues the durable id and the row count stays 1
  (exactly-once durable source of truth).
- **B** (rollback): a transaction that inserts a user + job row and then throws
  leaves **both** absent — no orphan job, no Redis push.
- **C** (client retry): delivering the same webhook event twice yields exactly
  one durable `sub:activated` job and one activation (idempotency prevents
  duplicates).

---

## Issue 2 — Redis reconnect must be proven

**Real acceptance.** See `docs/audit/redis-recovery-acceptance.md`. Using the
project's actual Redis client (`apps/api/src/redis.ts`) with
`reconnectStrategy: (retries) => Math.min(retries * 200, 5000)`:

- Started a single long-lived process; `docker stop ikimetr-redis-1` induced
  `ECONNRESET` error events and failed pings (no crash, no DB corruption).
- Failed attempts were spaced ~6s (bounded backoff, capped at 5s) — no hot spin.
- `docker start ikimetr-redis-1` ⇒ the **same process** emitted `EVENT ready 2`
  and pings resumed. No process restart. Error logs contain only the error code,
  never the URL/credentials.
- Durable jobs remain reconcilable after recovery (Issue 1 outbox guarantees
  exactly-once; `requeuePending` re-enqueues stale `queued` rows).

---

## Issue 3 — Rate limiting behind a reverse proxy

**Trust model (Option A chosen).** Fastify is now configured with
`trustProxy` driven by `API_TRUSTED_PROXIES` (comma-separated CIDR/IP list) in
`apps/api/src/environment.ts` + `server.ts`. When set, Fastify derives the real
client IP from a _trusted_ `X-Forwarded-For` hop, so the limiter keys on the
client, not the proxy. When unset (no trusted proxy in front), `request.ip` is
the direct socket peer and `X-Forwarded-For` is ignored — so a spoofed header
cannot bypass the limiter. The limiter itself never reads `X-Forwarded-For`
directly; it keys on `request.ip` (auth user id when available).

**Spoof prevention.** `apps/api/test/rate-limit.integration.test.ts`:

- No trusted proxy: 11 requests each carrying a **unique** forged
  `X-Forwarded-For` still share the socket bucket and hit 429 after the limit ⇒
  spoofing the header does not bypass the limiter.
- Trusted proxy (`127.0.0.1`): client A (`XFF 198.51.100.10`) and client B
  (`XFF 198.51.100.20`) get independent buckets; A is limited, B stays allowed;
  over-limit returns 429 with a correct `Retry-After`.

---

## Issue 4 — Direct-conversation migration must handle historical duplicates

**Strategy (detect-and-abort).** The migration
`1786494700000_conversation_direct_pair.ts` now backfills `direct_pair_key`, then
runs a `DO` block that detects duplicate non-null keys. If any exist it raises an
explicit, actionable error (`MIGRATION ABORTED: found N duplicate direct
conversation pair(s) ...`) and **rolls back the whole migration** (the column add
included), leaving no partial/destructive state. No historical conversations are
silently deleted or merged.

**Manifest.** Recomputed SHA-256 of the migration and updated
`packages/database/migrations/manifest.json` (verified by `db:migrate:verify`).

**Tests.** `packages/database/test/migrations.integration.test.ts` adds a
historical-duplicate case: apply 14 migrations, seed two direct conversations
sharing the same pair, then apply the final migration ⇒ it rejects with
`MIGRATION ABORTED`, the unique index and `direct_pair_key` column are absent, and
exactly 14 migrations remain recorded. The clean case (fresh DB) still succeeds.

---

## Domain model — documentation correction only (Issue 5)

`docs/audit/domain-model-drift.md` is corrected. The earlier "terminology
mismatch only" finding was incomplete. The implementation does **not** fully
implement the constitution's model: `realtor_properties`, `clients`,
`client_contacts`, `owners`, `owner_contacts` are absent, and `Property ≠
Listing` is **not** safely claimable as "fully implemented" — `app.properties`
carries listing-like columns (`transaction_type`, `price_amount`, `currency`) and
the `properties → listings` derivation is not the documented shape. This is
classified as **DOMAIN MODEL DRIFT — REQUIRES A SEPARATE ARCHITECTURAL DECISION /
ADR**, explicitly out of scope for Stage 1 / 1B. No schema change was made.

---

## Tests — exact counts

- New `apps/api/test/outbox.integration.test.ts`: **3** (A, B, C)
- New `apps/api/test/rate-limit.integration.test.ts`: **2** (untrusted spoof,
  trusted proxy)
- `packages/database/test/migrations.integration.test.ts`: **+1** (historical
  duplicate abort) → file **7**
- `apps/api/test/part4b.integration.test.ts`: updated assertion (durable job row)
  — still passing
- Full `test:integration`: **131 passed / 0 failed** (was 125; +6 from 1B)
- Full `test:unit`: **425 passed / 3 skipped / 0 failed**

## Git

- Branch: `agent/part-05-security-e2e-production-release`
- Commits: see `git log` (logical local commits, no push)
- `PUSH: NOT PERFORMED`
