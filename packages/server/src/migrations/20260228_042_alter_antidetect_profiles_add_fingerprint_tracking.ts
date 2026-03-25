import type { Knex } from 'knex';

/**
 * Migration 042: Add fingerprint tracking columns to antidetect_profiles.
 *
 * Idempotent: checks each column before adding.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('antidetect_profiles', 'fingerprint_last_changed_at'))) {
    await knex.schema.alterTable('antidetect_profiles', (table) => {
      table.timestamp('fingerprint_last_changed_at');
    });
  }
  if (!(await knex.schema.hasColumn('antidetect_profiles', 'fingerprint_change_count'))) {
    await knex.schema.alterTable('antidetect_profiles', (table) => {
      table.integer('fingerprint_change_count').defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE antidetect_profiles
      DROP COLUMN IF EXISTS fingerprint_last_changed_at,
      DROP COLUMN IF EXISTS fingerprint_change_count;
  `);
}
