import type { Knex } from 'knex';

/**
 * Migration 056: Fix mv_consumable_scores duplicate row issue.
 *
 * Root cause: proxy section grouped by p.id but used COALESCE(provider/geo, ip_address, id)
 * as consumable_value. Two proxies with the same ip_address (but different ids) would produce
 * duplicate (consumable_type, consumable_value) pairs, breaking REFRESH on the unique index.
 *
 * Fix: group proxy section by the computed label itself, not by p.id.
 * Also filter out NULL consumable_value rows in all sections to be safe.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_consumable_scores CASCADE');

  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_consumable_scores AS

    -- BIN scoring
    SELECT
      'bin'::text AS consumable_type,
      a.payment_bin AS consumable_value,
      COUNT(DISTINCT a.google_account_id)::int AS total_accounts,
      COUNT(DISTINCT bl.account_google_id)::int AS banned_accounts,
      ROUND(
        COUNT(DISTINCT bl.account_google_id)::numeric /
        NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
    FROM accounts a
    LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
    WHERE a.payment_bin IS NOT NULL AND a.payment_bin != ''
    GROUP BY a.payment_bin

    UNION ALL

    -- Domain scoring (via ads.final_urls)
    SELECT
      'domain'::text AS consumable_type,
      ad_d.domain AS consumable_value,
      COUNT(DISTINCT ad_d.account_google_id)::int AS total_accounts,
      COUNT(DISTINCT bl.account_google_id)::int AS banned_accounts,
      ROUND(
        COUNT(DISTINCT bl.account_google_id)::numeric /
        NULLIF(COUNT(DISTINCT ad_d.account_google_id), 0) * 100, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
    FROM (
      SELECT DISTINCT
        a.account_google_id,
        regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
      FROM ads a,
      LATERAL (SELECT jsonb_array_elements_text(a.final_urls) AS url
               WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array') u
    ) ad_d
    LEFT JOIN ban_logs bl ON bl.account_google_id = ad_d.account_google_id
    WHERE ad_d.domain IS NOT NULL AND ad_d.domain != ''
    GROUP BY ad_d.domain

    UNION ALL

    -- Proxy scoring — group by computed label to avoid duplicates from proxies
    -- with the same ip_address but different ids
    SELECT
      'proxy'::text AS consumable_type,
      proxy_label AS consumable_value,
      COUNT(DISTINCT a.google_account_id)::int AS total_accounts,
      COUNT(DISTINCT bl.account_google_id)::int AS banned_accounts,
      ROUND(
        COUNT(DISTINCT bl.account_google_id)::numeric /
        NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
    FROM (
      SELECT
        p.id,
        a.google_account_id,
        COALESCE(
          NULLIF(TRIM(COALESCE(p.provider, '') || ' / ' || COALESCE(p.geo, '')), ' / '),
          p.ip_address,
          p.id::text
        ) AS proxy_label
      FROM proxies p
      JOIN account_consumables ac ON ac.proxy_id = p.id AND ac.unlinked_at IS NULL
      JOIN accounts a ON a.id = ac.account_id
    ) px
    LEFT JOIN ban_logs bl ON bl.account_google_id = px.google_account_id
    WHERE px.proxy_label IS NOT NULL
    GROUP BY px.proxy_label
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_consumable ON mv_consumable_scores (consumable_type, consumable_value)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_consumable_scores CASCADE');
}
