import type { HealthProbe, HealthResponse } from '@ikimetr/shared';
import type { FastifyInstance } from 'fastify';

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

export function registerHealthRoute(
  app: FastifyInstance,
  dependencies: { database: HealthProbe; redis: HealthProbe },
): void {
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
}
