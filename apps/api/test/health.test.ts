import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { getApiStartupErrorMessage } from '../src/environment.js';

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('GET /health', () => {
  it('returns 200 when all dependencies are healthy', { timeout: 10_000 }, async () => {
    const app = buildApp({
      database: { check: vi.fn().mockResolvedValue(undefined) },
      redis: { check: vi.fn().mockResolvedValue(undefined) },
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it.each(['database', 'redis'] as const)(
    'returns a sanitized 503 when %s is unavailable',
    async (unavailableDependency) => {
      const secretError = new Error(
        'connection failed for postgresql://user:secret@private-host/db',
      );
      const app = buildApp({
        database: {
          check:
            unavailableDependency === 'database'
              ? vi.fn().mockRejectedValue(secretError)
              : vi.fn().mockResolvedValue(undefined),
        },
        redis: {
          check:
            unavailableDependency === 'redis'
              ? vi.fn().mockRejectedValue(secretError)
              : vi.fn().mockResolvedValue(undefined),
        },
      });
      apps.push(app);

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
