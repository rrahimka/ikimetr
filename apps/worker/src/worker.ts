import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { createClient } from 'redis';

import {
  getWorkerStartupErrorMessage,
  loadWorkerEnvironment,
} from './environment.js';
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
      reconnectStrategy: false,
    },
  });
  redis.on('error', () => undefined);

  const heartbeat = await (async () => {
    try {
      await redis.connect();
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
      throw error;
    }
  })();

  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      return;
    }

    closing = true;
    heartbeat.stop();
    redis.destroy();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, shutdown);
  }
}

startWorker().catch((error: unknown) => {
  console.error(getWorkerStartupErrorMessage(error));
  process.exitCode = 1;
});
