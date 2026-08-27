import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export interface DatabaseTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface DatabaseConnection {
  check(): Promise<void>;
  transaction<T>(
    work: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T>;
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
  // Swallow client-level errors. During teardown (e.g. DROP DATABASE ... WITH
  // (FORCE) or pg_terminate_backend) idle clients are killed by the server with
  // a FATAL; without this handler the emitted 'error' becomes an unhandled
  // rejection that fails the whole test run even though all tests passed.
  // Optional chaining keeps the mock Pool used by unit tests working.
  pool.on?.('error', () => {});
  let closed = false;

  const assertOpen = (): void => {
    if (closed) {
      throw new Error('Database connection is closed');
    }
  };

  return {
    async check() {
      assertOpen();
      await pool.query('SELECT 1');
    },
    async transaction<T>(
      work: (transaction: DatabaseTransaction) => Promise<T>,
    ): Promise<T> {
      assertOpen();
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        try {
          const transaction: DatabaseTransaction = {
            async query<Row extends QueryResultRow = QueryResultRow>(
              text: string,
              values?: readonly unknown[],
            ): Promise<QueryResult<Row>> {
              return values === undefined
                ? client.query<Row>(text)
                : client.query<Row>(text, [...values]);
            },
          };
          const value = await work(transaction);
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
    },
    async close() {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    },
  };
}
