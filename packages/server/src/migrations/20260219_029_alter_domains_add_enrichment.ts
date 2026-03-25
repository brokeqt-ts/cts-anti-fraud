import type { Knex } from 'knex';

/**
 * Migration 029: Add enrichment columns to domains table.
 *
 * Existing columns: domain_name, registrar, domain_age_days, whois_privacy,
 *   ssl_type, hosting_ip, asn, dns_provider, safe_page_type, content_quality_score,
 *   pagespeed_score, has_google_analytics, has_gtm, has_pixels
 *
 * New columns for full domain intelligence.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('domains', (table) => {
    table.date('created_date');
    table.date('expires_date');
    table.text('ssl_issuer');
    table.date('ssl_expires');
    table.text('hosting_provider');
    table.text('hosting_country');
    table.jsonb('nameservers');
    table.boolean('has_cloudflare');
    table.boolean('has_facebook_pixel');
    table.text('meta_title');
    table.text('meta_description');
    table.integer('page_word_count');
    table.boolean('has_privacy_page');
    table.boolean('has_terms_page');
    table.boolean('has_contact_page');
    table.boolean('has_blog');
    table.integer('safe_page_quality_score');
    table.integer('http_status');
    table.text('site_status');          // 'live', 'redirect', 'blocked', 'parked', 'down'
    table.timestamp('last_checked_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('domains', (table) => {
    table.dropColumn('created_date');
    table.dropColumn('expires_date');
    table.dropColumn('ssl_issuer');
    table.dropColumn('ssl_expires');
    table.dropColumn('hosting_provider');
    table.dropColumn('hosting_country');
    table.dropColumn('nameservers');
    table.dropColumn('has_cloudflare');
    table.dropColumn('has_facebook_pixel');
    table.dropColumn('meta_title');
    table.dropColumn('meta_description');
    table.dropColumn('page_word_count');
    table.dropColumn('has_privacy_page');
    table.dropColumn('has_terms_page');
    table.dropColumn('has_contact_page');
    table.dropColumn('has_blog');
    table.dropColumn('safe_page_quality_score');
    table.dropColumn('http_status');
    table.dropColumn('site_status');
    table.dropColumn('last_checked_at');
  });
}
