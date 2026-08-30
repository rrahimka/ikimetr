import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';

type AuditTarget = DatabaseConnection | DatabaseTransaction;

export type AuditAction =
  | 'subscription.override'
  | 'subscription.cancel'
  | 'user.status.update'
  | 'realtor.status.update'
  | 'agency.status.update'
  | 'listing.status.update'
  | 'external_listing.status.update'
  | 'request.status.update'
  | 'subscription.admin.update'
  | 'admin.action';

export interface WriteAuditInput {
  actorUserId?: string | null;
  actorType?: string;
  action: AuditAction | string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  db: AuditTarget,
  input: WriteAuditInput,
): Promise<void> {
  const run = async (tx: DatabaseTransaction): Promise<void> => {
    await tx.query(
      `INSERT INTO audit.audit_log
         (actor_user_id, actor_type, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorUserId ?? null,
        input.actorType ?? 'platform_admin',
        input.action,
        input.targetType,
        input.targetId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  };

  if (typeof (db as DatabaseConnection).transaction === 'function') {
    await (db as DatabaseConnection).transaction(run);
  } else {
    await run(db as DatabaseTransaction);
  }
}
