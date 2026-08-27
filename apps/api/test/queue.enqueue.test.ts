import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createJobEnqueue } from '../src/queue/enqueue.js';
import type { DatabaseConnection } from '@ikimetr/database';

interface FakeResult {
  rowCount: number | null;
  rows: { id: string; status: string }[];
}

function makeFakeDb() {
  const byKey = new Map<string, string>();
  const db: DatabaseConnection = {
    async transaction(fn) {
      const tx = {
        async query(sql: string, params: unknown[]): Promise<FakeResult> {
          if (sql.startsWith('INSERT')) {
            const key = params[2] as string;
            if (byKey.has(key)) {
              return { rowCount: 0, rows: [] };
            }
            const id = randomUUID();
            byKey.set(key, id);
            return { rowCount: 1, rows: [{ id, status: 'queued' }] };
          }
          if (sql.startsWith('SELECT')) {
            const key = params[0] as string;
            const id = byKey.get(key);
            return {
              rowCount: id ? 1 : 0,
              rows: id ? [{ id, status: 'queued' }] : [],
            };
          }
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
  return { db, byKey };
}

describe('createJobEnqueue (audit D)', () => {
  it('never pushes a phantom id on idempotency-key collision', async () => {
    const { db } = makeFakeDb();
    const enqueued: string[] = [];
    const redis = {
      async enqueue(id: string) {
        enqueued.push(id);
      },
    };

    const enqueueJob = createJobEnqueue(db, redis);
    await enqueueJob('sub.activated', { userId: 'u1' }, 'key-1');
    await enqueueJob('sub.activated', { userId: 'u1' }, 'key-1');

    // Two enqueues, but both must reference the real DB id (same id), never a
    // freshly generated random UUID that has no DB row.
    expect(enqueued).toHaveLength(2);
    expect(enqueued[0]).toBe(enqueued[1]);
  });

  it('does not enqueue a terminal (completed) job again', async () => {
    const { db } = makeFakeDb();
    const enqueued: string[] = [];
    const redis = {
      async enqueue(id: string) {
        enqueued.push(id);
      },
    };
    const enqueueJob = createJobEnqueue(db, redis);

    await enqueueJob('sub.activated', { userId: 'u1' }, 'key-2');
    // Simulate the job becoming completed between calls by pre-seeding a fake
    // SELECT that reports 'completed'.
    const completedDb: DatabaseConnection = {
      async transaction(fn) {
        const tx = {
          async query(_sql: string): Promise<FakeResult> {
            if (_sql.startsWith('INSERT')) {
              return { rowCount: 0, rows: [] };
            }
            if (_sql.startsWith('SELECT')) {
              return {
                rowCount: 1,
                rows: [{ id: 'real-id', status: 'completed' }],
              };
            }
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
    const enqueueJob2 = createJobEnqueue(completedDb, redis);
    await enqueueJob2('sub.activated', { userId: 'u1' }, 'key-2');

    // The completed job must NOT be re-enqueued; only the first (queued) call
    // enqueued.
    expect(enqueued).toHaveLength(1);
    expect(enqueued).not.toContain('real-id');
  });
});
