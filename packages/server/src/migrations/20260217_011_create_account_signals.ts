import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account_signals', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('signal_name').notNullable();
    table.jsonb('signal_value').notNullable();
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_account_signals_dedup
      ON account_signals (raw_payload_id, signal_name)
      WHERE raw_payload_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX idx_account_signals_account ON account_signals (account_google_id);
    CREATE INDEX idx_account_signals_name ON account_signals (signal_name);
    CREATE INDEX idx_account_signals_captured ON account_signals (captured_at);
  `);

  await knex.raw(`
    CREATE TRIGGER update_account_signals_updated_at
    BEFORE UPDATE ON account_signals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_account_signals_updated_at ON account_signals');
  await knex.schema.dropTableIfExists('account_signals');
}
