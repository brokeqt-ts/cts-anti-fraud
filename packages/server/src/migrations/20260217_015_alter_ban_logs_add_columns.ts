import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add 'ad' to ban_target enum
  await knex.raw(`ALTER TYPE ban_target ADD VALUE IF NOT EXISTS 'ad'`);

  // Make account_id nullable (new bans via API use account_google_id directly)
  await knex.raw(`ALTER TABLE ban_logs ALTER COLUMN account_id DROP NOT NULL`);

  // Add new columns
  await knex.raw(`
    ALTER TABLE ban_logs
      ADD COLUMN IF NOT EXISTS account_google_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS snapshot JSONB,
      ADD COLUMN IF NOT EXISTS offer_vertical VARCHAR(50),
      ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS domain VARCHAR(255),
      ADD COLUMN IF NOT EXISTS ban_reason_internal TEXT
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_ban_logs_account_google_id ON ban_logs (account_google_id);
    CREATE INDEX IF NOT EXISTS idx_ban_logs_offer_vertical ON ban_logs (offer_vertical);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_ban_logs_offer_vertical`);
  await knex.raw(`DROP INDEX IF EXISTS idx_ban_logs_account_google_id`);
  await knex.raw(`
    ALTER TABLE ban_logs
      DROP COLUMN IF EXISTS account_google_id,
      DROP COLUMN IF EXISTS snapshot,
      DROP COLUMN IF EXISTS offer_vertical,
      DROP COLUMN IF EXISTS campaign_type,
      DROP COLUMN IF EXISTS domain,
      DROP COLUMN IF EXISTS ban_reason_internal
  `);
}
