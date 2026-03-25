import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  await knex.raw(`
    CREATE TYPE ssl_type AS ENUM ('lets_encrypt', 'paid', 'none', 'unknown');
    CREATE TYPE dns_provider AS ENUM ('cloudflare', 'direct', 'other');
  `);

  await knex.schema.createTable('domains', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('domain_name').notNullable().unique();
    table.string('registrar');
    table.integer('domain_age_days');
    table.boolean('whois_privacy');
    table.specificType('ssl_type', 'ssl_type');
    table.string('hosting_ip');
    table.string('asn');
    table.specificType('dns_provider', 'dns_provider');
    table.string('safe_page_type');
    table.decimal('content_quality_score', 5, 2);
    table.decimal('pagespeed_score', 5, 2);
    table.boolean('has_google_analytics');
    table.boolean('has_gtm');
    table.boolean('has_pixels');
    table.jsonb('raw_payload');
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ language 'plpgsql';
  `);

  await knex.raw(`
    CREATE TRIGGER update_domains_updated_at
    BEFORE UPDATE ON domains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_domains_updated_at ON domains');
  await knex.schema.dropTableIfExists('domains');
  await knex.raw('DROP TYPE IF EXISTS dns_provider');
  await knex.raw('DROP TYPE IF EXISTS ssl_type');
}
