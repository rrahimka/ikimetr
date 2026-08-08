import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHeartbeat } from '../src/heartbeat.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('startHeartbeat', () => {
  it('sets and refreshes a namespaced key with a TTL', async () => {
    vi.useFakeTimers();
    const set = vi.fn().mockResolvedValue('OK');
    const heartbeat = await startHeartbeat(
      { set },
      {
        intervalMs: 1_000,
        key: 'ikimetr:worker:test',
        ttlSeconds: 3,
      },
    );

    expect(set).toHaveBeenCalledWith(
      'ikimetr:worker:test',
      expect.any(String),
      { expiration: { type: 'EX', value: 3 } },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(set).toHaveBeenCalledTimes(2);
    heartbeat.stop();
  });

  it('rejects keys outside the IkiMetr namespace', async () => {
    await expect(
      startHeartbeat(
        { set: vi.fn() },
        { intervalMs: 1_000, key: 'worker:heartbeat', ttlSeconds: 3 },
      ),
    ).rejects.toThrow('ikimetr namespace');
  });
});
