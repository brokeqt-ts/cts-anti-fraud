import type { Knex } from 'knex';

/**
 * Migration 041: Add account_type_source to accounts table.
 * Tracks whether account_type was set automatically or manually.
 *
 * Idempotent: checks each column before adding.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('accounts', 'account_type_source'))) {
    await knex.schema.alterTable('accounts', (table) => {
      table.string('account_type_source').defaultTo('auto');
    });
  }
  if (!(await knex.schema.hasColumn('accounts', 'account_type_signals'))) {
    await knex.schema.alterTable('accounts', (table) => {
      table.jsonb('account_type_signals');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE accounts
      DROP COLUMN IF EXISTS account_type_source,
      DROP COLUMN IF EXISTS account_type_signals;
  `);
}
