import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';

import { createDatabaseConnection } from '@ikimetr/database';

import { buildApp, type JobEnqueue } from './app.js';
import {
  getApiStartupErrorMessage,
  loadApiEnvironment,
} from './environment.js';
import { createRedisHealthConnection } from './redis.js';
import { createPaymentProvider } from './billing/provider.js';

const JOB_MAX_ATTEMPTS = 5;

function loadLocalEnvironment(): void {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }
}

function createJobEnqueue(
  database: ReturnType<typeof createDatabaseConnection>,
  redis: ReturnType<typeof createRedisHealthConnection>,
): JobEnqueue {
  return async (type, payload, idempotencyKey) => {
    const jobId = randomUUID();
    await database.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO app.jobs (id, type, payload, idempotency_key, max_attempts, status, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', now())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          jobId,
          type,
          JSON.stringify(payload),
          idempotencyKey,
          JOB_MAX_ATTEMPTS,
        ],
      );
    });
    await redis.enqueue(jobId);
  };
}

async function startApi(): Promise<void> {
  loadLocalEnvironment();
  const environment = loadApiEnvironment();
  const database = createDatabaseConnection(environment.DATABASE_URL);
  const redis = createRedisHealthConnection(environment.REDIS_URL);
  const enqueueJob = createJobEnqueue(database, redis);
  const paymentProvider = createPaymentProvider(environment);
  const app = buildApp(
    { database, redis, connection: database, enqueueJob, paymentProvider },
    { logger: true },
  );

  app.addHook('onClose', async () => {
    await Promise.allSettled([database.close(), redis.close()]);
  });

  try {
    await Promise.all([
      database.check(),
      redis.connect().then(() => redis.check()),
    ]);
    await app.listen({
      host: environment.API_HOST,
      port: environment.API_PORT,
    });
  } catch (error) {
    await app.close();
    throw error;
  }

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    await app.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  }
}

startApi().catch((error: unknown) => {
  console.error(getApiStartupErrorMessage(error));
  process.exitCode = 1;
});
