import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';

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

export interface MigrationFixtureFile {
  readonly name: string;
  readonly content: string;
}

const disposableDatabasePattern = /^ikimetr_test_[a-f0-9]{24}$/u;
const migrationFixtureNamePattern = /^\d{13}_[a-z0-9_]+\.ts$/u;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const committedMigrationsDirectory = resolve(
  repositoryRoot,
  'packages/database/migrations',
);
const activeMigrationFixtures = new Set<string>();

function assertDisposableDatabaseName(databaseName: string): void {
  if (!disposableDatabasePattern.test(databaseName)) {
    throw new Error('Refusing to use a non-disposable test database name');
  }
}

function readDatabaseUrl(): URL {
  const value = process.env['DATABASE_URL'];
  if (value === undefined || value.length === 0) {
    throw new Error('DATABASE_URL is required for migration integration tests');
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is invalid');
  }
  if (
    databaseUrl.protocol !== 'postgresql:' &&
    databaseUrl.protocol !== 'postgres:'
  ) {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }
  return databaseUrl;
}

function createDatabaseUrl(source: URL, databaseName: string): string {
  assertDisposableDatabaseName(databaseName);
  const databaseUrl = new URL(source);
  databaseUrl.pathname = `/${databaseName}`;
  return databaseUrl.toString();
}

function selectMigrationDirectory(directory: string | undefined): string {
  const selected = resolve(directory ?? committedMigrationsDirectory);
  if (
    selected !== committedMigrationsDirectory &&
    !activeMigrationFixtures.has(selected)
  ) {
    throw new Error('Migration test directory is not approved');
  }
  return selected;
}

export async function withMigrationFixture(
  files: readonly MigrationFixtureFile[],
  test: (directory: string) => Promise<void>,
): Promise<void> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ikimetr-migrations-'));
  const directory = resolve(fixtureRoot, 'migrations');
  const relativeDirectory = relative(fixtureRoot, directory);
  if (
    relativeDirectory.length === 0 ||
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  ) {
    await rm(fixtureRoot, { force: true, recursive: true });
    throw new Error('Migration fixture directory escaped its temporary root');
  }

  await mkdir(directory);
  const names = new Set<string>();
  try {
    for (const file of files) {
      if (
        !migrationFixtureNamePattern.test(file.name) ||
        names.has(file.name)
      ) {
        throw new Error('Migration fixture filename is invalid or duplicated');
      }
      names.add(file.name);
      await writeFile(resolve(directory, file.name), file.content, {
        encoding: 'utf8',
        flag: 'wx',
      });
    }

    activeMigrationFixtures.add(directory);
    await test(directory);
  } finally {
    activeMigrationFixtures.delete(directory);
    await rm(fixtureRoot, { force: true, recursive: true });
  }
}

export async function withDisposableDatabase(
  test: (database: DisposableDatabase) => Promise<void>,
): Promise<void> {
  const sourceUrl = readDatabaseUrl();
  const databaseName = `ikimetr_test_${randomBytes(12).toString('hex')}`;
  assertDisposableDatabaseName(databaseName);

  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const databaseUrl = createDatabaseUrl(sourceUrl, databaseName);
  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let databasePool: Pool | undefined;
  let created = false;

  try {
    assertDisposableDatabaseName(databaseName);
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    databasePool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 5,
    });
    await test({ databaseName, databaseUrl, pool: databasePool });
  } finally {
    try {
      try {
        await databasePool?.end();
      } finally {
        if (created) {
          assertDisposableDatabaseName(databaseName);
          await adminPool.query(
            `
              SELECT pg_terminate_backend(pid)
              FROM pg_stat_activity
              WHERE datname = $1 AND pid <> pg_backend_pid()
            `,
            [databaseName],
          );
          assertDisposableDatabaseName(databaseName);
          await adminPool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        }
      }
    } finally {
      await adminPool.end();
    }
  }
}

export async function runTestMigrations(
  databaseUrl: string,
  options: TestMigrationOptions = {},
): Promise<readonly TestMigrationResult[]> {
  const migrations = await runner({
    databaseUrl,
    dir: selectMigrationDirectory(options.directory),
    direction: options.direction ?? 'up',
    ...(options.count === undefined ? {} : { count: options.count }),
    migrationsSchema: 'migration',
    createMigrationsSchema: true,
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    ignorePattern: 'manifest\\.json',
    singleTransaction: true,
    advisoryLockMode: 'fail',
    log: () => undefined,
  });

  return migrations.map(({ path, name, timestamp }) => ({
    path,
    name,
    timestamp,
  }));
}
