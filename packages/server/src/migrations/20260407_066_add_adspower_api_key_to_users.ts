import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('users', 'adspower_api_key');
  if (has) return;
  await knex.schema.alterTable('users', (table) => {
    table.text('adspower_api_key').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('adspower_api_key');
  });
}
