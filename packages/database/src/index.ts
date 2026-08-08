import { Pool } from 'pg';

export interface DatabaseConnection {
  check(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabaseConnection(
  connectionString: string,
): DatabaseConnection {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
  let closed = false;

  return {
    async check() {
      await pool.query('SELECT 1');
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}
