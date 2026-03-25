import type { Knex } from 'knex';

/**
 * Migration 027: Add bidding strategy columns to campaigns table.
 *
 * CampaignService/List field "32" contains bidding strategy config:
 *   "32"."1" = strategy type enum (2=MANUAL_CPC, 10=MAX_CONVERSIONS, 13=TARGET_ROAS, etc.)
 *   "32" (full object) = detailed config (target values, etc.)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaigns', (table) => {
    table.integer('bidding_strategy_type');
    table.jsonb('bidding_strategy_config');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('campaigns', (table) => {
    table.dropColumn('bidding_strategy_type');
    table.dropColumn('bidding_strategy_config');
  });
}
