import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE app.plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar(40) NOT NULL UNIQUE,
      name varchar(120) NOT NULL,
      description varchar(500) NULL,
      price_amount numeric(12,2) NOT NULL DEFAULT 0,
      currency varchar(8) NOT NULL DEFAULT 'AZN',
      interval varchar(20) NOT NULL DEFAULT 'month',
      features jsonb NOT NULL DEFAULT '[]'::jsonb,
      limits jsonb NOT NULL DEFAULT '{}'::jsonb,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      plan_id uuid NOT NULL REFERENCES app.plans(id),
      status varchar(20) NOT NULL DEFAULT 'pending',
      provider varchar(40) NULL,
      provider_subscription_id varchar(120) NULL,
      provider_payment_id varchar(120) NULL,
      starts_at timestamptz NULL,
      expires_at timestamptz NULL,
      renews_at timestamptz NULL,
      cancelled_at timestamptz NULL,
      cancel_at_period_end boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX app_idx_subscriptions_user ON app.subscriptions (user_id, status);
    CREATE INDEX app_idx_subscriptions_provider ON app.subscriptions (provider, provider_subscription_id);

    CREATE TABLE app.user_roles (
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      role varchar(40) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE app.payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      provider varchar(40) NOT NULL,
      provider_payment_id varchar(120) NULL,
      provider_event_id varchar(160) NULL,
      subscription_id uuid NULL REFERENCES app.subscriptions(id) ON DELETE SET NULL,
      amount numeric(12,2) NULL,
      currency varchar(8) NULL,
      status varchar(20) NOT NULL DEFAULT 'pending',
      raw_event jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_event_id)
    );
    CREATE INDEX app_idx_payments_user ON app.payments (user_id);

    CREATE TABLE app.owner_alerts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
      listing_id uuid NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, listing_id)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS app.owner_alerts;
    DROP TABLE IF EXISTS app.payments;
    DROP TABLE IF EXISTS app.user_roles;
    DROP TABLE IF EXISTS app.subscriptions;
    DROP TABLE IF EXISTS app.plans;
  `);
}
