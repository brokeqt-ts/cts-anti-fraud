import type { Knex } from 'knex';

/**
 * Migration 020: Add source and resolved_at columns to ban_logs for auto-detection.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE ban_logs
      ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE ban_logs
      DROP COLUMN IF EXISTS source,
      DROP COLUMN IF EXISTS resolved_at
  `);
}
