import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';

import {
  createDatabaseConnection,
  type DatabaseConnection,
} from '@ikimetr/database';
import type { HealthProbe } from '@ikimetr/shared';

import { buildApp } from '../src/app.js';
import type { AppDependencies } from '../src/app.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const migrationsDir = resolve(repositoryRoot, 'packages/database/migrations');
const disposablePattern = /^ikimetr_test_[a-f0-9]{24}$/u;

function readDatabaseUrl(): URL {
  const value = process.env['DATABASE_URL'];
  if (!value) {
    throw new Error('DATABASE_URL is required for integration tests');
  }
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  }
  return url;
}

export interface TestDatabase {
  databaseUrl: string;
  databaseName: string;
  adminPool: Pool;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const source = readDatabaseUrl();
  const databaseName = `ikimetr_test_${randomBytes(12).toString('hex')}`;
  if (!disposablePattern.test(databaseName)) {
    throw new Error('generated database name is not disposable');
  }
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const databaseUrl = new URL(source);
  databaseUrl.pathname = `/${databaseName}`;

  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  return { databaseUrl: databaseUrl.toString(), databaseName, adminPool };
}

export async function dropTestDatabase(db: TestDatabase): Promise<void> {
  try {
    await db.adminPool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [db.databaseName],
    );
    await db.adminPool.query(`DROP DATABASE "${db.databaseName}" WITH (FORCE)`);
  } finally {
    await db.adminPool.end();
  }
}

export async function migrateDatabase(databaseUrl: string): Promise<void> {
  await runner({
    databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsSchema: 'migration',
    createMigrationsSchema: true,
    migrationsTable: 'pgmigrations',
    checkOrder: true,
    ignorePattern: 'manifest\\.json',
    singleTransaction: true,
    advisoryLockMode: 'fail',
    log: () => undefined,
  });
}

export async function truncateDatabase(
  connection: DatabaseConnection,
): Promise<void> {
  await connection.transaction((tx) =>
    tx.query(
      `TRUNCATE app.users, app.auth_identities, app.sessions, app.profiles,
       app.realtor_profiles, app.agencies, app.agency_memberships,
       app.properties, app.property_status_history, app.property_images
       RESTART IDENTITY CASCADE`,
    ),
  );
}

export interface TestContext {
  app: ReturnType<typeof buildApp>;
  connection: DatabaseConnection;
  database: TestDatabase;
  redisHealth: HealthProbe;
}

export async function setupTestContext(): Promise<TestContext> {
  const database = await createTestDatabase();
  await migrateDatabase(database.databaseUrl);
  const connection = createDatabaseConnection(database.databaseUrl);
  const redisHealth: HealthProbe = { check: async () => undefined };
  const dependencies: AppDependencies = {
    database: connection,
    redis: redisHealth,
    connection,
  };
  const app = buildApp(dependencies);
  await app.ready();
  return { app, connection, database, redisHealth };
}

export async function teardownTestContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.connection.close();
  await dropTestDatabase(ctx.database);
}
