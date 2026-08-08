import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHeartbeat } from '../src/heartbeat.js';

const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const redis = createClient({ url: redisUrl });
redis.on('error', () => undefined);

beforeAll(async () => {
  await redis.connect();
});

afterAll(() => {
  if (redis.isOpen) {
    redis.destroy();
  }
});

describe('worker heartbeat with Redis', () => {
  it('is present while refreshed and expires after refresh stops', async () => {
    const key = 'ikimetr:worker:integration-' + Date.now();
    const heartbeat = await startHeartbeat(
      {
        set: async (heartbeatKey, value, options) =>
          redis.set(heartbeatKey, value, options),
      },
      { intervalMs: 250, key, ttlSeconds: 2 },
    );

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await redis.get(key)).not.toBeNull();
    expect(await redis.ttl(key)).toBeGreaterThan(0);

    heartbeat.stop();
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(await redis.get(key)).toBeNull();
  });
});
