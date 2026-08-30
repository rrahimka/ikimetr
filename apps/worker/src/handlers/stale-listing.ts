import type { DatabaseTransaction } from '@ikimetr/database';

import { PermanentJobError } from '../job-processor.js';

export async function handleStaleListing(
  tx: DatabaseTransaction,
  payload: unknown,
): Promise<void> {
  let days = 7;
  if (payload !== null && typeof payload === 'object') {
    const candidate = payload as Record<string, unknown>;
    if ('days' in candidate) {
      const parsed = Number(candidate['days']);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new PermanentJobError(
          'stale_listing.days must be a positive number',
        );
      }
      days = parsed;
    }
  }
  await tx.query(
    `UPDATE app.listings SET status = 'stale'
     WHERE status = 'active' AND last_seen_at < now() - ($1 * interval '1 day')`,
    [days],
  );
}
