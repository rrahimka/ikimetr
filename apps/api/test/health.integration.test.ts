import { createDatabaseConnection } from '@ikimetr/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { createRedisHealthConnection } from '../src/redis.js';

const databaseUrl =
  process.env['DATABASE_URL'] ??
  'postgresql://ikimetr:local-only-change-me@127.0.0.1:5432/ikimetr';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const database = createDatabaseConnection(databaseUrl);
const redis = createRedisHealthConnection(redisUrl);
const app = buildApp({ database, redis });

beforeAll(async () => {
  await redis.connect();
});

afterAll(async () => {
  await app.close();
  await Promise.all([database.close(), redis.close()]);
});

describe('GET /health with live dependencies', () => {
  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
