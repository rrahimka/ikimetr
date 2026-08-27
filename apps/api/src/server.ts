import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createDatabaseConnection } from '@ikimetr/database';

import { buildApp } from './app.js';
import {
  getApiStartupErrorMessage,
  loadApiEnvironment,
} from './environment.js';
import { createRedisHealthConnection, createRedisClient } from './redis.js';
import { createPaymentProvider } from './billing/provider.js';
import { createJobEnqueue } from './queue/enqueue.js';

function loadLocalEnvironment(): void {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }
}

async function startApi(): Promise<void> {
  loadLocalEnvironment();
  const environment = loadApiEnvironment();
  const database = createDatabaseConnection(environment.DATABASE_URL);
  const redis = createRedisHealthConnection(environment.REDIS_URL);
  const rateLimitRedis = createRedisClient(environment.REDIS_URL);
  const enqueueJob = createJobEnqueue(database, redis);
  const paymentProvider = createPaymentProvider(environment);
  const app = buildApp(
    {
      database,
      redis,
      connection: database,
      enqueueJob,
      paymentProvider,
      rateLimitRedis,
    },
    { logger: true },
  );

  app.addHook('onClose', async () => {
    await Promise.allSettled([
      database.close(),
      redis.close(),
      rateLimitRedis.destroy(),
    ]);
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
    process.stderr.write('SHUTDOWN: received signal, closing app\n');
    try {
      await app.close();
      process.stderr.write('SHUTDOWN: app closed, exiting 0\n');
      process.exit(0);
    } catch (error) {
      process.stderr.write(`SHUTDOWN: close error ${String(error)}\n`);
      process.exit(1);
    }
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
  const code =
    error instanceof Error
      ? (error as Error & { code?: string }).code
      : undefined;
  if (code) {
    console.error(`Startup error code: ${code}`);
  }
  process.exitCode = 1;
});
