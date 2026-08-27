import { type HealthProbe, JOB_QUEUE_KEY } from '@ikimetr/shared';
import { createClient } from 'redis';

export interface RedisHealthConnection extends HealthProbe {
  connect(): Promise<void>;
  close(): Promise<void>;
  enqueue(jobId: string): Promise<void>;
}

export function createRedisHealthConnection(
  url: string,
): RedisHealthConnection {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: false,
    },
  });

  client.on('error', () => undefined);

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
