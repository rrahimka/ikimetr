# Architecture Review — v1.0 to v1.1

The red-team review resulted in these corrections:

1. Separate **MVP Core** (realtor database, requests, deterministic matching, contact flow) from **MVP Intelligence** (ingestion, owner classification, dedupe, Owner Feed). The product must remain useful if external ingestion is temporarily unavailable.
2. Match targets a concrete **Listing**, then reaches Property through it.
3. Canonical merge is conservative; introduce Listing Cluster if useful before asserting physical identity.
4. Client profile is optional for Request in early MVP.
5. Full internal chat is removed from mandatory MVP.
6. Realtime is removed from mandatory MVP.
7. Complex agency workspaces are deferred.
8. Semantic AI matching is deferred until deterministic matching is validated.
9. Owner/client contact reveal becomes a dedicated security boundary.
10. Add feature flags, versioned/configurable rules, data provenance and minimal analytics.
11. Separate audit, security events, product analytics and application logs.
12. Owner Feed must not be the only durable value proposition; core professional workflow must stand alone.

These corrections supersede earlier v1.0 assumptions where they conflict.
