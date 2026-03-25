import type { Knex } from 'knex';

/**
 * Migration 044: Add columns for auto-population features.
 *
 * - first_seen_at: timestamp from earliest raw_payload, used to calculate account_age_days
 * - offer_vertical_source: 'auto' or 'manual' to protect manual classifications
 * - offer_vertical_signals: JSONB storing classification signals
 * - daily_spend_limit: denormalized from billing_info.threshold_micros (in currency units)
 * - billing_threshold_micros: raw threshold from Google Ads billing
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS offer_vertical_source VARCHAR(10) DEFAULT 'auto',
      ADD COLUMN IF NOT EXISTS offer_vertical_signals JSONB,
      ADD COLUMN IF NOT EXISTS daily_spend_limit DECIMAL(14, 2),
      ADD COLUMN IF NOT EXISTS billing_threshold_micros BIGINT;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE accounts
      DROP COLUMN IF EXISTS first_seen_at,
      DROP COLUMN IF EXISTS offer_vertical_source,
      DROP COLUMN IF EXISTS offer_vertical_signals,
      DROP COLUMN IF EXISTS daily_spend_limit,
      DROP COLUMN IF EXISTS billing_threshold_micros;
  `);
}
