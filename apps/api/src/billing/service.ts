import type {
  DatabaseConnection,
  DatabaseTransaction,
} from '@ikimetr/database';
import type { Outbox } from '../queue/outbox.js';
import { type PaymentEvent, type PaymentProvider } from './provider.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { writeAudit } from '../audit.js';

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  interval: string;
  features: string[];
  limits: Record<string, number>;
}

export interface SubscriptionView {
  id: string;
  planCode: string;
  planName: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface Entitlements {
  planCode: string;
  planName: string;
  features: string[];
  limits: Record<string, number>;
}

interface DbPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_amount: string;
  currency: string;
  interval: string;
  features: unknown;
  limits: unknown;
}

function parseFeatures(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return [];
}

function parseLimits(value: unknown): Record<string, number> {
  if (value && typeof value === 'object') {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number') {
        out[k] = v;
      }
    }
    return out;
  }
  return {};
}

export async function listPlans(db: DatabaseConnection): Promise<Plan[]> {
  const result = await db.transaction(async (tx) => {
    return tx.query<DbPlan>(
      `SELECT id, code, name, description, price_amount, currency, interval, features, limits
       FROM app.plans WHERE is_active = true ORDER BY sort_order ASC`,
    );
  });
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceAmount: Number(row.price_amount),
    currency: row.currency,
    interval: row.interval,
    features: parseFeatures(row.features),
    limits: parseLimits(row.limits),
  }));
}

async function findPlanByCode(
  db: DatabaseConnection,
  code: string,
): Promise<DbPlan | null> {
  const result = await db.transaction(async (tx) => {
    return tx.query<DbPlan>(
      `SELECT id, code, name, description, price_amount, currency, interval, features, limits
       FROM app.plans WHERE code = $1`,
      [code],
    );
  });
  return result.rows[0] ?? null;
}

async function findActiveSubscription(
  db: DatabaseConnection,
  userId: string,
): Promise<{
  subscriptionId: string;
  planId: string;
  status: string;
  expiresAt: string | null;
} | null> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      plan_id: string;
      status: string;
      expires_at: string | null;
    }>(
      `SELECT s.id, s.plan_id, s.status, s.expires_at
       FROM app.subscriptions s
       WHERE s.user_id = $1
         AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > now())
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId],
    );
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    subscriptionId: row.id,
    planId: row.plan_id,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

export async function getMySubscription(
  db: DatabaseConnection,
  userId: string,
): Promise<SubscriptionView | null> {
  const result = await db.transaction(async (tx) => {
    return tx.query<{
      id: string;
      code: string;
      name: string;
      status: string;
      starts_at: string | null;
      expires_at: string | null;
      renews_at: string | null;
      cancel_at_period_end: boolean;
    }>(
      `SELECT s.id, p.code, p.name, s.status, s.starts_at, s.expires_at,
              s.renews_at, s.cancel_at_period_end
       FROM app.subscriptions s
       JOIN app.plans p ON p.id = s.plan_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId],
    );
  });
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    planCode: row.code,
    planName: row.name,
    status: row.status,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    renewsAt: row.renews_at,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

export async function getEntitlements(
  db: DatabaseConnection,
  userId: string,
): Promise<Entitlements> {
  const active = await findActiveSubscription(db, userId);
  if (active) {
    const plan = await findPlanById(db, active.planId);
    if (plan) {
      return {
        planCode: plan.code,
        planName: plan.name,
        features: parseFeatures(plan.features),
        limits: parseLimits(plan.limits),
      };
    }
  }
  const free = await findPlanByCode(db, 'free');
  if (free) {
    return {
      planCode: free.code,
      planName: free.name,
      features: parseFeatures(free.features),
      limits: parseLimits(free.limits),
    };
  }
  return { planCode: 'free', planName: 'Free', features: [], limits: {} };
}

async function findPlanById(
  db: DatabaseConnection,
  planId: string,
): Promise<DbPlan | null> {
  const result = await db.transaction(async (tx) => {
    return tx.query<DbPlan>(
      `SELECT id, code, name, description, price_amount, currency, interval, features, limits
       FROM app.plans WHERE id = $1`,
      [planId],
    );
  });
  return result.rows[0] ?? null;
}

export async function hasEntitlement(
  db: DatabaseConnection,
  userId: string,
  feature: string,
): Promise<boolean> {
  const entitlements = await getEntitlements(db, userId);
  return entitlements.features.includes(feature);
}

export async function requireEntitlement(
  db: DatabaseConnection,
  userId: string,
  feature: string,
): Promise<void> {
  if (!(await hasEntitlement(db, userId, feature))) {
    throw new ForbiddenError(
      `entitlement "${feature}" is required for this action`,
    );
  }
}

export async function createCheckout(
  db: DatabaseConnection,
  provider: PaymentProvider,
  userId: string,
  planCode: string,
): Promise<{ checkoutUrl: string; providerPaymentId: string }> {
  const plan = await findPlanByCode(db, planCode);
  if (!plan) {
    throw new NotFoundError('plan not found');
  }
  if (plan.code === 'free') {
    throw new ValidationError('free plan does not require checkout');
  }

  const checkout = await provider.createCheckout({
    userId,
    planId: plan.id,
    planCode: plan.code,
    amount: Number(plan.price_amount),
    currency: plan.currency,
  });

  // Payment ledger model: `createCheckout` records ONE "payment intent" row
  // (provider_payment_id = X, provider_event_id = NULL, status 'pending'). The
  // webhook later records ONE "payment event" row keyed by provider_event_id
  // (idempotent). These two rows have distinct business meaning (intent vs
  // settled event) and are both intentional. The subscription row carries
  // provider_payment_id and is the source of truth for entitlements.
  await db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM app.payments
       WHERE provider = $1 AND provider_payment_id = $2`,
      [provider.name, checkout.providerPaymentId],
    );
    if (existing.rowCount === null || existing.rowCount === 0) {
      const sub = await tx.query<{ id: string }>(
        `INSERT INTO app.subscriptions (user_id, plan_id, status, provider, provider_payment_id)
         VALUES ($1, $2, 'pending', $3, $4) RETURNING id`,
        [userId, plan.id, provider.name, checkout.providerPaymentId],
      );
      await tx.query(
        `INSERT INTO app.payments (user_id, provider, provider_payment_id, subscription_id, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [
          userId,
          provider.name,
          checkout.providerPaymentId,
          sub.rows[0]!.id,
          Number(plan.price_amount),
          plan.currency,
        ],
      );
    }
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    providerPaymentId: checkout.providerPaymentId,
  };
}

export interface WebhookResult {
  applied: boolean;
  reason?: string;
  jobIds?: string[];
}

export async function handleWebhook(
  db: DatabaseConnection,
  provider: PaymentProvider,
  rawBody: unknown,
  signature: string | undefined,
  outbox: Outbox,
): Promise<WebhookResult> {
  if (!signature) {
    throw new ValidationError('missing webhook signature');
  }
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    throw new ValidationError('invalid webhook signature');
  }

  const event = provider.parseEvent(rawBody);
  if (!event.id) {
    throw new ValidationError('webhook event missing id');
  }

  const result = await db.transaction(async (tx) => {
    const subLookup = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM app.subscriptions WHERE provider = $1 AND provider_payment_id = $2 LIMIT 1`,
      [provider.name, event.paymentId ?? event.id],
    );
    const userId =
      subLookup.rows[0]?.user_id ?? '00000000-0000-0000-0000-000000000000';

    // Record the settled "payment event" ledger row, idempotent on
    // (provider, provider_event_id). This is a separate business record from
    // the checkout intent row created in `createCheckout`.
    const insert = await tx.query<{ id: string }>(
      `INSERT INTO app.payments (user_id, provider, provider_payment_id, provider_event_id, status, raw_event)
       VALUES ($1, $2, $3, $4, 'received', $5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        userId,
        provider.name,
        event.paymentId ?? event.id,
        event.id,
        JSON.stringify(rawBody),
      ],
    );
    if (insert.rowCount === 0) {
      return { applied: false, reason: 'duplicate_event' };
    }

    if (event.type === 'payment.succeeded') {
      return applyPaymentSucceeded(tx, provider, event, outbox);
    }
    if (event.type === 'subscription.cancelled') {
      return applySubscriptionCancelled(tx, provider, event, outbox);
    }
    if (event.type === 'subscription.expired') {
      return applySubscriptionExpired(tx, provider, event, outbox);
    }
    return { applied: true, reason: 'ignored' };
  });

  // Wake committed job ids AFTER the outer transaction commits, so a job is
  // never pushed to Redis before the business event is durable. If the wake
  // fails, the durable queued row remains and the worker reconciler recovers it.
  if (result.jobIds && result.jobIds.length > 0) {
    for (const jobId of result.jobIds) {
      await outbox.wake(jobId);
    }
  }
  return result;
}

async function applyPaymentSucceeded(
  tx: DatabaseTransaction,
  provider: PaymentProvider,
  event: PaymentEvent,
  outbox: Outbox,
): Promise<WebhookResult> {
  const lookup = await tx.query<{
    id: string;
    user_id: string;
    plan_id: string;
    price_amount: string;
    currency: string;
    status: string;
  }>(
    `SELECT s.id, s.user_id, s.plan_id, p.price_amount, p.currency, s.status
     FROM app.subscriptions s
     JOIN app.plans p ON p.id = s.plan_id
     WHERE s.provider = $1 AND s.provider_payment_id = $2`,
    [provider.name, event.paymentId ?? event.id],
  );
  if (lookup.rowCount === 0) {
    return { applied: true, reason: 'no_subscription' };
  }
  const sub = lookup.rows[0]!;
  if (sub.status === 'active') {
    return { applied: false, reason: 'already_active' };
  }
  if (
    (event.amount !== undefined && event.amount !== Number(sub.price_amount)) ||
    (event.currency !== undefined && event.currency !== sub.currency)
  ) {
    await tx.query(
      `UPDATE app.payments SET status = 'failed', updated_at = now()
       WHERE provider = $1 AND provider_event_id = $2`,
      [provider.name, event.id],
    );
    await writeAudit(tx, {
      actorUserId: sub.user_id,
      action: 'subscription.admin.update',
      targetType: 'subscription',
      targetId: sub.id,
      metadata: { reason: 'amount_mismatch', event },
    });
    return { applied: false, reason: 'amount_mismatch' };
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await tx.query(
    `UPDATE app.subscriptions
     SET status = 'active', starts_at = now(), expires_at = $1, renews_at = $1, updated_at = now()
     WHERE id = $2`,
    [expiresAt.toISOString(), sub.id],
  );
  await tx.query(
    `UPDATE app.payments SET status = 'succeeded', updated_at = now()
     WHERE provider = $1 AND provider_payment_id = $2`,
    [provider.name, event.paymentId ?? event.id],
  );
  const jobIds: string[] = [];
  const jobId = await outbox.insertJob(
    tx,
    'notification.deliver',
    {
      userId: sub.user_id,
      type: 'system_notice',
      referenceType: 'subscription',
      referenceId: sub.id,
      title: 'Subscription activated',
      body: 'Your Pro subscription is now active.',
    },
    `sub:activated:${sub.id}`,
  );
  if (jobId) {
    jobIds.push(jobId);
  }
  return { applied: true, jobIds };
}

async function applySubscriptionCancelled(
  tx: DatabaseTransaction,
  provider: PaymentProvider,
  event: PaymentEvent,
  outbox: Outbox,
): Promise<WebhookResult> {
  const result = await tx.query<{
    id: string;
    user_id: string;
    status: string;
  }>(
    `UPDATE app.subscriptions
     SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE provider = $1 AND provider_payment_id = $2 AND status <> 'cancelled'
     RETURNING id, user_id, status`,
    [provider.name, event.paymentId ?? event.id],
  );
  if (result.rowCount === 0) {
    return { applied: false, reason: 'no_subscription' };
  }
  const sub = result.rows[0]!;
  const jobIds: string[] = [];
  const jobId = await outbox.insertJob(
    tx,
    'notification.deliver',
    {
      userId: sub.user_id,
      type: 'system_notice',
      referenceType: 'subscription',
      referenceId: sub.id,
      title: 'Subscription cancelled',
      body: 'Your subscription has been cancelled.',
    },
    `sub:cancelled:${sub.id}`,
  );
  if (jobId) {
    jobIds.push(jobId);
  }
  return { applied: true, jobIds };
}

async function applySubscriptionExpired(
  tx: DatabaseTransaction,
  provider: PaymentProvider,
  event: PaymentEvent,
  outbox: Outbox,
): Promise<WebhookResult> {
  const result = await tx.query<{ id: string; user_id: string }>(
    `UPDATE app.subscriptions
     SET status = 'expired', updated_at = now()
     WHERE provider = $1 AND provider_payment_id = $2 AND status <> 'expired'
     RETURNING id, user_id`,
    [provider.name, event.paymentId ?? event.id],
  );
  if (result.rowCount === 0) {
    return { applied: false, reason: 'no_subscription' };
  }
  const sub = result.rows[0]!;
  const jobIds: string[] = [];
  const jobId = await outbox.insertJob(
    tx,
    'notification.deliver',
    {
      userId: sub.user_id,
      type: 'system_notice',
      referenceType: 'subscription',
      referenceId: sub.id,
      title: 'Subscription expired',
      body: 'Your subscription has expired.',
    },
    `sub:expired:${sub.id}`,
  );
  if (jobId) {
    jobIds.push(jobId);
  }
  return { applied: true, jobIds };
}

export async function createOwnerAlert(
  db: DatabaseConnection,
  userId: string,
  listingId: string,
): Promise<{ id: string }> {
  await requireEntitlement(db, userId, 'owner_alerts');
  const listing = await db.transaction(async (tx) => {
    const result = await tx.query<{ id: string }>(
      `SELECT id FROM app.listings WHERE id = $1`,
      [listingId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundError('listing not found');
    }
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO app.owner_alerts (user_id, listing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, listing_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING id`,
      [userId, listingId],
    );
    return inserted.rows[0]!;
  });
  return { id: listing.id };
}

export interface OwnerAlertListOptions {
  limit?: number;
  cursor?: string;
}

export interface OwnerAlertListResult {
  items: { id: string; listingId: string; createdAt: string }[];
  nextCursor: string | null;
}

export async function listOwnerAlerts(
  db: DatabaseConnection,
  userId: string,
  options: OwnerAlertListOptions = {},
): Promise<OwnerAlertListResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  // Stable keyset pagination on (created_at DESC, id DESC). `cursor` is the
  // `id` of the last item returned on the previous page.
  const params: unknown[] = [userId, limit + 1];
  let cursorClause = '';
  if (options.cursor) {
    params.push(options.cursor);
    cursorClause = ` AND id < $3`;
  }
  const result = await db.transaction(async (tx) => {
    return tx.query<{ id: string; listing_id: string; created_at: string }>(
      `SELECT id, listing_id, created_at FROM app.owner_alerts
       WHERE user_id = $1${cursorClause}
       ORDER BY id DESC
       LIMIT $2`,
      params,
    );
  });
  const rows = result.rows;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      createdAt: row.created_at,
    })),
    nextCursor: hasMore && last ? last.id : null,
  };
}
