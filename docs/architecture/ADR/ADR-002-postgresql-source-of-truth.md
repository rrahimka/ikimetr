# ADR-002 — PostgreSQL as Source of Truth

## Decision
PostgreSQL stores all core business state. Redis/search/cache are rebuildable derivatives.

## Reason
Strong transactions, relational integrity, PostGIS capability and simplified recovery model.
