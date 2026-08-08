import type { HealthProbe } from '@ikimetr/shared';
import { createClient } from 'redis';

export interface RedisHealthConnection extends HealthProbe {
  connect(): Promise<void>;
  close(): Promise<void>;
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
    async close() {
      if (client.isOpen) {
        client.destroy();
      }
    },
  };
}
