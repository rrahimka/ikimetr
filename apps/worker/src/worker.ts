import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createClient } from 'redis';

import { createDatabaseConnection } from '@ikimetr/database';

import {
  getWorkerStartupErrorMessage,
  loadWorkerEnvironment,
} from './environment.js';
import { createJobHandlers } from './handlers/index.js';
import { createJobProcessor } from './job-processor.js';
import { startHeartbeat } from './heartbeat.js';

function loadLocalEnvironment(): void {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }
}

async function startWorker(): Promise<void> {
  loadLocalEnvironment();
  const environment = loadWorkerEnvironment();
  const redis = createClient({
    url: environment.REDIS_URL,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
    },
  });
  redis.on('error', () => undefined);

  const database = createDatabaseConnection(environment.DATABASE_URL);
  const processor = createJobProcessor({
    db: database,
    redis,
    handlers: createJobHandlers(),
    pollTimeoutMs: environment.WORKER_POLL_TIMEOUT_MS,
    retryCheckIntervalMs: environment.WORKER_RETRY_CHECK_INTERVAL_MS,
    staleJobMs: environment.WORKER_STALE_JOB_MS,
  });

  const heartbeat = await (async () => {
    try {
      await Promise.all([redis.connect(), database.check()]);
      return await startHeartbeat(
        {
          set: async (key, value, options) => redis.set(key, value, options),
        },
        {
          intervalMs: environment.WORKER_HEARTBEAT_INTERVAL_MS,
          key: environment.WORKER_HEARTBEAT_KEY,
          onError: () => console.error('Worker heartbeat refresh failed'),
          ttlSeconds: environment.WORKER_HEARTBEAT_TTL_SECONDS,
        },
      );
    } catch (error) {
      if (redis.isOpen) {
        redis.destroy();
      }
      await database.close();
      throw error;
    }
  })();

  const processing = processor.start();

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }

    closing = true;
    heartbeat.stop();
    processor.stop();
    await database.close().catch(() => undefined);
    redis.destroy();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  }

  await processing;
}

startWorker().catch((error: unknown) => {
  console.error(getWorkerStartupErrorMessage(error));
  process.exitCode = 1;
});
