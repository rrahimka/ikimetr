import {
  EnvironmentValidationError,
  connectionUrlSchema,
  nodeEnvironmentSchema,
  positiveIntegerSchema,
  validateEnvironment,
  z,
} from '@ikimetr/validation';

const workerEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema,
    REDIS_URL: connectionUrlSchema(['redis', 'rediss']),
    WORKER_HEARTBEAT_INTERVAL_MS: positiveIntegerSchema.default(5_000),
    WORKER_HEARTBEAT_KEY: z
      .string()
      .regex(/^ikimetr:[a-z0-9][a-z0-9:_-]*$/)
      .default('ikimetr:worker:heartbeat'),
    WORKER_HEARTBEAT_TTL_SECONDS: positiveIntegerSchema.default(15),
  })
  .refine(
    (environment) =>
      environment.WORKER_HEARTBEAT_INTERVAL_MS <
      environment.WORKER_HEARTBEAT_TTL_SECONDS * 1_000,
    {
      message: 'Heartbeat interval must be shorter than its TTL',
      path: ['WORKER_HEARTBEAT_INTERVAL_MS'],
    },
  );

export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function loadWorkerEnvironment(
  environment = process.env,
): WorkerEnvironment {
  return validateEnvironment(workerEnvironmentSchema, environment);
}

export function getWorkerStartupErrorMessage(error: unknown): string {
  if (error instanceof EnvironmentValidationError) {
    return error.message;
  }

  return 'Worker startup failed';
}
