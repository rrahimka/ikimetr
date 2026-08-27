import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupTestContext, teardownTestContext } from './helpers.js';
import type { TestContext } from './helpers.js';

const integrationTimeout = 60_000;
const REGISTER_LIMIT = 10;

function registerPayload(): { email: string; password: string } {
  return { email: `rl-${randomUUID()}@example.com`, password: 'password123' };
}

interface RegisterOutcome {
  status: number;
  retryAfter: string | undefined;
}

async function tryRegister(
  context: TestContext,
  forwardedFor?: string,
): Promise<RegisterOutcome> {
  const res = await context.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    payload: registerPayload(),
  });
  const raw = res.headers['retry-after'];
  const retryAfter = Array.isArray(raw) ? raw[0] : raw;
  return {
    status: res.statusCode,
    retryAfter: typeof retryAfter === 'string' ? retryAfter : undefined,
  };
}

describe('rate limiting with no trusted proxy (audit 1B issue 3)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    // No trustedProxies -> request.ip is the socket peer; XFF is ignored.
    ctx = await setupTestContext(undefined, true);
  }, integrationTimeout);
  afterEach(async () => {
    if (ctx) await teardownTestContext(ctx);
  });

  it(
    'spoofed X-Forwarded-For from an untrusted source does NOT bypass the limiter',
    async () => {
      // Every request carries a UNIQUE forged X-Forwarded-For. If the limiter
      // keyed on the header, none would ever be limited. They must all share
      // the socket bucket and hit 429 after the limit.
      let limited = false;
      let limitedHasRetryAfter = false;
      for (let i = 0; i < REGISTER_LIMIT + 2; i += 1) {
        const res = await tryRegister(ctx, `203.0.113.${i}`);
        if (res.status === 429) {
          limited = true;
          limitedHasRetryAfter = res.retryAfter !== undefined;
          break;
        }
        expect(res.status).toBe(201);
      }
      expect(limited).toBe(true);
      expect(limitedHasRetryAfter).toBe(true);
    },
    integrationTimeout,
  );
});

describe('rate limiting behind a trusted proxy (audit 1B issue 3)', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    // Trust the loopback inject peer so X-Forwarded-For is honored.
    ctx = await setupTestContext(undefined, true, ['127.0.0.1']);
  }, integrationTimeout);
  afterEach(async () => {
    if (ctx) await teardownTestContext(ctx);
  });

  it(
    'trusted proxy forwarding resolves the intended client IP',
    async () => {
      // Client A (XFF 198.51.100.10) hammers the register limit.
      let aLimitedRetryAfter: string | undefined;
      for (let i = 0; i < REGISTER_LIMIT + 1; i += 1) {
        const res = await tryRegister(ctx, '198.51.100.10');
        if (res.status === 429) {
          aLimitedRetryAfter = res.retryAfter;
          break;
        }
        expect(res.status).toBe(201);
      }

      // Client B (a different XFF) is independent and still allowed.
      const b = await tryRegister(ctx, '198.51.100.20');
      expect(b.status).toBe(201);

      expect(aLimitedRetryAfter).toBeDefined();
      expect(Number(aLimitedRetryAfter)).toBeGreaterThan(0);
    },
    integrationTimeout,
  );
});
