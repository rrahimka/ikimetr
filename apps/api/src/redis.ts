import { type HealthProbe, JOB_QUEUE_KEY } from '@ikimetr/shared';
import { createClient, type RedisClientType } from 'redis';

export interface RedisHealthConnection extends HealthProbe {
  connect(): Promise<void>;
  close(): Promise<void>;
  enqueue(jobId: string): Promise<void>;
}

function buildRedisClient(url: string): RedisClientType {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 5_000,
      // Bounded backoff (capped at 5s) instead of `false`. This lets the
      // API/worker survive a transient Redis outage and reconnect automatically
      // when Redis returns, without spinning in a hot retry loop.
      reconnectStrategy: (retries) => Math.min(retries * 200, 5_000),
    },
  });

  // Swallow connection errors so they don't become unhandled rejections; the
  // reconnect strategy above handles recovery. No secrets are logged.
  client.on('error', () => undefined);
  return client;
}

export function createRedisClient(url: string): RedisClientType {
  return buildRedisClient(url);
}

export function createRedisHealthConnection(
  url: string,
): RedisHealthConnection {
  const client = buildRedisClient(url);

  return {
    async connect() {
      if (!client.isOpen) {
        await client.connect();
      }
    },
    async check() {
      if (!client.isReady) {
        throw new Error('Redis is unavailable');
      }

      await client.ping();
    },
    async enqueue(jobId: string) {
      if (!client.isReady) {
        throw new Error('Redis is unavailable');
      }
      await client.lPush(JOB_QUEUE_KEY, jobId);
    },
    async close() {
      if (client.isOpen) {
        client.destroy();
      }
    },
  };
}
