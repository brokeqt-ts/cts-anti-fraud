import type { Knex } from 'knex';

/**
 * Migration 034: Add raw_data JSONB column to auction_insights.
 *
 * Stores the full RPC body when the exact payload structure is not yet known,
 * allowing re-parsing later once the format is reverse-engineered.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('auction_insights', (table) => {
    table.jsonb('raw_data');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('auction_insights', (table) => {
    table.dropColumn('raw_data');
  });
}
