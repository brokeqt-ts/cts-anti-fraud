import type { Knex } from 'knex';

/**
 * Migration 016: Replace Phase 1 campaigns table with RPC-intercepted campaign data table.
 *
 * The original campaigns table (migration 004) was a planning schema with FK references
 * to accounts/domains and enum types. This migration replaces it with a table designed
 * to store raw campaign data intercepted from CampaignService/List RPC responses.
 */
export async function up(knex: Knex): Promise<void> {
  // Drop the old Phase 1 campaigns table (never populated from extension data)
  // CASCADE removes FK constraints from ban_logs and predictions that reference this table
  await knex.raw('DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns');
  await knex.raw('DROP TABLE IF EXISTS campaigns CASCADE');

  // Drop orphaned enum types that were only used by the old campaigns table
  await knex.raw('DROP TYPE IF EXISTS campaign_status');
  await knex.raw('DROP TYPE IF EXISTS campaign_type');
  await knex.raw('DROP TYPE IF EXISTS offer_vertical');

  await knex.schema.createTable('campaigns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('campaign_id').notNullable();
    table.string('campaign_name');
    table.integer('campaign_type');
    table.integer('status');
    table.bigInteger('budget_micros');
    table.string('currency', 10);
    table.jsonb('target_languages');
    table.jsonb('target_countries');
    table.string('start_date');
    table.string('end_date');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_campaigns_dedup
      ON campaigns (campaign_id, raw_payload_id)
  `);

  await knex.raw(`
    CREATE INDEX idx_campaigns_account ON campaigns (account_google_id);
    CREATE INDEX idx_campaigns_campaign_id ON campaigns (campaign_id);
  `);

  await knex.raw(`
    CREATE TRIGGER update_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_campaigns_updated_at ON campaigns');
  await knex.schema.dropTableIfExists('campaigns');
}
