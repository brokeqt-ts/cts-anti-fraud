import type { Knex } from 'knex';

/**
 * Migration 039: Add unique index on cts_sites.domain for upsert support.
 *
 * Required by CTSService.syncSitesFromCTS() which uses ON CONFLICT (domain).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cts_sites_domain_unique ON cts_sites (domain)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_cts_sites_domain_unique`);
}
