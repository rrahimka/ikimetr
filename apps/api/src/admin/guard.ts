import type { DatabaseConnection } from '@ikimetr/database';
import { ForbiddenError } from '../errors.js';

export async function requirePlatformAdmin(
  db: DatabaseConnection,
  userId: string,
): Promise<void> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{ role: string }>(
      `SELECT role FROM app.user_roles WHERE user_id = $1 AND role = 'platform_admin'`,
      [userId],
    );
  });
  if (result.rowCount === 0) {
    throw new ForbiddenError('platform administrator access required');
  }
}
