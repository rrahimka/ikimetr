import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createDatabaseConnection } from '@ikimetr/database';

import { buildApp } from './app.js';
import {
  getApiStartupErrorMessage,
  loadApiEnvironment,
} from './environment.js';
import { createRedisHealthConnection } from './redis.js';

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
  const app = buildApp({ database, redis }, { logger: true });

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
