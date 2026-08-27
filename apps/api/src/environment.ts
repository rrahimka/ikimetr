import {
  EnvironmentValidationError,
  connectionUrlSchema,
  nodeEnvironmentSchema,
  portSchema,
  validateEnvironment,
  z,
} from '@ikimetr/validation';

const apiEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: portSchema.default(3001),
  DATABASE_URL: connectionUrlSchema(['postgres', 'postgresql']),
  NODE_ENV: nodeEnvironmentSchema,
  REDIS_URL: connectionUrlSchema(['redis', 'rediss']),
  INGESTION_SERVICE_TOKEN: z.string().min(16).optional(),
  PAYMENT_PROVIDER: z.enum(['test', 'stripe', 'epoint']).default('test'),
  PAYMENT_PROVIDER_SECRET: z.string().min(1).optional(),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(environment = process.env): ApiEnvironment {
  return validateEnvironment(apiEnvironmentSchema, environment);
}

export function getApiStartupErrorMessage(error: unknown): string {
  if (error instanceof EnvironmentValidationError) {
    return error.message;
  }

  // Intentionally generic: the real error may contain secrets (e.g. a
  // connection string with credentials), so it must not be echoed here. The
  // safe, non-sensitive error code is logged separately by the caller.
  return 'API startup failed';
}
