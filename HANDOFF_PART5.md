# PART 5 — Security E2E / Production Release

**Branch:** `agent/part-05-security-e2e-production-release` (created from PART 4B HEAD `d03a96b`)
**Status:** AWAITING SPECIFICATION — no implementation started.

## Recorded review items (carry into PART 5)

### P5-REVIEW-1: Payment ledger row semantics (checkout pending row vs webhook event row)

- Observation: `POST /api/v1/billing/checkout` inserts a `payments` row with
  `status = 'pending'` and `provider_event_id = NULL` for a given
  `provider_payment_id` (say `X`). The later `payment.succeeded` webhook then
  inserts a **second** `payments` row for the same `provider_payment_id = X`
  with `provider_event_id = <event id>`, `status = 'received'` (and a further
  `:applied` row for the activation event).
- Current impact: harmless for tests (entitlements/audit/webhooks all pass), but
  two rows now share one business payment.
- Required before production release:
  - Confirm whether the pending checkout row and the webhook event row have
    **distinct intended business meaning** (e.g. "intent/attempt" vs
    "settled event") or whether the checkout row is purely redundant.
  - If redundant: fix the data model / service flow (e.g. let the webhook
    reconcile/update the existing checkout row, or stop creating the pending row
    at checkout) and **add regression coverage** that asserts the ledger ends up
    with exactly the intended rows (no silent duplicates).
  - Do NOT remove the row merely for cosmetic reasons without first understanding
    the payment-ledger semantics.
- Files to revisit: `apps/api/src/billing/service.ts` (`createCheckout`,
  `handleWebhook`, `applyPaymentSucceeded`),
  `packages/database/migrations/1786494400000_billing_core.ts` (`payments`).

## Gates to repeat for PART 5

lint · typecheck · unit · integration · `db:migrate:verify` · prettier(changed) · build · `audit:prod` · `git diff --check` (mirrors PART 4B).
