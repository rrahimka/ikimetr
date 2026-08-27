import { describe, expect, it } from 'vitest';
import type { RedisClientType } from 'redis';

import { createJobProcessor } from '../src/job-processor.js';
import type { DatabaseConnection } from '@ikimetr/database';

describe('requeuePending (audit E)', () => {
  it('re-enqueues durable queued jobs that were never claimed', async () => {
    const enqueued: string[] = [];
    const fakeRedis = {
      lPush: async (_key: string, id: string) => {
        enqueued.push(id);
        return enqueued.length;
      },
    } as unknown as RedisClientType;

    const fakeDb: DatabaseConnection = {
      async transaction(fn) {
        const tx = {
          async query() {
            return {
              rowCount: 2,
              rows: [{ id: 'q1' }, { id: 'q2' }],
            };
          },
        };
        return fn(tx as never);
      },
      async check() {
        return undefined;
      },
      async close() {
        return undefined;
      },
    };

    const processor = createJobProcessor({
      db: fakeDb,
      redis: fakeRedis,
      handlers: {},
    });
    const requeued = await processor.requeuePending();
    expect(requeued).toBe(2);
    expect(enqueued).toEqual(['q1', 'q2']);
  });

  it('re-enqueues nothing when there are no queued jobs', async () => {
    const enqueued: string[] = [];
    const fakeRedis = {
      lPush: async (_key: string, id: string) => {
        enqueued.push(id);
        return enqueued.length;
      },
    } as unknown as RedisClientType;

    const fakeDb: DatabaseConnection = {
      async transaction(fn) {
        const tx = {
          async query() {
            return { rowCount: 0, rows: [] };
          },
        };
        return fn(tx as never);
      },
      async check() {
        return undefined;
      },
      async close() {
        return undefined;
      },
    };

    const processor = createJobProcessor({
      db: fakeDb,
      redis: fakeRedis,
      handlers: {},
    });
    const requeued = await processor.requeuePending();
    expect(requeued).toBe(0);
    expect(enqueued).toEqual([]);
  });
});
