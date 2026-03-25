import type { Knex } from 'knex';

/**
 * Migration 017: Create billing_info table for intercepted BillingSummaryInfoService data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('billing_info', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('payment_method');
    table.text('payment_method_icon_url');
    table.string('balance_formatted');
    table.bigInteger('threshold_micros');
    table.jsonb('billing_cycle_end');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_billing_info_dedup
      ON billing_info (account_google_id, raw_payload_id)
  `);

  await knex.raw(`
    CREATE INDEX idx_billing_account ON billing_info (account_google_id);
  `);

  await knex.raw(`
    CREATE TRIGGER update_billing_info_updated_at
    BEFORE UPDATE ON billing_info
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_billing_info_updated_at ON billing_info');
  await knex.schema.dropTableIfExists('billing_info');
}
