import type { Knex } from 'knex';

/**
 * Migration 031: Add post-mortem columns to ban_logs.
 *
 * Stores auto-generated post-mortem analysis for each ban:
 * - post_mortem JSONB: structured analysis data (factors, metrics, snapshot)
 * - post_mortem_generated_at: when the post-mortem was generated
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ban_logs', (table) => {
    table.jsonb('post_mortem');
    table.timestamp('post_mortem_generated_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('ban_logs', (table) => {
    table.dropColumn('post_mortem');
    table.dropColumn('post_mortem_generated_at');
  });
}
