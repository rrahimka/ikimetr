import type { HealthProbe, HealthResponse } from '@ikimetr/shared';
import { healthStatuses } from '@ikimetr/shared';
import Fastify from 'fastify';

export interface AppDependencies {
  database: HealthProbe;
  redis: HealthProbe;
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
      enum: [healthStatuses.ok, healthStatuses.unavailable],
    },
  },
} as const;

export function buildApp(
  dependencies: AppDependencies,
  options: BuildAppOptions = {},
) {
  const app = Fastify({ logger: options.logger ?? false });

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

        return { status: healthStatuses.ok };
      } catch {
        return reply.code(503).send({ status: healthStatuses.unavailable });
      }
    },
  );

  return app;
}
