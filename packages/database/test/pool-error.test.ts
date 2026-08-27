import { describe, expect, it, vi } from 'vitest';

import { createDatabaseConnection } from '../src/index.js';

describe('database pool error handling (audit B)', () => {
  it('logs a safe (no-secret) connection error and keeps query rejections', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Point at a closed port so the connection is refused; the pool emits an
    // 'error' with a code but the message may contain the URL (with a password).
    const conn = createDatabaseConnection(
      'postgresql://user:topsecret@127.0.0.1:1/none',
    );

    await expect(conn.check()).rejects.toBeDefined();

    // Allow the async pool 'error' event to fire (if the driver emits one).
    await new Promise((resolve) => setTimeout(resolve, 250));

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    // If a pool error was logged, it must be safe: no connection secret, and it
    // should identify itself as a postgres pool error (not swallowed silently).
    if (logged.length > 0) {
      expect(logged).toContain('postgres pool client error');
    }
    expect(logged).not.toContain('topsecret');

    await conn.close().catch(() => undefined);
    spy.mockRestore();
  });
});
