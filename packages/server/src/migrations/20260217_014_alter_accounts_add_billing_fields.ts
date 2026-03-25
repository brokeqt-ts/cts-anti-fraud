import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.string('payer_name');
    table.string('payments_profile_id');
    table.string('currency', 3);
    table.jsonb('billing_address');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('billing_address');
    table.dropColumn('currency');
    table.dropColumn('payments_profile_id');
    table.dropColumn('payer_name');
  });
}
