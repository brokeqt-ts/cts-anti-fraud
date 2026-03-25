import type { Knex } from 'knex';

/**
 * Migration 025: Create keywords table for AdGroupCriterionService.List data
 * from BatchService/Batch payloads.
 *
 * Stores keyword text, match type, quality score, and latest performance snapshot.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('keywords', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('campaign_id').notNullable();
    table.string('ad_group_id').notNullable();
    table.string('keyword_id').notNullable();
    table.text('keyword_text').notNullable();
    table.integer('match_type');
    table.boolean('is_negative').defaultTo(false);
    table.integer('status');
    table.bigInteger('max_cpc_micros');
    table.jsonb('final_urls');
    table.string('currency', 10);

    // Quality Score fields
    table.integer('quality_score');         // field "105" — 1-10
    table.integer('qs_expected_ctr');       // field "28"
    table.integer('qs_ad_relevance');       // field "29"
    table.integer('qs_landing_page');       // field "30"

    // Performance metrics (latest snapshot)
    table.bigInteger('impressions').defaultTo(0);
    table.bigInteger('clicks').defaultTo(0);
    table.bigInteger('cost_micros').defaultTo(0);
    table.decimal('ctr', 10, 6);
    table.bigInteger('avg_cpc_micros');
    table.decimal('conversions', 12, 2).defaultTo(0);
    table.decimal('conversion_rate', 10, 6);
    table.bigInteger('cost_per_conversion_micros');

    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`CREATE UNIQUE INDEX idx_keywords_dedup ON keywords (account_google_id, keyword_id)`);
  await knex.raw(`CREATE INDEX idx_keywords_account ON keywords (account_google_id)`);
  await knex.raw(`CREATE INDEX idx_keywords_campaign ON keywords (campaign_id)`);
  await knex.raw(`CREATE INDEX idx_keywords_adgroup ON keywords (ad_group_id)`);

  await knex.raw(`
    CREATE TRIGGER update_keywords_updated_at
    BEFORE UPDATE ON keywords
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_keywords_updated_at ON keywords');
  await knex.schema.dropTableIfExists('keywords');
}
