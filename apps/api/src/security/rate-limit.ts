import type { RedisClientType } from 'redis';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { TooManyRequestsError } from '../errors.js';

export interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}

export type RateLimitPreHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

function clientKey(request: FastifyRequest): string {
  // Prefer the authenticated user id; otherwise the connection IP. We do NOT
  // trust spoofable headers (no explicit proxy contract), so request.ip is the
  // socket peer, not an X-Forwarded-For.
  const user = (request as unknown as { user?: { id?: string } }).user;
  if (user?.id) {
    return `user:${user.id}`;
  }
  return `ip:${request.ip}`;
}

/**
 * Fixed-window rate limiter backed by Redis INCR + PEXPIRE.
 *
 * Policy: if Redis is unavailable we fail OPEN (allow the request) rather than
 * blocking all traffic on an outage; the proxy/CDN is the backstop. This is a
 * conscious decision: a false-positive block on a Redis blip is worse than a
 * brief window of unlimited requests.
 */
export function createRateLimitPre(
  redis: RedisClientType | undefined,
  opts: RateLimitOptions,
): RateLimitPreHandler {
  return async (request, reply) => {
    if (!redis) {
      return;
    }
    const key = `rl:${opts.keyPrefix}:${clientKey(request)}`;
    let count: number;
    try {
      count = await redis.incr(key);
      if (count === 1) {
        await redis.pExpire(key, opts.windowMs);
      }
    } catch {
      return;
    }
    if (count > opts.limit) {
      const ttl = await redis.pTTL(key).catch(() => opts.windowMs);
      reply.header(
        'Retry-After',
        Math.max(1, Math.ceil((ttl > 0 ? ttl : opts.windowMs) / 1000)),
      );
      throw new TooManyRequestsError();
    }
  };
}
