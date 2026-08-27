import type { HealthProbe, HealthResponse } from '@ikimetr/shared';
import type { DatabaseConnection } from '@ikimetr/database';
import type { RedisClientType } from 'redis';
import { z } from '@ikimetr/validation';
import Fastify from 'fastify';

import { AppError } from './errors.js';
import type { PaymentProvider } from './billing/provider.js';
import { registerRoutes } from './routes.js';
import { type Outbox, insertJobRow } from './queue/outbox.js';

export interface AppDependencies {
  database: HealthProbe;
  redis: HealthProbe;
  connection: DatabaseConnection;
  outbox?: Outbox;
  paymentProvider?: PaymentProvider;
  rateLimitRedis?: RedisClientType;
  /**
   * Trusted reverse-proxy CIDRs. When set, Fastify derives `request.ip` from a
   * trusted `X-Forwarded-For` hop so the rate limiter keys on the real client
   * IP instead of the proxy's address. Leave empty to rate-limit on the direct
   * socket peer (appropriate when the API has no trusted proxy in front of it).
   */
  trustedProxies?: string[];
}

export interface BuildAppOptions {
  logger?: boolean;
}

const healthResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['ok', 'unavailable'],
    },
  },
} as const;

export function buildApp(
  dependencies: AppDependencies,
  options: BuildAppOptions = {},
) {
  const app = Fastify({
    logger: options.logger ?? false,
    ...(dependencies.trustedProxies && dependencies.trustedProxies.length > 0
      ? { trustProxy: dependencies.trustedProxies }
      : {}),
  });

  const corsAllowList = (process.env['API_CORS_ORIGINS'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers['origin'];
    if (origin && corsAllowList.length > 0 && corsAllowList.includes(origin)) {
      reply
        .header('access-control-allow-origin', origin)
        .header('vary', 'origin')
        .header('access-control-allow-credentials', 'true')
        .header(
          'access-control-allow-methods',
          'GET,POST,PATCH,PUT,DELETE,OPTIONS',
        )
        .header('access-control-allow-headers', 'authorization,content-type');
    }
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    reply
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'none'; frame-ancestors 'none'",
      );
    done(null, payload);
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.status)
        .send({ error: error.code, message: error.message });
    }
    if (error instanceof z.ZodError) {
      const detail = error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      return reply
        .code(400)
        .send({ error: 'validation_error', message: detail });
    }
    return reply.code(500).send({
      error: 'internal_error',
      message:
        process.env['NODE_ENV'] === 'production'
          ? 'internal server error'
          : error instanceof Error
            ? error.message
            : 'internal server error',
    });
  });

  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      try {
        await Promise.all([
          dependencies.database.check(),
          dependencies.redis.check(),
        ]);

        return { status: 'ok' };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );

  const outbox: Outbox =
    dependencies.outbox ??
    ({ insertJob: insertJobRow, wake: async () => undefined } as Outbox);

  registerRoutes(
    app,
    dependencies.connection,
    outbox,
    dependencies.paymentProvider,
    dependencies.rateLimitRedis,
  );

  if (dependencies.rateLimitRedis) {
    app.addHook('onReady', async () => {
      if (!dependencies.rateLimitRedis!.isOpen) {
        await dependencies.rateLimitRedis!.connect();
      }
    });
  }

  return app;
}
