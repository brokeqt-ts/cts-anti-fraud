import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE proxy_type AS ENUM ('residential', 'mobile', 'datacenter', 'isp');
    CREATE TYPE proxy_rotation AS ENUM ('sticky', 'rotating');
    CREATE TYPE browser_type AS ENUM ('adspower', 'dolphin', 'octo', 'multilogin', 'gologin', 'other');
    CREATE TYPE payment_card_type AS ENUM ('debit', 'credit', 'prepaid', 'virtual');
  `);

  // Proxies
  await knex.schema.createTable('proxies', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.specificType('proxy_type', 'proxy_type').notNullable();
    table.string('provider');
    table.string('geo');
    table.specificType('rotation_type', 'proxy_rotation');
    table.string('ip_address');
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  // Antidetect profiles
  await knex.schema.createTable('antidetect_profiles', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.specificType('browser_type', 'browser_type').notNullable();
    table.string('profile_external_id');
    table.string('fingerprint_hash');
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  // Payment methods
  await knex.schema.createTable('payment_methods', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('bin', 6);
    table.specificType('card_type', 'payment_card_type');
    table.string('provider_bank');
    table.string('country', 2);
    table.decimal('spend_limit', 14, 2);
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  // Triggers
  await knex.raw(`
    CREATE TRIGGER update_proxies_updated_at
    BEFORE UPDATE ON proxies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_antidetect_profiles_updated_at
    BEFORE UPDATE ON antidetect_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    CREATE TRIGGER update_payment_methods_updated_at
    BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // Indexes
  await knex.raw(`
    CREATE INDEX idx_proxies_proxy_type ON proxies (proxy_type);
    CREATE INDEX idx_proxies_geo ON proxies (geo);
    CREATE INDEX idx_antidetect_profiles_browser_type ON antidetect_profiles (browser_type);
    CREATE INDEX idx_payment_methods_bin ON payment_methods (bin);
    CREATE INDEX idx_payment_methods_country ON payment_methods (country);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_payment_methods_updated_at ON payment_methods');
  await knex.raw('DROP TRIGGER IF EXISTS update_antidetect_profiles_updated_at ON antidetect_profiles');
  await knex.raw('DROP TRIGGER IF EXISTS update_proxies_updated_at ON proxies');
  await knex.schema.dropTableIfExists('payment_methods');
  await knex.schema.dropTableIfExists('antidetect_profiles');
  await knex.schema.dropTableIfExists('proxies');
  await knex.raw('DROP TYPE IF EXISTS payment_card_type');
  await knex.raw('DROP TYPE IF EXISTS browser_type');
  await knex.raw('DROP TYPE IF EXISTS proxy_rotation');
  await knex.raw('DROP TYPE IF EXISTS proxy_type');
}
