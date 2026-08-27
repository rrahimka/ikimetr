# PART 4B Handoff — Billing, Admin & Analytics

**Branch:** `agent/part-04b-billing-admin-analytics`
**Status:** COMPLETE (accepted)
**HEAD:** `d03a96b` (3 logical commits: `e846474` db, `5f2030c` services, `d03a96b` wiring+tests)
**Stack:** Real PostgreSQL (`infrastructure/compose.yaml`) + real Redis. No mocked DB/queue in integration evidence.

## What was built

### Migrations (new, existing untouched)
- `1786494400000_billing_core` — `app.plans`, `app.subscriptions`, `app.user_roles`, `app.payments`, `app.owner_alerts`.
- `1786494500000_audit_log` — `audit.audit_log` (+ indexes).
- `1786494600000_seed_plans` — seeds `free` and `pro` plans (pro grants `owner_alerts` etc.).
- `packages/database/migrations/manifest.json` extended with verified sha256 hashes (14 total).

### Billing (`apps/api/src/billing/*`, wired in `routes.ts`)
- `GET /api/v1/billing/plans`, `GET /api/v1/billing/subscription`, `POST /api/v1/billing/checkout`, `GET /api/v1/me/entitlements`.
- `POST /api/v1/billing/webhooks/:provider` — HMAC-signed webhook; idempotent per `provider_event_id`; `payment.succeeded` activates the subscription and enqueues a `notification.deliver` job; `subscription.expired`/`cancelled` deactivate.
- `POST /api/v1/owner-alerts`, `GET /api/v1/owner-alerts` — gated by the `owner_alerts` entitlement.
- `HmacPaymentProvider` (test/dev) + `createPaymentProvider` (test/stripe/epoint) selection via `PAYMENT_PROVIDER`/`PAYMENT_PROVIDER_SECRET`.

### Admin (platform administrator only — `apps/api/src/admin/*` + `audit.ts`)
- `GET /api/v1/admin/users|realtors|agencies|listings|external-listings|requests|subscriptions`.
- Status overrides per entity (`PATCH /api/v1/admin/.../:id/status`) and `POST /api/v1/admin/subscriptions/override`.
- Every privileged action writes `audit.audit_log` (`user.status.update`, `subscription.admin.update`, …); `GET /api/v1/admin/audit` lists it.
- `requirePlatformAdmin` (only `platform_admin` role; agency `admin` is rejected → 403).

### Analytics (`apps/api/src/analytics/service.ts`)
- `GET /api/v1/analytics` (admin only) — aggregate counts, by-district, by-plan, source-health, recent activity. Response contains no PII (no `password`/`password_hash`).

## Verification (all green)
- `pnpm test:integration` — **90 passed / 0 failed** (incl. 13 PART 4B tests + 6 migration-regression).
- `pnpm db:migrate:verify` — 14 migrations verified.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm audit:prod` (no vulnerabilities), `prettier --check` (changed files), `git diff --check` — all clean.
- Unit suite: 420 passed (3 pre-existing `ollama-acceptance` network failures, unrelated).

## Bugs fixed during PART 4B (root cause)
1. `payments` had `UNIQUE(provider, provider_payment_id)`; the webhook reuses `provider_payment_id` across multiple event rows → duplicate-key 500. Removed the constraint; idempotency is enforced by `UNIQUE(provider, provider_event_id)`.
2. Webhook derived `user_id` from a `payments` subquery that returned multiple rows after #1 → 500, which also broke `subscription.expired`. Rewrote to derive `user_id` from `subscriptions` (one row per `provider_payment_id`); tightened the `amount_mismatch` update to the specific event row.
3. `overrideSubscription` UPDATE: `$3` (status) inferred as both `varchar(20)` and `varchar` → type conflict 500. Cast `$3::varchar` consistently.
4. Test helper `insertListing` bound `$1` as both `uuid` and `text`; now passes `external_id` as a typed value.

## Known issues / deferred
- `checkout` creates a **pending** `payments` row while the `payment.succeeded` webhook also records an **event** `payments` row for the same `provider_payment_id`. Described as harmless; flagged for PART 5 payment-ledger review (see `HANDOFF_PART5.md`).
- No SMS/email/Telegram delivery; in-app notification record only (per spec). Rate limiting not implemented (documented as deferred).
