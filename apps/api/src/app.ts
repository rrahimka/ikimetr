import type { HealthProbe, HealthResponse } from '@ikimetr/shared';
import type { DatabaseConnection } from '@ikimetr/database';
import { z } from '@ikimetr/validation';
import Fastify from 'fastify';

import { AppError } from './errors.js';
import { registerRoutes } from './routes.js';

export interface AppDependencies {
  database: HealthProbe;
  redis: HealthProbe;
  connection: DatabaseConnection;
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
  const app = Fastify({ logger: options.logger ?? false });

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
    return reply
      .code(500)
      .send({ error: 'internal_error', message: 'internal server error' });
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

  registerRoutes(app, dependencies.connection);

  return app;
}
