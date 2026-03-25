import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE offer_vertical AS ENUM ('gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecommerce', 'finance', 'other');
    CREATE TYPE campaign_type AS ENUM ('pmax', 'search', 'demand_gen', 'uac', 'display', 'shopping', 'video');
    CREATE TYPE campaign_status AS ENUM ('active', 'paused', 'removed', 'pending', 'disapproved');
  `);

  await knex.schema.createTable('campaigns', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.uuid('domain_id').references('id').inTable('domains').onDelete('SET NULL');
    table.uuid('cts_site_id').references('id').inTable('cts_sites').onDelete('SET NULL');
    table.string('google_campaign_id').notNullable();
    table.string('campaign_name');
    table.specificType('offer_vertical', 'offer_vertical').notNullable().defaultTo('other');
    table.specificType('campaign_type', 'campaign_type').notNullable();
    table.specificType('status', 'campaign_status').notNullable().defaultTo('active');
    table.jsonb('ad_texts');
    table.jsonb('keywords');
    table.jsonb('target_geos');
    table.decimal('daily_budget', 14, 2);
    table.decimal('total_budget', 14, 2);
    table.string('bidding_strategy');
    table.jsonb('targeting_settings');
    table.text('landing_page_url');
    table.bigInteger('impressions').notNullable().defaultTo(0);
    table.bigInteger('clicks').notNullable().defaultTo(0);
    table.decimal('ctr', 8, 4).notNullable().defaultTo(0);
    table.decimal('cpc', 14, 2).notNullable().defaultTo(0);
    table.integer('conversions').notNullable().defaultTo(0);
    table.decimal('cost', 14, 2).notNullable().defaultTo(0);
    table.integer('time_alive_hours');
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_campaigns_account_id ON campaigns (account_id);
    CREATE INDEX idx_campaigns_domain_id ON campaigns (domain_id);
    CREATE INDEX idx_campaigns_offer_vertical ON campaigns (offer_vertical);
    CREATE INDEX idx_campaigns_campaign_type ON campaigns (campaign_type);
    CREATE INDEX idx_campaigns_status ON campaigns (status);
    CREATE INDEX idx_campaigns_google_campaign_id ON campaigns (google_campaign_id);
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
  await knex.raw('DROP TYPE IF EXISTS campaign_status');
  await knex.raw('DROP TYPE IF EXISTS campaign_type');
  await knex.raw('DROP TYPE IF EXISTS offer_vertical');
}
