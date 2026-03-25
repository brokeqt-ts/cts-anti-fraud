import type { Knex } from 'knex';

/**
 * Migration 040: Create _meta key-value table.
 *
 * Previously created at runtime in collect.service.ts via
 * CREATE TABLE IF NOT EXISTS. Now properly managed as a migration.
 *
 * Uses hasTable check because production DBs may already have this table
 * from the pre-migration runtime creation.
 *
 * Used for lightweight metadata storage (e.g., last_data_received timestamp).
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('_meta');
  if (!exists) {
    await knex.schema.createTable('_meta', (table) => {
      table.text('key').primary();
      table.text('value');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('_meta');
}
