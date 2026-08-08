# Freshness Module

## Purpose
Prevent the database from becoming a graveyard of outdated properties and requests.

## Listing states
CONFIRMED / NEEDS_VERIFICATION / STALE / INACTIVE.

## Principles
- Business status and freshness are separate concepts.
- Disappearance from one source is evidence, not proof of sale.
- Different property/transaction types may have different verification cadence.
- Bulk confirmation UX is required.
- Stale records are deprioritized/excluded from matching.
