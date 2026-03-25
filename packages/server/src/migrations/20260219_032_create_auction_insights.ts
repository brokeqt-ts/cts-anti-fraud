import type { Knex } from 'knex';

/**
 * Migration 032: Create auction_insights table (placeholder).
 *
 * Will store competitive intelligence from Google Ads Auction Insights.
 * Data source not yet intercepted — awaiting RPC payload discovery.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('auction_insights', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('account_google_id').notNullable();
    table.text('campaign_id');
    table.text('competitor_domain').notNullable();
    table.decimal('impression_share', 5, 2);
    table.decimal('overlap_rate', 5, 2);
    table.decimal('position_above_rate', 5, 2);
    table.decimal('top_of_page_rate', 5, 2);
    table.decimal('outranking_share', 5, 2);
    table.date('date_range_start');
    table.date('date_range_end');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_auction_insights_dedup
    ON auction_insights (account_google_id, COALESCE(campaign_id, ''), competitor_domain, COALESCE(date_range_start, '1970-01-01'))
  `);
  await knex.raw(`CREATE INDEX idx_auction_insights_account ON auction_insights (account_google_id)`);
  await knex.raw(`CREATE INDEX idx_auction_insights_competitor ON auction_insights (competitor_domain)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('auction_insights');
}
