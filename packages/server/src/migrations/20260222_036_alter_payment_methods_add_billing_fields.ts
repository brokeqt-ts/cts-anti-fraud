import type { Knex } from 'knex';

/**
 * Migration 036: Extend payment_methods table with fields extracted from
 * Google Payments batchexecute POST bodies (card details, address, token).
 *
 * Existing columns (from migration 006):
 *   id, bin, card_type, provider_bank, country, spend_limit, raw_payload,
 *   created_at, updated_at
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payment_methods', (table) => {
    table.string('bin8', 8);
    table.string('last4', 4);
    table.string('card_network', 20);
    table.integer('card_type_code');
    table.string('pan_hash', 64);
    table.smallint('expiry_month');
    table.smallint('expiry_year');
    table.string('cardholder_name', 255);
    table.string('billing_street', 255);
    table.string('billing_postal_code', 20);
    table.string('billing_city', 100);
    table.string('locale', 10);
    table.string('instrument_display', 100);
    table.string('payment_token', 255);
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('extracted_at');
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_payment_methods_bin_last4
      ON payment_methods (bin, last4)
      WHERE bin IS NOT NULL AND last4 IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX idx_payment_methods_pan_hash ON payment_methods (pan_hash)
      WHERE pan_hash IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_payment_methods_pan_hash');
  await knex.raw('DROP INDEX IF EXISTS idx_payment_methods_bin_last4');

  await knex.schema.alterTable('payment_methods', (table) => {
    table.dropColumn('bin8');
    table.dropColumn('last4');
    table.dropColumn('card_network');
    table.dropColumn('card_type_code');
    table.dropColumn('pan_hash');
    table.dropColumn('expiry_month');
    table.dropColumn('expiry_year');
    table.dropColumn('cardholder_name');
    table.dropColumn('billing_street');
    table.dropColumn('billing_postal_code');
    table.dropColumn('billing_city');
    table.dropColumn('locale');
    table.dropColumn('instrument_display');
    table.dropColumn('payment_token');
    table.dropColumn('raw_payload_id');
    table.dropColumn('extracted_at');
  });
}
