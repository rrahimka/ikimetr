import type { RedisClientType } from 'redis';
import { JOB_DEAD_KEY, JOB_QUEUE_KEY, JOB_RETRY_KEY } from '@ikimetr/shared';

export type JobRedis = RedisClientType;

export async function enqueueJob(
  redis: JobRedis,
  jobId: string,
): Promise<void> {
  await redis.lPush(JOB_QUEUE_KEY, jobId);
}

export async function dequeueJob(
  redis: JobRedis,
  timeoutMs: number,
): Promise<string | null> {
  const result = await redis.brPop(JOB_QUEUE_KEY, timeoutMs / 1000);
  return result?.element ?? null;
}

export async function scheduleRetry(
  redis: JobRedis,
  jobId: string,
  delayMs: number,
): Promise<void> {
  await redis.zAdd(JOB_RETRY_KEY, {
    score: Date.now() + delayMs,
    value: jobId,
  });
}

export async function reapRetries(
  redis: JobRedis,
  now: number,
): Promise<string[]> {
  const due = await redis.zRangeByScore(JOB_RETRY_KEY, 0, now);
  if (due.length === 0) {
    return [];
  }
  await redis.zRem(JOB_RETRY_KEY, due);
  return due;
}

export async function moveToDead(
  redis: JobRedis,
  jobId: string,
): Promise<void> {
  await redis.lPush(JOB_DEAD_KEY, jobId);
}
