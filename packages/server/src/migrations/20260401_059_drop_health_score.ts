import type { Knex } from 'knex';

/**
 * Migration 059: Drop health_score column from accounts.
 * Replaced by risk level computed from signals/bans/notifications on the frontend.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_accounts_health_score');
  await knex.raw('ALTER TABLE accounts DROP COLUMN IF EXISTS health_score');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT NULL');
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_accounts_health_score ON accounts (health_score)');
}
