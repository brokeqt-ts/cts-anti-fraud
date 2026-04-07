import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasKey = await knex.schema.hasColumn('users', 'adspower_api_key');
  if (!hasKey) {
    await knex.schema.alterTable('users', (table) => {
      table.text('adspower_api_key').nullable();
    });
  }
  const hasUrl = await knex.schema.hasColumn('users', 'adspower_api_url');
  if (!hasUrl) {
    await knex.schema.alterTable('users', (table) => {
      table.text('adspower_api_url').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('adspower_api_key');
    table.dropColumn('adspower_api_url');
  });
}
