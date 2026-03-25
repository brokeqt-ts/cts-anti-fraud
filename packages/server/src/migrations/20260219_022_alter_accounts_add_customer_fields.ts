import type { Knex } from 'knex';

/**
 * Migration 022: Add customer metadata columns to accounts table.
 * For CustomerService/List, MultiLoginUserService, CustomerBillingService, etc.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.string('conversion_tracking_id');
    table.string('timezone');
    table.jsonb('languages');
    table.string('gtag_id');
    table.string('email');
    table.string('google_display_name');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('google_display_name');
    table.dropColumn('email');
    table.dropColumn('gtag_id');
    table.dropColumn('languages');
    table.dropColumn('timezone');
    table.dropColumn('conversion_tracking_id');
  });
}
