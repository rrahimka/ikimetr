import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerHealthRoute } from '../src/health.js';
import { getApiStartupErrorMessage } from '../src/environment.js';

const databaseCheck = vi.fn<() => Promise<void>>();
const redisCheck = vi.fn<() => Promise<void>>();
let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerHealthRoute(app, {
    database: { check: databaseCheck },
    redis: { check: redisCheck },
  });
  await app.ready();
}, 30_000);

beforeEach(() => {
  databaseCheck.mockReset().mockResolvedValue(undefined);
  redisCheck.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it(
    'returns 200 when all dependencies are healthy',
    { timeout: 10_000 },
    async () => {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(databaseCheck).toHaveBeenCalledOnce();
      expect(redisCheck).toHaveBeenCalledOnce();
    },
  );

  it.each(['database', 'redis'] as const)(
    'returns a sanitized 503 when %s is unavailable',
    async (unavailableDependency) => {
      const secretError = new Error(
        'connection failed for postgresql://user:secret@private-host/db',
      );
      if (unavailableDependency === 'database') {
        databaseCheck.mockRejectedValue(secretError);
      } else {
        redisCheck.mockRejectedValue(secretError);
      }

      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable' });
      expect(response.body).not.toContain('secret');
      expect(response.body).not.toContain('private-host');
    },
  );
});

describe('API startup errors', () => {
  it('does not expose unexpected exception details', () => {
    expect(
      getApiStartupErrorMessage(new Error('redis://user:secret@private-host')),
    ).toBe('API startup failed');
  });
});
