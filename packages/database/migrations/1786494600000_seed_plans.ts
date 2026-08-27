import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    INSERT INTO app.plans (code, name, description, price_amount, currency, interval, features, limits, sort_order)
    VALUES
      ('free', 'Free', 'Core realtor workspace with basic limits.', 0.00, 'AZN', 'month',
        '["core_workspace"]', '{"own_listings": 25, "requests": 25}', 0),
      ('pro', 'Pro', 'Active owner alerts, advanced matching and expanded automation.', 29.00, 'AZN', 'month',
        '["core_workspace", "owner_alerts", "advanced_matching", "expanded_automation"]',
        '{"own_listings": 1000, "requests": 1000}', 10);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DELETE FROM app.plans WHERE code IN ('free', 'pro');`);
}
