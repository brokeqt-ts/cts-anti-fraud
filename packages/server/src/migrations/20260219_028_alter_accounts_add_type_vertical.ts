import type { Knex } from 'knex';

/**
 * Migration 028: Add account_type and offer_vertical columns to accounts table.
 *
 * account_type: farm, bought, agency, unknown
 * offer_vertical: gambling, nutra, crypto, dating, sweepstakes, ecom, finance, other
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.string('account_type');
    table.string('offer_vertical');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('account_type');
    table.dropColumn('offer_vertical');
  });
}
