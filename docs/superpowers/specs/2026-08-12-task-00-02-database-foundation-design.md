# Task 00.02 — Database Foundation Design

**Date:** 2026-08-12  
**Status:** Approved design; implementation not started  
**Task contract:** [00.02-database-foundation.md](../../../specs/phase-00-foundation/00.02-database-foundation.md)

## Purpose

Establish a deterministic PostgreSQL/PostGIS migration and transaction
foundation before any İkiMetr business schema is designed.

## Architecture

```text
Explicit developer/deployment command
  -> migration manifest SHA-256 verification
  -> node-pg-migrate 9.0.0
  -> PostgreSQL advisory lock (fail if already held)
  -> one transaction for pending migrations
  -> extensions + empty technical schemas + privilege baseline
```

Application processes use `@ikimetr/database` for health checks and explicit
callback transactions. API, web, and worker startup never execute migrations.

## Boundaries

The migration engine owns ordering, history, transactions, and advisory
locking. A small deterministic verifier owns migration-file integrity and
nothing else. PostgreSQL owns data truth. No ORM is selected.

The initial migration creates extensions, empty schemas, NOLOGIN group roles,
and privilege defaults only. It creates no business table and grants no runtime
access to future data.

## Safety model

- Connection details come only from environment variables and are never logged.
- Local PostgreSQL remains loopback-only.
- Advisory-lock mode is `fail`: one runner proceeds; any concurrent runner
  exits before applying SQL.
- Applied migration files are immutable and checked through a committed
  SHA-256 manifest.
- Transactional failure leaves no partial objects or successful history row.
- Production correction is forward-only; local down is guarded against
  `NODE_ENV=production`.
- Managed-provider privilege differences are a stop condition, not a reason to
  grant broader access.
- Disposable integration databases use a validated fixed prefix and random
  suffix before any create/drop operation.

## Verification

Unit tests cover the transaction state machine and manifest verifier.
Integration tests use an isolated Docker PostgreSQL database to prove clean
apply, no-op repeat, extension/schema/role state, transaction rollback,
concurrent-lock failure, and local down/up. The full repository quality and
security checks remain required.

## Deferred decisions

Business tables, ORM/query builder, domain repositories, RLS, authentication
roles, application login credentials, backup automation, and managed-database
provisioning are intentionally deferred to their own tasks.
