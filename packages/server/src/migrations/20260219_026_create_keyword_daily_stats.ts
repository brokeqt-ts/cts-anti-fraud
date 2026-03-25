import type { Knex } from 'knex';

/**
 * Migration 026: Create keyword_daily_stats table for daily performance breakdowns.
 *
 * Stores per-day metric values from BatchService/Batch[AdGroupCriterionService.List].
 * When keyword_id is NULL, the row represents a campaign/account-level aggregate.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('keyword_daily_stats', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('keyword_id');           // NULL for campaign-level aggregates
    table.string('campaign_id');
    table.date('date').notNullable();
    table.string('metric_name').notNullable();  // 'stats.clicks', 'stats.impressions', etc.
    table.decimal('metric_value', 18, 6);
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  // Upsert key: same account + keyword + date + metric → update value
  await knex.raw(`
    CREATE UNIQUE INDEX idx_kds_dedup
      ON keyword_daily_stats (account_google_id, COALESCE(keyword_id, ''), date, metric_name)
  `);
  await knex.raw(`CREATE INDEX idx_kds_account_date ON keyword_daily_stats (account_google_id, date)`);
  await knex.raw(`CREATE INDEX idx_kds_campaign ON keyword_daily_stats (campaign_id)`);

  await knex.raw(`
    CREATE TRIGGER update_keyword_daily_stats_updated_at
    BEFORE UPDATE ON keyword_daily_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_keyword_daily_stats_updated_at ON keyword_daily_stats');
  await knex.schema.dropTableIfExists('keyword_daily_stats');
}
