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
