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
    DATABASE_URL: connectionUrlSchema(['postgresql', 'postgres']),
    WORKER_HEARTBEAT_INTERVAL_MS: positiveIntegerSchema.default(5_000),
    WORKER_HEARTBEAT_KEY: z
      .string()
      .regex(/^ikimetr:[a-z0-9][a-z0-9:_-]*$/)
      .default('ikimetr:worker:heartbeat'),
    WORKER_HEARTBEAT_TTL_SECONDS: positiveIntegerSchema.default(15),
    WORKER_POLL_TIMEOUT_MS: positiveIntegerSchema.default(2_000),
    WORKER_RETRY_CHECK_INTERVAL_MS: positiveIntegerSchema.default(1_000),
    WORKER_STALE_JOB_MS: positiveIntegerSchema.default(300_000),
    WORKER_STALE_LISTING_DAYS: positiveIntegerSchema.default(7),
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
