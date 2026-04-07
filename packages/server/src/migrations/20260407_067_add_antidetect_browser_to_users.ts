import type { Knex } from 'knex';

/**
 * Migration 067: Add antidetect_browser column to users table.
 * Stores the user's selected antidetect browser for automatic profile detection.
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'antidetect_browser');
  if (!hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.text('antidetect_browser').nullable().defaultTo(null);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'antidetect_browser');
  if (hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('antidetect_browser');
    });
  }
}
