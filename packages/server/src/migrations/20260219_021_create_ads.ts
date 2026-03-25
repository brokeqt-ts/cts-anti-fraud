import type { Knex } from 'knex';

/**
 * Migration 021: Create ads table for BatchService/Batch ad data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ads', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('campaign_id');
    table.string('ad_group_id');
    table.string('ad_id');
    table.jsonb('headlines'); // array of headline strings
    table.jsonb('descriptions'); // array of description strings
    table.jsonb('final_urls'); // array of landing page URLs
    table.string('display_url');
    table.string('ad_type'); // responsive_search, etc
    table.string('review_status');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`CREATE INDEX idx_ads_account ON ads (account_google_id)`);
  await knex.raw(`CREATE UNIQUE INDEX idx_ads_dedup ON ads (ad_id, raw_payload_id)`);

  await knex.raw(`
    CREATE TRIGGER update_ads_updated_at
    BEFORE UPDATE ON ads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_ads_updated_at ON ads');
  await knex.schema.dropTableIfExists('ads');
}
