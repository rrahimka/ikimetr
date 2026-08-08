# Logical Database Model

## Core tables
- users
- realtor_profiles
- agencies
- agency_members
- properties
- listings
- realtor_properties
- owners
- owner_contacts
- clients
- client_contacts
- requests
- matches
- match_reasons
- match_score_history
- viewings
- conversations (post-MVP if needed)
- messages (post-MVP if needed)
- data_sources
- raw_listings
- property_images
- price_history
- status_history
- freshness_checks
- duplicate_candidates
- property_merges
- verifications
- consents
- notifications
- notification_preferences
- audit_events
- security_events

## Design rules
- UUID/UUIDv7-style identifiers preferred for externally exposed resources.
- Money uses exact numeric/integer semantics, never float.
- Time stored in UTC.
- Soft delete only where business history requires it; not universally.
- Contact data is separated from core owner/client entities.
- Price lives on Listing, not Property.
- Match references Request + Listing; Property is reached through Listing.
- History tables preserve important changes.
- Algorithm outputs store algorithm/version metadata.

## Geography
Use normalized city/district/subdistrict references plus PostGIS geometry/coordinates.

## Images
Prefer content hash metadata; physical storage is object storage, not PostgreSQL BLOBs.
