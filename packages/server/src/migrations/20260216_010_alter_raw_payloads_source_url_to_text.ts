import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('raw_payloads', (table) => {
    table.text('source_url').alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('raw_payloads', (table) => {
    table.string('source_url', 255).alter();
  });
}
