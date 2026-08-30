import type { preHandlerHookHandler } from 'fastify';
import type { DatabaseConnection } from '@ikimetr/database';

import { UnauthenticatedError } from './errors.js';
import { getUserFromSession } from './identity/service.js';

export function extractToken(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const header = request.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return undefined;
}

export function createAuthPreHandler(
  connection: DatabaseConnection,
): preHandlerHookHandler {
  return async (request) => {
    const token = extractToken(request);
    if (!token) {
      throw new UnauthenticatedError();
    }
    const user = await getUserFromSession(connection, token);
    if (!user) {
      throw new UnauthenticatedError();
    }
    request.user = user;
  };
}
