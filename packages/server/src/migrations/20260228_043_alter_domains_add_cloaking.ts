import type { Knex } from 'knex';

/**
 * Migration 043: Add cloaking detection columns to domains table.
 *
 * Idempotent: checks each column before adding. The safe_page_type column
 * may already exist in production from domain-enrichment service.
 */
export async function up(knex: Knex): Promise<void> {
  const columns: Array<{ name: string; add: (table: Knex.AlterTableBuilder) => void }> = [
    { name: 'cloaking_detected', add: (t) => t.boolean('cloaking_detected') },
    { name: 'cloaking_type', add: (t) => t.string('cloaking_type') },
    { name: 'cloaking_signals', add: (t) => t.jsonb('cloaking_signals') },
    { name: 'cloaking_checked_at', add: (t) => t.timestamp('cloaking_checked_at') },
    { name: 'safe_page_type', add: (t) => t.string('safe_page_type') },
  ];

  for (const col of columns) {
    if (!(await knex.schema.hasColumn('domains', col.name))) {
      await knex.schema.alterTable('domains', col.add);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE domains
      DROP COLUMN IF EXISTS cloaking_detected,
      DROP COLUMN IF EXISTS cloaking_type,
      DROP COLUMN IF EXISTS cloaking_signals,
      DROP COLUMN IF EXISTS cloaking_checked_at,
      DROP COLUMN IF EXISTS safe_page_type;
  `);
}
