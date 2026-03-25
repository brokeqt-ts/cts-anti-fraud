import type { Knex } from 'knex';

/**
 * Migration 045: Add provider fields for manual profile config.
 *
 * - proxies.provider: proxy provider name from extension popup
 * - payment_methods.service_provider: payment service name from extension popup
 *
 * Idempotent: checks each column before adding.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('proxies', 'provider'))) {
    await knex.schema.alterTable('proxies', (table) => {
      table.text('provider').nullable();
    });
  }
  if (!(await knex.schema.hasColumn('payment_methods', 'service_provider'))) {
    await knex.schema.alterTable('payment_methods', (table) => {
      table.text('service_provider').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE proxies DROP COLUMN IF EXISTS provider;
    ALTER TABLE payment_methods DROP COLUMN IF EXISTS service_provider;
  `);
}
