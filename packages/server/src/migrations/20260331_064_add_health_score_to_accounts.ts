import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE accounts
      ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT NULL;

    CREATE INDEX IF NOT EXISTS idx_accounts_health_score ON accounts (health_score);

    COMMENT ON COLUMN accounts.health_score IS
      'Auto-calculated 0-100 health score. 100=healthy, 0=critical risk. Updated on each collect.';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS idx_accounts_health_score;
    ALTER TABLE accounts DROP COLUMN IF EXISTS health_score;
  `);
}
