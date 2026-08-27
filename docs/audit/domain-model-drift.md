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
| `Property` ≠ `Listing` conflated | The schema **does** separate the two: `app.properties` is the canonical internal property (owned by a user/agency), while `app.listings` is the marketplace listing derived from `properties` and enriched by `app.external_listings`. `external_listings.listing_id` links ingested listings back to `app.listings`. So the conceptual distinction is preserved, though the *naming* in the forensic report (`realtor_properties`) does not match the implementation (`properties`). |

## Net assessment

The "drift" is primarily a **terminology / naming mismatch** between the
forensic report and the implemented schema, not a wholesale missing domain
model:

- The domain entities the report cares about (property, listing, realtor,
  client, owner) are **present**, modeled as: `properties`, `listings`,
  `external_listings`, `realtor_profiles`, `client_requests`, `users`
  (clients/owners are users), and `owner_alerts`.
- Genuinely absent tables (`realtor_properties`, `clients`, `client_contacts`,
  `owners`, `owner_contacts`) were **never part of the implemented/committed
  schema**; they appear only in the report's prose. No migration or code
  references them.

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
