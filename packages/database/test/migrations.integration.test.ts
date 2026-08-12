import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../src/index.js';
import {
  runTestMigrations,
  withMigrationFixture,
  withDisposableDatabase,
} from './migration-test-helper.js';

const integrationTimeout = 60_000;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const failureProbeMigration = `
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createSchema('ikimetr_failure_probe');
}
`;

const expectedFailureMigration = `
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DO $$ BEGIN RAISE EXCEPTION 'expected migration failure'; END $$;");
}
`;

const lockProbeMigration = `
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql('SELECT pg_sleep(2)');
  pgm.createSchema('ikimetr_lock_probe');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropSchema('ikimetr_lock_probe');
}
`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProductionDownGuard(): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(
      command,
      ['--filter', '@ikimetr/database', 'db:migrate:down:local'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://127.0.0.1:1/not_used',
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

async function waitForMigrationLock(pool: Pool): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const lock = await pool.query<{ locked: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = 1686128
          AND objid = 708954076
          AND objsubid = 1
          AND granted
      ) AS locked
    `);
    if (lock.rows[0]?.locked === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Migration advisory lock was not observed');
}

describe('database foundation migrations', () => {
  it(
    'applies once and establishes only the approved foundation state',
    async () => {
      await withDisposableDatabase(async ({ databaseUrl, pool }) => {
        const firstRun = await runTestMigrations(databaseUrl);
        const secondRun = await runTestMigrations(databaseUrl);

        expect(firstRun).toHaveLength(1);
        expect(firstRun[0]?.name).toBe('1786492800000_foundation');
        expect(secondRun).toEqual([]);

        const extensions = await pool.query<{
          extname: string;
          owner: string;
        }>(`
          SELECT extension.extname, role.rolname AS owner
          FROM pg_extension AS extension
          JOIN pg_roles AS role ON role.oid = extension.extowner
          WHERE extension.extname IN ('postgis', 'pgcrypto', 'citext')
          ORDER BY extension.extname
        `);
        expect(extensions.rows.map(({ extname }) => extname)).toEqual([
          'citext',
          'pgcrypto',
          'postgis',
        ]);
        expect(
          extensions.rows.every(
            ({ owner }) =>
              owner !== 'ikimetr_app' && owner !== 'ikimetr_worker',
          ),
        ).toBe(true);
        expect(new Set(extensions.rows.map(({ owner }) => owner)).size).toBe(1);

        const deploymentRole = await pool.query<{ current_user: string }>(
          'SELECT current_user',
        );
        expect(extensions.rows[0]?.owner).toBe(
          deploymentRole.rows[0]?.current_user,
        );

        const schemas = await pool.query<{ name: string; owner: string }>(`
          SELECT namespace.nspname AS name, role.rolname AS owner
          FROM pg_namespace AS namespace
          JOIN pg_roles AS role ON role.oid = namespace.nspowner
          WHERE namespace.nspname IN ('app', 'audit', 'ingestion', 'migration')
          ORDER BY namespace.nspname
        `);
        expect(schemas.rows).toEqual([
          { name: 'app', owner: 'ikimetr_migrator' },
          { name: 'audit', owner: 'ikimetr_migrator' },
          { name: 'ingestion', owner: 'ikimetr_migrator' },
          { name: 'migration', owner: 'ikimetr_migrator' },
        ]);

        const history = await pool.query<{
          migration_count: string;
          owner: string;
        }>(`
          SELECT role.rolname AS owner, COUNT(*)::text AS migration_count
          FROM migration.pgmigrations AS history
          JOIN pg_class AS relation ON relation.oid = 'migration.pgmigrations'::regclass
          JOIN pg_roles AS role ON role.oid = relation.relowner
          GROUP BY role.rolname
        `);
        expect(history.rows).toEqual([
          { migration_count: '1', owner: 'ikimetr_migrator' },
        ]);

        const roles = await pool.query<{
          rolcanlogin: boolean;
          rolcreatedb: boolean;
          rolcreaterole: boolean;
          rolname: string;
          rolreplication: boolean;
          rolsuper: boolean;
        }>(`
          SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication
          FROM pg_roles
          WHERE rolname IN ('ikimetr_app', 'ikimetr_worker', 'ikimetr_migrator')
          ORDER BY rolname
        `);
        expect(roles.rows).toEqual(
          ['ikimetr_app', 'ikimetr_migrator', 'ikimetr_worker'].map(
            (rolname) => ({
              rolcanlogin: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolname,
              rolreplication: false,
              rolsuper: false,
            }),
          ),
        );

        const publicPrivileges = await pool.query<{
          can_create: boolean;
          can_use: boolean;
        }>(`
          SELECT
            has_schema_privilege('ikimetr_app', 'public', 'CREATE') AS can_create,
            has_schema_privilege('ikimetr_app', 'public', 'USAGE') AS can_use
        `);
        expect(publicPrivileges.rows).toEqual([
          { can_create: false, can_use: true },
        ]);

        const projectTableCount = await pool.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count
          FROM information_schema.tables
          WHERE table_schema IN ('app', 'audit', 'ingestion')
        `);
        expect(projectTableCount.rows).toEqual([{ count: '0' }]);
      });
    },
    integrationTimeout,
  );

  it(
    'commits successful callbacks and rolls back failed callbacks',
    async () => {
      await withDisposableDatabase(async ({ databaseUrl, pool }) => {
        const database = createDatabaseConnection(databaseUrl);
        try {
          await expect(
            database.transaction(async (transaction) => {
              const answer = await transaction.query<{ answer: number }>(
                'SELECT 42 AS answer',
              );
              return answer.rows[0]?.answer;
            }),
          ).resolves.toBe(42);

          await expect(
            database.transaction(async (transaction) => {
              await transaction.query('CREATE SCHEMA ikimetr_tx_probe');
              throw new Error('expected callback failure');
            }),
          ).rejects.toThrow('expected callback failure');

          const probe = await pool.query<{ exists: boolean }>(`
            SELECT EXISTS (
              SELECT 1 FROM pg_namespace WHERE nspname = 'ikimetr_tx_probe'
            ) AS exists
          `);
          expect(probe.rows).toEqual([{ exists: false }]);
        } finally {
          await database.close();
        }
      });
    },
    integrationTimeout,
  );

  it(
    'rolls back every migration when a later migration fails',
    async () => {
      await withDisposableDatabase(async ({ databaseUrl, pool }) => {
        await withMigrationFixture(
          [
            {
              name: '1786492801000_create_failure_probe.ts',
              content: failureProbeMigration,
            },
            {
              name: '1786492801001_expected_failure.ts',
              content: expectedFailureMigration,
            },
          ],
          async (directory) => {
            await expect(
              runTestMigrations(databaseUrl, { directory }),
            ).rejects.toThrow('expected migration failure');
          },
        );

        const probe = await pool.query<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_namespace WHERE nspname = 'ikimetr_failure_probe'
          ) AS exists
        `);
        expect(probe.rows).toEqual([{ exists: false }]);

        const history = await pool.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count
          FROM migration.pgmigrations
          WHERE name IN (
            '1786492801000_create_failure_probe',
            '1786492801001_expected_failure'
          )
        `);
        expect(history.rows).toEqual([{ count: '0' }]);
      });
    },
    integrationTimeout,
  );

  it(
    'fails a concurrent runner closed after observing the advisory lock',
    async () => {
      expect(PG_MIGRATE_LOCK_ID).toBe(7_241_865_325_823_964);

      await withDisposableDatabase(async ({ databaseUrl, pool }) => {
        await withMigrationFixture(
          [
            {
              name: '1786492802000_lock_probe.ts',
              content: lockProbeMigration,
            },
          ],
          async (directory) => {
            const runnerA = runTestMigrations(databaseUrl, { directory });
            await waitForMigrationLock(pool);
            const runnerB = runTestMigrations(databaseUrl, { directory });
            const [resultA, resultB] = await Promise.allSettled([
              runnerA,
              runnerB,
            ]);

            expect(resultA.status).toBe('fulfilled');
            expect(resultB.status).toBe('rejected');
            if (resultB.status === 'rejected') {
              expect(errorMessage(resultB.reason)).toContain(
                'Another migration is already running',
              );
            }
          },
        );

        const probe = await pool.query<{ exists: boolean }>(`
          SELECT EXISTS (
            SELECT 1 FROM pg_namespace WHERE nspname = 'ikimetr_lock_probe'
          ) AS exists
        `);
        expect(probe.rows).toEqual([{ exists: true }]);
        const history = await pool.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count
          FROM migration.pgmigrations
          WHERE name = '1786492802000_lock_probe'
        `);
        expect(history.rows).toEqual([{ count: '1' }]);
      });
    },
    integrationTimeout,
  );

  it(
    'supports one isolated down/up cycle while retaining cluster roles',
    async () => {
      await withDisposableDatabase(async ({ databaseUrl, pool }) => {
        await runTestMigrations(databaseUrl);
        const down = await runTestMigrations(databaseUrl, {
          direction: 'down',
          count: 1,
        });
        expect(down).toHaveLength(1);

        const afterDown = await pool.query<{
          history_count: string;
          role_count: string;
        }>(`
          SELECT
            (SELECT COUNT(*)::text FROM migration.pgmigrations) AS history_count,
            (
              SELECT COUNT(*)::text
              FROM pg_roles
              WHERE rolname IN ('ikimetr_app', 'ikimetr_worker', 'ikimetr_migrator')
            ) AS role_count
        `);
        expect(afterDown.rows).toEqual([
          { history_count: '0', role_count: '3' },
        ]);

        await runTestMigrations(databaseUrl);
        const afterUp = await pool.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count FROM migration.pgmigrations
        `);
        expect(afterUp.rows).toEqual([{ count: '1' }]);
      });
    },
    integrationTimeout,
  );

  it(
    'blocks production down before attempting a database connection',
    async () => {
      const result = await runProductionDownGuard();

      expect(result.code).not.toBe(0);
      expect(result.output).toContain(
        'Production migration rollback is disabled',
      );
      expect(result.output).not.toContain('ECONNREFUSED');
      expect(result.output).not.toContain('not_used');
    },
    integrationTimeout,
  );
});
