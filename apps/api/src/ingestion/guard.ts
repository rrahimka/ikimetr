import { timingSafeEqual } from 'node:crypto';

import type { preHandlerHookHandler } from 'fastify';

import { ForbiddenError, UnauthenticatedError } from '../errors.js';
import { extractToken } from '../guard.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Service-to-service authentication for the ingestion boundary. Uses a shared
 * secret from configuration (never a user/admin token). When the secret is not
 * configured the endpoint is hard-disabled.
 */
export function createServiceAuthPreHandler(
  expectedToken: string | undefined,
): preHandlerHookHandler {
  return async (request) => {
    if (!expectedToken) {
      throw new ForbiddenError('ingestion endpoint is disabled');
    }
    const token = extractToken(request);
    if (!token || !safeEqual(token, expectedToken)) {
      throw new UnauthenticatedError('invalid service token');
    }
  };
}
