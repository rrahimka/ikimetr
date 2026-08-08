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
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function loadApiEnvironment(environment = process.env): ApiEnvironment {
  return validateEnvironment(apiEnvironmentSchema, environment);
}

export function getApiStartupErrorMessage(error: unknown): string {
  if (error instanceof EnvironmentValidationError) {
    return error.message;
  }

  return 'API startup failed';
}
