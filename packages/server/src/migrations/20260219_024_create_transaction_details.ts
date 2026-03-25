import type { Knex } from 'knex';

/**
 * Migration 024: Create transaction_details table for TransactionsDetailsService/GetDetails.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('transaction_details', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('period'); // e.g. "2026-02"
    table.string('currency');
    table.jsonb('amounts'); // full amounts breakdown from the response
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`CREATE INDEX idx_txn_details_account ON transaction_details (account_google_id)`);
  await knex.raw(`CREATE UNIQUE INDEX idx_txn_details_dedup ON transaction_details (account_google_id, period, raw_payload_id)`);

  await knex.raw(`
    CREATE TRIGGER update_transaction_details_updated_at
    BEFORE UPDATE ON transaction_details
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_transaction_details_updated_at ON transaction_details');
  await knex.schema.dropTableIfExists('transaction_details');
}
