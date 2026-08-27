export const healthStatuses = {
  ok: 'ok',
  unavailable: 'unavailable',
} as const;

export type HealthStatus = (typeof healthStatuses)[keyof typeof healthStatuses];

export interface HealthResponse {
  status: HealthStatus;
}

export interface HealthProbe {
  check(): Promise<void>;
}

export const JOB_QUEUE_KEY = 'ikimetr:jobs:queue';
export const JOB_RETRY_KEY = 'ikimetr:jobs:retry';
export const JOB_DEAD_KEY = 'ikimetr:jobs:dead';
