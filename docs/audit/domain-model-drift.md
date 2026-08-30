# Domain Model Drift — Forensic Verification

Verified against the committed, applied schema in
`packages/database/migrations/` (15 migrations; manifest
`packages/database/migrations/manifest.json`).

## Claim vs. reality

The independent audit's forensic report asserted that the production schema is
missing several domain tables: `realtor_properties`, `clients`,
`client_contacts`, `owners`, `owner_contacts`, and that `Property` and
`Listing` are conflated.

| Forensic claim | Verified reality |
| --- | --- |
| `realtor_properties` absent | The canonical property is `app.properties`. Realtor identity is `app.realtor_profiles` (1:1 with `app.users`). There is no separate `realtor_properties` table; a realtor's inventory is `app.properties` rows owned via `owner_user_id` / `agency_id`. |
| `clients` / `client_contacts` absent | True — these tables do **not** exist. Client demand is modeled as `app.client_requests` (FK `user_id` → `app.users`). A "client" is a `users` row, not a dedicated table. No `client_contacts` table exists; contact/phone data lives on `app.users` / `app.profiles` and phone hashing on `app.external_listings`. |
| `owners` / `owner_contacts` absent | True — these tables do **not** exist. Ownership is modeled as `app.properties.owner_user_id` (FK → `app.users`) plus `app.agency_id`. The owner-facing surface is `app.owner_alerts` (a feed), not an `owners` table. There is no `owner_contacts` table. |
| `Property` ≠ `Listing` conflated | **Partially implemented — NOT fully.** Two physical tables exist (`app.properties` and `app.listings`), but `app.properties` carries listing-like columns (`transaction_type`, `price_amount`, `currency`) and the relationship between `properties` and marketplace `listings` is not the documented model (the constitution distinguishes `Property`, `Listing`, and `RealtorProperty` as separate concepts; a `RealtorProperty` entity is absent). So `Property ≠ Listing` is **not** safely claimable as "fully implemented" merely because two tables exist. |

## Status: DOMAIN MODEL DRIFT — REQUIRES SEPARATE ARCHITECTURAL DECISION / ADR

The previous "terminology mismatch only" finding was incomplete. The independent
review confirms **genuine** model drift against the constitution / `docs/domain`:

- The constitution documents distinct `Property`, `Listing`, `RealtorProperty`,
  `Client`, and `Request` concepts, plus entities `realtor_properties`,
  `owners`, `owner_contacts`, `clients`, `client_contacts`. The **current
  implementation does not fully implement this model**:
  - `realtor_properties` is absent (a realtor's inventory is modeled as
    `app.properties` owned via `owner_user_id` / `agency_id`).
  - `clients` / `client_contacts` are absent (demand is `app.client_requests`;
    a "client" is a `users` row).
  - `owners` / `owner_contacts` are absent (ownership is `properties.owner_user_id`
    + `agency_id`; the owner surface is `app.owner_alerts`).
  - `Property ≠ Listing` is **not** fully realized: `app.properties` holds
    listing-like fields (`transaction_type`, `price_amount`, `currency`) and the
    `properties` → `listings` derivation is not the documented domain shape.
- This is an **architectural** decision (schema split, ownership model, contact
  model), not a remediation bug. It must go through the normal task
  specification + **ADR** process and is explicitly **out of scope for Stage 1 /
  Stage 1B**.

### What Stage 1 / 1B did and did NOT change

- Verified the *missing* tables (`realtor_properties`, `clients`, `client_contacts`,
  `owners`, `owner_contacts`) were **never in the committed/ applied schema** —
  the drift is real but the tables were never lost; they were never specified.
- Did **NOT** conflate the two existing tables into a claim of "fully implemented"
  domain separation. That claim is withdrawn.
- Made no schema change to `properties` / `listings` in Stage 1B (per scope).

### Recommended follow-up

1. Open an **ADR** for the Property / Listing / RealtorProperty boundary, the
   ownership model, and whether a richer owner/client contact model is required.
2. Reconcile the canonical domain glossary (constitution / `docs/domain`) with the
   implemented table names so future audits share vocabulary.
3. Confirm with product whether single-owner-per-property and single-client-per-request
   are sufficient, or joint ownership / multiple contacts are needed.

## Net assessment

The "drift" is **genuine and architectural**, not a terminology mismatch. The
canonical logical model in `docs/database/DATABASE.md` (and the constitution /
master architecture) explicitly documents these entities — `realtor_properties`,
`owners`, `owner_contacts`, `clients`, `client_contacts` — and the binding rule
**"Price lives on Listing, not Property"** (DATABASE.md §Design rules). The
current implemented schema does **not** conform:

- Those documented tables are absent from `packages/database/migrations/`; the
  implementation models a realtor's inventory as `app.properties` owned via
  `owner_user_id` / `agency_id`, clients as `users` rows + `app.client_requests`,
  and ownership/contacts as `properties.owner_user_id` + `agency_id` +
  `app.owner_alerts`.
- `app.properties` carries listing-like columns (`transaction_type`,
  `price_amount`, `currency`), directly contradicting "Price lives on Listing,
  not Property". The `properties` → `listings` derivation is not the documented
  domain shape.

This requires a separate **ADR** (schema split, ownership model, contact model,
and moving price from Property to Listing). It is explicitly out of scope for
Stage 1 / Stage 1B; no schema change was made here.

## Recommended follow-up (out of scope for Stage 1)

1. Reconcile the canonical domain glossary (constitution / `docs/domain`) with
   the implemented table names so future audits use the same vocabulary.
2. If a richer owner/client contact model is genuinely required (multiple
   contact channels per owner/client), that is a **new feature**, not a
   remediation of existing drift, and should go through the normal task
   specification + ADR process. It is explicitly **not** invented here.
3. Confirm with product whether `owner_user_id` (single owner per property) and
   `user_id` (single client per request) are sufficient, or whether joint
   ownership / multiple contacts are needed. Treat as a product decision, not a
   bug to fix in this remediation.
