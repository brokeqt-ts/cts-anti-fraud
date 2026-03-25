import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('risk_verdicts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.jsonb('verdict_data').notNullable();
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_risk_verdicts_dedup
      ON risk_verdicts (raw_payload_id)
      WHERE raw_payload_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX idx_risk_verdicts_account ON risk_verdicts (account_google_id);
    CREATE INDEX idx_risk_verdicts_captured ON risk_verdicts (captured_at);
  `);

  await knex.raw(`
    CREATE TRIGGER update_risk_verdicts_updated_at
    BEFORE UPDATE ON risk_verdicts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_risk_verdicts_updated_at ON risk_verdicts');
  await knex.schema.dropTableIfExists('risk_verdicts');
}
