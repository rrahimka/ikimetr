import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { createClient, type RedisClientType } from 'redis';

import { type DatabaseConnection } from '@ikimetr/database';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const migrationsDir = resolve(repositoryRoot, 'packages/database/migrations');
const disposablePattern = /^ikimetr_test_[a-f0-9]{24}$/u;

function readDatabaseUrl(): URL {
  const value = process.env['DATABASE_URL'];
  if (!value) {
    throw new Error('DATABASE_URL is required for worker integration tests');
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

export function createTestRedis(): RedisClientType {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  const client = createClient({ url });
  client.on('error', () => undefined);
  return client;
}

export async function insertUser(
  connection: DatabaseConnection,
): Promise<string> {
  const result = await connection.transaction((tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO app.users (id) VALUES (gen_random_uuid()) RETURNING id`,
      [],
    ),
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('user insert failed');
  }
  return row.id;
}
