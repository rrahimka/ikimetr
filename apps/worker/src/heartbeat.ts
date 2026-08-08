export interface RedisHeartbeatClient {
  set(
    key: string,
    value: string,
    options: { expiration: { type: 'EX'; value: number } },
  ): Promise<unknown>;
}

export interface HeartbeatOptions {
  intervalMs: number;
  key: string;
  onError?: (error: unknown) => void;
  ttlSeconds: number;
}

export interface Heartbeat {
  stop(): void;
}

export async function startHeartbeat(
  client: RedisHeartbeatClient,
  options: HeartbeatOptions,
): Promise<Heartbeat> {
  if (!/^ikimetr:[a-z0-9][a-z0-9:_-]*$/.test(options.key)) {
    throw new Error('Heartbeat key must use the ikimetr namespace');
  }

  if (
    !Number.isInteger(options.intervalMs) ||
    !Number.isInteger(options.ttlSeconds) ||
    options.intervalMs <= 0 ||
    options.ttlSeconds <= 0 ||
    options.intervalMs >= options.ttlSeconds * 1_000
  ) {
    throw new Error('Heartbeat timing is invalid');
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const onError = options.onError ?? (() => undefined);

  const refresh = async (): Promise<void> => {
    await client.set(options.key, new Date().toISOString(), {
      expiration: { type: 'EX', value: options.ttlSeconds },
    });
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      void refresh()
        .catch(onError)
        .finally(() => {
          if (!stopped) {
            schedule();
          }
        });
    }, options.intervalMs);
  };

  await refresh();
  schedule();

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}
