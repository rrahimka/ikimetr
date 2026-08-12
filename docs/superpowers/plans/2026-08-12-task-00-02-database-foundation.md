# Task 00.02 Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic PostgreSQL 17/PostGIS 3.5 migration, integrity, least-privilege, and callback-transaction foundation without adding any business table or ORM.

**Architecture:** Explicit root scripts verify a committed SHA-256 manifest and then delegate migration ordering, history, transactionality, and locking to exactly pinned `node-pg-migrate@9.0.0`. `@ikimetr/database` keeps its existing health/close API and adds a query-only callback transaction; isolated integration databases prove database behavior without touching the developer database.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 10, PostgreSQL 17, PostGIS 3.5, `pg@8.22.0`, `node-pg-migrate@9.0.0`, Vitest 4.

**Approved specification:** [`../../../specs/phase-00-foundation/00.02-database-foundation.md`](../../../specs/phase-00-foundation/00.02-database-foundation.md)

## Global Constraints

- Scope is Task 00.02 only; Task 00.03 must not start.
- Use `node-pg-migrate@9.0.0`, pinned exactly; do not add an ORM, query builder, second migration engine, or custom migration runner.
- PostgreSQL is 17 and the local image remains `postgis/postgis:17-3.5`.
- Connection source is `DATABASE_URL` only; never log URLs, usernames, passwords, raw environment values, SQL parameter values, or migration file contents.
- Migrations run only through explicit developer/deployment commands, never during API, web, or worker startup.
- Keep `advisoryLockMode: 'fail'`, locking enabled, and one transaction for pending migrations; do not wait, retry, fake, or disable the lock.
- Production correction is forward-only. Local down reverts exactly one migration and must reject `NODE_ENV=production` before opening a database connection.
- The first migration creates only `postgis`, `pgcrypto`, `citext`, empty `app`, `audit`, `ingestion`, migration history, three NOLOGIN group roles, and the public-schema privilege baseline.
- `ikimetr_migrator` owns the four project/history schemas and history table. Extensions remain owned by the privileged deployment/migration caller because PostgreSQL 17 provides no `ALTER EXTENSION ... OWNER`; runtime roles receive no extension ownership or grants.
- Do not add business tables, seeds, LOGIN roles, credentials, RLS, Supabase coupling, application repositories, API contracts, domain files, startup migrations, telemetry, or backup automation.
- Test database names must match `^ikimetr_test_[a-f0-9]{24}$`; validate before every `CREATE DATABASE`, connection termination, or `DROP DATABASE` statement and clean in `finally`.
- Do not drop the cluster-wide `ikimetr_app`, `ikimetr_worker`, or `ikimetr_migrator` roles during local down or test cleanup.
- Stop if role/extension creation needs unsafe privilege broadening, the advisory lock cannot be proven, an app/domain file must change, or any destructive command could target a non-disposable database.
- Execute this plan inline with `superpowers:executing-plans`; do not dispatch subagents for this project.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `package.json` | Root migration command entrypoints. |
| `pnpm-lock.yaml` | Exact dependency resolution for `node-pg-migrate@9.0.0`. |
| `packages/database/package.json` | Package migration commands and exact migration dependency. |
| `packages/database/migration.config.json` | Static CLI configuration: directory, history schema/table, TS files, quiet logging, fail lock. |
| `packages/database/migration/assert-local.ts` | Pure production-down guard plus safe CLI entrypoint. |
| `packages/database/migration/verify-manifest.ts` | Deterministic manifest parser, path validation, SHA-256 verification, and CLI entrypoint. |
| `packages/database/migrations/1786492800000_foundation.ts` | Foundation extensions, roles, schemas, owners, and grants only. |
| `packages/database/migrations/manifest.json` | Exact migration path/hash allowlist. |
| `packages/database/src/index.ts` | Backward-compatible connection plus query-only transaction boundary. |
| `packages/database/test/database.test.ts` | Transaction state-machine unit tests using a mocked `pg` pool. |
| `packages/database/test/migration-config.test.ts` | Command/config/down-guard contract tests. |
| `packages/database/test/migration-manifest.test.ts` | Manifest success and all fail-closed cases. |
| `packages/database/test/migration-test-helper.ts` | Validated disposable-database lifecycle and programmatic test-only runner. |
| `packages/database/test/migrations.integration.test.ts` | Clean/no-op/state/failure/lock/down-up/real-transaction evidence. |
| `README.md` | Exact local and deployment workflow, forward-only production rule. |
| `docs/ai/AI_COST_SYSTEM_HANDOFF.md` | Final checkpoint only, after all verification passes. |

No file under `apps/`, `packages/ai-cost-system/`, or a domain module is authorized.

---

### Task 1: Pin the Migration Tool and Freeze the Command Contract

**Files:**
- Modify: `package.json`
- Modify: `packages/database/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/database/migration.config.json`
- Create: `packages/database/migration/assert-local.ts`
- Create: `packages/database/test/migration-config.test.ts`

**Interfaces:**
- Produces root scripts `db:migrate:verify`, `db:migrate:up`, `db:migrate:down:local`, `db:migrate:create`.
- Produces `assertLocalMigrationEnvironment(environment: NodeJS.ProcessEnv): void`.
- Does not connect to PostgreSQL in the guard.

- [ ] **Step 1: Write the RED config/guard tests**

Create tests that load both package JSON files and `migration.config.json`, then assert these exact values:

```ts
expect(databasePackage.devDependencies['node-pg-migrate']).toBe('9.0.0');
expect(rootPackage.scripts['db:migrate:up']).toBe(
  'pnpm --filter @ikimetr/database db:migrate:up',
);
expect(config).toEqual({
  dir: 'migrations',
  'migrations-schema': 'migration',
  'create-migrations-schema': true,
  'migrations-table': 'pgmigrations',
  'migration-file-language': 'ts',
  'migration-filename-format': 'timestamp',
  'check-order': true,
  verbose: false,
  'advisory-lock-mode': 'fail',
});
expect(() =>
  assertLocalMigrationEnvironment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
).toThrow('Production migration rollback is disabled');
expect(() =>
  assertLocalMigrationEnvironment({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
).not.toThrow();
```

Also assert the package `up` and `down` scripts contain `--single-transaction --lock --advisory-lock-mode fail`, `down 1`, and no `--fake`, `--no-lock`, `DATABASE_URL=`, or URL-shaped text.

- [ ] **Step 2: Run the focused test and prove RED**

Run: `pnpm exec vitest run packages/database/test/migration-config.test.ts`

Expected: FAIL because the config, guard, scripts, and dependency do not exist.

- [ ] **Step 3: Add exact dependency, scripts, config, and guard**

Add `node-pg-migrate: 9.0.0` to `packages/database` `devDependencies`. Add these package scripts:

```json
{
  "db:migrate:verify": "tsx migration/verify-manifest.ts",
  "db:migrate:up": "pnpm run db:migrate:verify && node-pg-migrate up --config-file migration.config.json --single-transaction --lock --advisory-lock-mode fail",
  "db:migrate:down:local": "tsx migration/assert-local.ts && pnpm run db:migrate:verify && node-pg-migrate down 1 --config-file migration.config.json --single-transaction --lock --advisory-lock-mode fail",
  "db:migrate:create": "node-pg-migrate create --config-file migration.config.json"
}
```

Root scripts only delegate with `pnpm --filter @ikimetr/database <script>`. Implement the guard exactly as a pure check plus direct-execution block:

```ts
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertLocalMigrationEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  if (environment['NODE_ENV'] === 'production') {
    throw new Error('Production migration rollback is disabled');
  }
}

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url) {
  assertLocalMigrationEnvironment(process.env);
}
```

Run `corepack pnpm install` so only the intended package manifest and lockfile resolution change.

- [ ] **Step 4: Prove GREEN and inspect dependency scope**

Run:

```bash
pnpm exec vitest run packages/database/test/migration-config.test.ts
pnpm --filter @ikimetr/database typecheck
git diff -- package.json packages/database/package.json pnpm-lock.yaml packages/database/migration.config.json packages/database/migration/assert-local.ts
```

Expected: focused tests and typecheck PASS; diff contains exact `9.0.0`, no second migration library, no credentials.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/database/package.json pnpm-lock.yaml packages/database/migration.config.json packages/database/migration/assert-local.ts packages/database/test/migration-config.test.ts
git commit -m "build(database): add migration command contract"
```

---

### Task 2: Add the Callback Transaction Boundary

**Files:**
- Modify: `packages/database/src/index.ts`
- Create: `packages/database/test/database.test.ts`

**Interfaces:**
- Produces the exact `DatabaseTransaction` and expanded `DatabaseConnection` interfaces from the approved specification.
- Preserves `createDatabaseConnection(connectionString)` and existing pool limits.

- [ ] **Step 1: Write transaction state-machine tests with a hoisted `pg` mock**

Use `vi.hoisted` and `vi.mock('pg', ...)` so production code remains free of test injection. Assert exact query sequences and error identity for:

```ts
['BEGIN', 'SELECT 42', 'COMMIT'];
['BEGIN', 'ROLLBACK']; // callback failure
['BEGIN', 'COMMIT', 'ROLLBACK']; // commit failure
```

The suite must also prove BEGIN failure releases without rollback, rollback failure preserves the callback/commit error object, `connect()` is called once, `release()` is called exactly once after acquisition, no automatic retry occurs, `close()` is idempotent, and both `check()` and `transaction()` reject with `Database connection is closed` after close without calling `pool.query` or `pool.connect` again.

- [ ] **Step 2: Run and prove RED**

Run: `pnpm exec vitest run packages/database/test/database.test.ts`

Expected: FAIL because `DatabaseConnection.transaction` does not exist.

- [ ] **Step 3: Implement the minimal transaction state machine**

Add the approved interfaces and implement this control flow in `createDatabaseConnection`:

```ts
async transaction<T>(
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  assertOpen();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    try {
      const value = await work({
        query: async <Row extends QueryResultRow = QueryResultRow>(
          text: string,
          values?: readonly unknown[],
        ) => client.query<Row>(text, values ? [...values] : undefined),
      });
      await client.query('COMMIT');
      return value;
    } catch (originalError) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the callback or COMMIT failure.
      }
      throw originalError;
    }
  } finally {
    client.release();
  }
}
```

`assertOpen()` throws only the fixed safe message. Call it before `check()` and `transaction()`. Set `closed = true` before awaiting `pool.end()`; do not expose the pool/client and do not retry.

- [ ] **Step 4: Prove GREEN**

Run:

```bash
pnpm exec vitest run packages/database/test/database.test.ts packages/database/test/database.integration.test.ts
pnpm --filter @ikimetr/database typecheck
```

Expected: unit PASS; existing health integration PASS when PostgreSQL is running; typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/index.ts packages/database/test/database.test.ts
git commit -m "feat(database): add callback transactions"
```

---

### Task 3: Implement Deterministic Migration Manifest Verification

**Files:**
- Create: `packages/database/migration/verify-manifest.ts`
- Create: `packages/database/test/migration-manifest.test.ts`

**Interfaces:**
- Produces `verifyMigrationManifest(options): Promise<readonly string[]>`.
- Accepts explicit `repositoryRoot`, `migrationDirectory`, and `manifestPath` in tests; CLI derives fixed repository paths from `import.meta.url`.
- Returns verified repository-relative paths in lexical order; throws one stable sorted error report.

Use this exact public options shape:

```ts
export interface VerifyMigrationManifestOptions {
  repositoryRoot: string;
  migrationDirectory: string;
  manifestPath: string;
}
```

- [ ] **Step 1: Write RED verifier tests**

For each case create a fresh `mkdtemp(join(tmpdir(), 'ikimetr-manifest-'))`, write only synthetic migration bytes/manifest JSON, and remove that exact directory in `finally`. Cover: valid manifest, missing entry, entry without file, hash mismatch, duplicate normalized path, `../` escape, absolute path, backslash/non-normalized path, malformed JSON/shape, lexical output order, and a sentinel migration body never appearing in an error message.

- [ ] **Step 2: Run and prove RED**

Run: `pnpm exec vitest run packages/database/test/migration-manifest.test.ts`

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement strict parsing, path checks, enumeration, and hashing**

Use only Node built-ins: `readFile`, `readdir`, `createHash`, `relative`, `resolve`, `sep`, and `pathToFileURL`. The manifest shape is exact:

```ts
interface MigrationManifest {
  version: 1;
  migrations: Array<{ path: string; sha256: string }>;
}
```

Accept only lowercase 64-character hex hashes. Each path must equal its POSIX-normalized form, use `/`, be relative, remain inside `packages/database/migrations`, and name a regular migration file. Exclude only `manifest.json` from discovered files. Compare manifest/discovered sets both ways, validate each migration buffer as UTF-8 with `new TextDecoder('utf-8', { fatal: true }).decode(bytes)`, hash the original `Buffer` bytes directly, sort every path and error, and throw:

```ts
throw new Error(
  `Migration manifest verification failed:\n${errors
    .sort((left, right) => left.localeCompare(right))
    .map((error) => `- ${error}`)
    .join('\n')}`,
);
```

The CLI success output is only `Verified N migration file(s).`; on failure print only the safe error message, set `process.exitCode = 1`, and never print file bytes, hashes, environment data, or a connection string.

- [ ] **Step 4: Prove GREEN and perform a leak scan**

Run:

```bash
pnpm exec vitest run packages/database/test/migration-manifest.test.ts
pnpm --filter @ikimetr/database typecheck
rg -n "DATABASE_URL|password|console\.log\(.*content|readFile\(.*\.env" packages/database/migration packages/database/test/migration-manifest.test.ts
```

Expected: tests/typecheck PASS; scan contains no secret-reading or content-printing path.

- [ ] **Step 5: Commit**

```bash
git add packages/database/migration/verify-manifest.ts packages/database/test/migration-manifest.test.ts
git commit -m "feat(database): verify migration integrity"
```

---

### Task 4: Add the Foundation Migration and Exact Manifest

**Files:**
- Create: `packages/database/migrations/1786492800000_foundation.ts`
- Create: `packages/database/migrations/manifest.json`

**Interfaces:**
- `up` creates/enforces only approved foundation objects.
- `down` removes database-local foundation objects without `CASCADE`, restores public `CREATE`, and intentionally retains cluster-wide NOLOGIN roles.

- [ ] **Step 1: Create the approved migration exactly**

Use `MigrationBuilder`; create roles idempotently in a constant `DO $$` block, enforce `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`, create the three extensions with `ifNotExists`, create `app`, `audit`, and `ingestion` with authorization `ikimetr_migrator`, alter `migration` and `migration.pgmigrations` ownership to `ikimetr_migrator`, and revoke public `CREATE`.

The `down` function must call, without `cascade`: `dropSchema` for `ingestion`, `audit`, `app`; `dropExtension` for `citext`, `pgcrypto`, `postgis`; then `GRANT CREATE ON SCHEMA public TO PUBLIC`. It must not drop any role.

Create the file with this exact content:

```ts
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_app') THEN
    CREATE ROLE ikimetr_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_worker') THEN
    CREATE ROLE ikimetr_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ikimetr_migrator') THEN
    CREATE ROLE ikimetr_migrator NOLOGIN;
  END IF;
END
$$;
`);

  pgm.sql(
    'ALTER ROLE ikimetr_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );
  pgm.sql(
    'ALTER ROLE ikimetr_worker WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );
  pgm.sql(
    'ALTER ROLE ikimetr_migrator WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
  );

  pgm.createExtension('postgis', { ifNotExists: true });
  pgm.createExtension('pgcrypto', { ifNotExists: true });
  pgm.createExtension('citext', { ifNotExists: true });

  pgm.createSchema('app', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });
  pgm.createSchema('audit', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });
  pgm.createSchema('ingestion', {
    authorization: 'ikimetr_migrator',
    ifNotExists: true,
  });

  pgm.sql('ALTER SCHEMA migration OWNER TO ikimetr_migrator');
  pgm.sql('ALTER TABLE migration.pgmigrations OWNER TO ikimetr_migrator');
  pgm.sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropSchema('ingestion', { ifExists: true });
  pgm.dropSchema('audit', { ifExists: true });
  pgm.dropSchema('app', { ifExists: true });
  pgm.dropExtension('citext', { ifExists: true });
  pgm.dropExtension('pgcrypto', { ifExists: true });
  pgm.dropExtension('postgis', { ifExists: true });
  pgm.sql('GRANT CREATE ON SCHEMA public TO PUBLIC');

  // Cluster-wide NOLOGIN roles intentionally survive local database rollback.
}
```

- [ ] **Step 2: Format and pin the exact-byte hash**

Run:

```bash
pnpm exec prettier --write packages/database/migrations/1786492800000_foundation.ts
sha256sum packages/database/migrations/1786492800000_foundation.ts
```

For the exact approved migration text and formatting in this plan, expected SHA-256 is `720dfd1145ab989974d426469aadd4eae84e2fb4e72a10bdf0b4bcd9b58f66fc`. Stop if formatting produces another value; inspect the file instead of changing the manifest blindly.

Create:

```json
{
  "version": 1,
  "migrations": [
    {
      "path": "packages/database/migrations/1786492800000_foundation.ts",
      "sha256": "720dfd1145ab989974d426469aadd4eae84e2fb4e72a10bdf0b4bcd9b58f66fc"
    }
  ]
}
```

- [ ] **Step 3: Verify migration loading without applying SQL**

Run:

```bash
pnpm db:migrate:verify
pnpm --filter @ikimetr/database typecheck
```

Expected: `Verified 1 migration file(s).`; typecheck PASS. Do not run `up` against the developer database at this task.

- [ ] **Step 4: Commit**

```bash
git add packages/database/migrations/1786492800000_foundation.ts packages/database/migrations/manifest.json
git commit -m "feat(database): add foundation migration"
```

---

### Task 5: Prove Clean Apply, No-op Repeat, State, and Real Transactions

**Files:**
- Create: `packages/database/test/migration-test-helper.ts`
- Create: `packages/database/test/migrations.integration.test.ts`
- Modify: `packages/database/test/database.integration.test.ts` only if sharing lifecycle code is strictly necessary

**Interfaces:**
- Produces `withDisposableDatabase(test): Promise<void>` that creates a random validated database from the admin URL and always drops only that database in `finally`.
- Produces `runTestMigrations(databaseUrl, options?)` using the dependency's exported `runner`; this is test-only and not an application migration runner.

Use these exact test-only interfaces:

```ts
import type { Pool } from 'pg';

export interface DisposableDatabase {
  databaseName: string;
  databaseUrl: string;
  pool: Pool;
}

export interface TestMigrationOptions {
  direction?: 'up' | 'down';
  count?: number;
  directory?: string;
}

export interface TestMigrationResult {
  readonly path: string;
  readonly name: string;
  readonly timestamp: number;
}

export async function withDisposableDatabase(
  test: (database: DisposableDatabase) => Promise<void>,
): Promise<void>;

export async function runTestMigrations(
  databaseUrl: string,
  options?: TestMigrationOptions,
): Promise<readonly TestMigrationResult[]>;
```

`directory` may be only the committed migration directory or a freshly created test fixture directory beneath the current test's `mkdtemp` root; validate that containment before passing it to the runner.

- [ ] **Step 1: Write RED integration assertions**

Assert a clean `up` returns exactly one migration, a second `up` returns `[]`, and database queries prove:

- extensions `postgis`, `pgcrypto`, `citext` exist;
- schemas `app`, `audit`, `ingestion`, `migration` exist;
- `app`, `audit`, `ingestion`, and `migration` owners are `ikimetr_migrator`;
- `migration.pgmigrations` owner is `ikimetr_migrator` and contains one row;
- extension owners equal the fixed deployment/migration test caller and are not `ikimetr_app` or `ikimetr_worker`;
- the three roles have `rolcanlogin`, `rolsuper`, `rolcreatedb`, `rolcreaterole`, and `rolreplication` all false;
- `has_schema_privilege('ikimetr_app', 'public', 'CREATE')` is false while `USAGE` is true;
- `app`, `audit`, and `ingestion` contain zero tables;
- no application startup file changed.

Add a real transaction assertion: `SELECT 42` returns inside `DatabaseConnection.transaction`, and a deliberately thrown callback after `CREATE SCHEMA ikimetr_tx_probe` leaves that schema absent.

- [ ] **Step 2: Run and prove RED**

Run: `pnpm exec vitest run --config vitest.integration.config.ts packages/database/test/migrations.integration.test.ts`

Expected: FAIL because the disposable helper does not exist.

- [ ] **Step 3: Implement the disposable database safety boundary**

Generate names with `randomBytes(12).toString('hex')`; validate with `/^ikimetr_test_[a-f0-9]{24}$/` immediately before every interpolated identifier. Parse `DATABASE_URL` with `new URL`, derive an admin URL whose pathname is `/postgres`, and derive the test URL only after validation. Use quoted identifiers only after validation. Cleanup order is: close test pools, connect admin, terminate connections only where `datname = $1`, execute `DROP DATABASE "validated_name" WITH (FORCE)`, close admin. Never log either URL.

The runner options are fixed:

```ts
{
  databaseUrl,
  dir: migrationsDirectory,
  direction,
  count,
  migrationsSchema: 'migration',
  createMigrationsSchema: true,
  migrationsTable: 'pgmigrations',
  checkOrder: true,
  singleTransaction: true,
  advisoryLockMode: 'fail',
  log: () => undefined,
}
```

Do not expose a `noLock`, `fake`, arbitrary directory, or unvalidated database-name option from the helper.

- [ ] **Step 4: Prove GREEN**

Run the focused integration test twice to prove cleanup/idempotency, then run the existing connectivity test. Expected: all PASS and no `ikimetr_test_*` database remains in `pg_database`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/test/migration-test-helper.ts packages/database/test/migrations.integration.test.ts packages/database/test/database.integration.test.ts
git commit -m "test(database): verify foundation state"
```

---

### Task 6: Prove Transactional Failure, Fail-closed Concurrency, and Local Down/up

**Files:**
- Modify: `packages/database/test/migrations.integration.test.ts`
- Modify: `packages/database/test/migration-test-helper.ts` only for fixed test-only fixture support

**Interfaces:**
- Temporary migration directories are created under `mkdtemp`, contain constant test migrations, and are removed in `finally`.
- Production scripts/config remain unchanged.

- [ ] **Step 1: Add a transactional-failure test**

Create two constant temporary migrations: one creates schema `ikimetr_failure_probe`; the next raises `RAISE EXCEPTION 'expected migration failure'`. Run them in one transaction and assert rejection, absence of the probe schema, and zero matching history rows. The assertion must inspect only the safe fixed error phrase, never a connection URL or SQL parameters.

- [ ] **Step 2: Add a deterministic advisory-lock test**

Create a constant pending migration that sleeps for two seconds and then creates `ikimetr_lock_probe`. Start runner A; poll `pg_locks` every 25 ms for at most five seconds using the known 64-bit lock split (`classid = 1686128`, `objid = 708954076`, `objsubid = 1`, `locktype = 'advisory'`, `granted`) for exported `PG_MIGRATE_LOCK_ID = 7241865325823964`; only after the lock is observed start runner B. Assert runner B rejects with `Another migration is already running`, runner A fulfills, the probe schema exists once, and the history contains one row. Do not use an unbounded sleep or timing-only race. Give each migration integration test an explicit `60_000` ms Vitest timeout so slow WSL/PostGIS startup does not create false failures.

- [ ] **Step 3: Add the guarded local down/up test**

In a disposable database apply the committed foundation, invoke runner `down` with `count: 1`, assert the history row is removed and cluster-wide roles still exist, then run `up` and assert the row/state return. Separately spawn `pnpm --filter @ikimetr/database db:migrate:down:local` with `NODE_ENV=production` and a deliberately invalid `DATABASE_URL`; assert the guard fails with `Production migration rollback is disabled` before any connection error. Do not execute the root down command against the normal `ikimetr` database.

- [ ] **Step 4: Run focused integration twice**

Run:

```bash
pnpm exec vitest run --config vitest.integration.config.ts packages/database/test/migrations.integration.test.ts
pnpm exec vitest run --config vitest.integration.config.ts packages/database/test/migrations.integration.test.ts
```

Expected both times: PASS; no remaining disposable database or probe schema; second runner fails closed only in the concurrency case.

- [ ] **Step 5: Commit**

```bash
git add packages/database/test/migration-test-helper.ts packages/database/test/migrations.integration.test.ts
git commit -m "test(database): prove migration failure safety"
```

---

### Task 7: Document, Verify, Security-review, and Checkpoint

**Files:**
- Modify: `README.md`
- Modify: `docs/ai/AI_COST_SYSTEM_HANDOFF.md`
- Modify: `specs/phase-00-foundation/00.02-database-foundation.md` only to mark completion after evidence passes

- [ ] **Step 1: Document exact operator workflow**

README must show: copy `.env`; start Docker; `pnpm db:migrate:verify`; `pnpm db:migrate:up`; `pnpm db:migrate:create -- <name>` followed by format/hash/manifest update; local-only `pnpm db:migrate:down:local`; production forward-only corrections; deployment-only migration credentials; no startup migration; managed-provider privilege mismatch as a stop condition. State that local down retains cluster-wide NOLOGIN roles.

- [ ] **Step 2: Run formatting and focused package checks**

```bash
pnpm format
pnpm db:migrate:verify
pnpm --filter @ikimetr/database --if-present lint
pnpm --filter @ikimetr/database typecheck
pnpm exec vitest run packages/database/test/database.test.ts packages/database/test/migration-config.test.ts packages/database/test/migration-manifest.test.ts
```

If formatting changes the migration, update its manifest hash only after reviewing the migration diff; then rerun verification.

- [ ] **Step 3: Run the full required checkpoint**

With Docker PostgreSQL/Redis healthy:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm audit:prod
```

Expected: every command exits 0. Record exact test counts and audit result from fresh output.

- [ ] **Step 4: Run deterministic scope and secret checks**

```bash
git diff --name-only origin/main...HEAD
git diff --check origin/main...HEAD
if git diff origin/main...HEAD -- . ':!pnpm-lock.yaml' | rg -n "(postgres(ql)?://[^[:space:]]+:[^[:space:]]+@|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,})"; then exit 1; fi
if git diff --name-only origin/main...HEAD | rg -n "^(apps/|packages/ai-cost-system/)"; then exit 1; fi
```

Expected: only authorized files; `git diff --check` PASS; secret and forbidden-scope scans return no matches. Confirm no business table creation exists outside `migration.pgmigrations` and PostGIS-managed objects.

- [ ] **Step 5: Perform the required security review**

Record: risk MEDIUM; authorization N/A; privacy PASS; data exposure PASS; input validation PASS; abuse N/A; audit N/A; AI security PASS. Required evidence: no LOGIN roles/passwords, no PUBLIC `CREATE`, no runtime migration privilege, no secrets/log leaks, no dynamic unvalidated database identifiers, no role drop, no `CASCADE`, fail-closed lock, production down guard. Verdict must be BLOCK if any evidence fails.

- [ ] **Step 6: Update status and handoff only after all evidence is green**

Set the task status to `Completed` and add a compact handoff containing migration filename/hash, commands/results, the retained-role/local-down limitation, managed-provider stop condition, and `NEXT: Task 00.03 — Logging & observability (not started)`.

- [ ] **Step 7: Commit final documentation**

```bash
git add README.md specs/phase-00-foundation/00.02-database-foundation.md docs/ai/AI_COST_SYSTEM_HANDOFF.md
git commit -m "docs(database): complete foundation handoff"
```

---

## Review Gates and Stop Boundaries

- Do not start Task 1 until this plan is explicitly approved.
- Review each RED result before writing its GREEN implementation.
- Do not use the normal `ikimetr` database for migration integration tests or down tests.
- Do not proceed after a manifest mismatch, unsafe role/extension privilege requirement, unexpected advisory-lock behavior, secret finding, scope violation, or non-disposable destructive target.
- Do not mark Task 00.02 complete or start Task 00.03 until every Definition of Done command has fresh passing evidence.
