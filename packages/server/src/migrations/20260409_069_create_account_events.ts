import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE account_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_google_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      field_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_account_events_account ON account_events (account_google_id, created_at DESC);
    CREATE INDEX idx_account_events_type ON account_events (event_type);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TABLE IF EXISTS account_events`);
}
