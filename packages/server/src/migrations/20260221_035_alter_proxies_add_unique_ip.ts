import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add UNIQUE partial index on ip_address for upsert support
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_proxies_ip_address_unique
    ON proxies (ip_address)
    WHERE ip_address IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_proxies_ip_address_unique');
}
