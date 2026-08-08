import { afterAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../src/index.js';

const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://ikimetr:local-only-change-me@127.0.0.1:5432/ikimetr';
const database = createDatabaseConnection(databaseUrl);

afterAll(async () => {
  await database.close();
});

describe('PostgreSQL connectivity', () => {
  it('runs the health probe', async () => {
    await expect(database.check()).resolves.toBeUndefined();
  });
});
