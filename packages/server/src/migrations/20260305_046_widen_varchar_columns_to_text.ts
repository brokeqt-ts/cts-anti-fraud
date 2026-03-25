import type { Knex } from 'knex';

/**
 * Migration 046: Widen varchar(255) columns to TEXT for tables receiving
 * unbounded text from Google Ads RPC responses.
 *
 * Problem: Google Ads sends notification titles, campaign names, display URLs,
 * and other text fields that can exceed 255 characters, causing
 * "value too long for type character varying(255)" errors.
 *
 * PostgreSQL blocks ALTER TYPE on columns referenced by materialized views,
 * so we must drop dependent MVs first, alter columns, then recreate them.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Drop materialized views that depend on columns we're altering ─────
  // mv_account_risk_summary references: accounts.display_name, notification_details.category
  // mv_consumable_scores references: accounts.payment_bin (not altered, but depends on accounts)
  // Drop all 4 MVs to be safe — they're cheap to recreate
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_account_risk_summary CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_competitive_intelligence CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_consumable_scores CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_ban_timing_heatmap CASCADE');

  // ── 2. ALTER varchar(255) → TEXT ─────────────────────────────────────────

  // notification_details: the immediate problem
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN title TYPE text`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN notification_type TYPE text`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN label TYPE text`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN notification_id TYPE text`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN category TYPE text`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN priority TYPE text`);

  // campaigns: campaign names can be long
  await knex.raw(`ALTER TABLE campaigns ALTER COLUMN campaign_name TYPE text`);

  // ads: display URLs can exceed 255 chars
  await knex.raw(`ALTER TABLE ads ALTER COLUMN display_url TYPE text`);

  // ad_groups: ad group names from Google Ads
  await knex.raw(`ALTER TABLE ad_groups ALTER COLUMN ad_group_name TYPE text`);

  // accounts: various fields populated from Google Ads RPC
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN display_name TYPE text`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN email TYPE text`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN google_display_name TYPE text`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN payer_name TYPE text`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN timezone TYPE text`);

  // billing_info: payment method descriptions
  await knex.raw(`ALTER TABLE billing_info ALTER COLUMN payment_method TYPE text`);
  await knex.raw(`ALTER TABLE billing_info ALTER COLUMN balance_formatted TYPE text`);

  // ── 3. Recreate materialized views (copied from migration 038) ───────────

  // mv_ban_timing_heatmap
  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_ban_timing_heatmap AS
    SELECT
      EXTRACT(DOW FROM banned_at)::int AS day_of_week,
      EXTRACT(HOUR FROM banned_at)::int AS hour_of_day,
      COUNT(*)::int AS ban_count
    FROM ban_logs
    WHERE banned_at IS NOT NULL
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_ban_timing ON mv_ban_timing_heatmap (day_of_week, hour_of_day)
  `);

  // mv_consumable_scores
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
    GROUP BY ad_d.domain

    UNION ALL

    -- Proxy scoring
    SELECT
      'proxy'::text AS consumable_type,
      COALESCE(p.provider || ' / ' || p.geo, p.ip_address, p.id::text) AS consumable_value,
      COUNT(DISTINCT a.google_account_id)::int AS total_accounts,
      COUNT(DISTINCT bl.account_google_id)::int AS banned_accounts,
      ROUND(
        COUNT(DISTINCT bl.account_google_id)::numeric /
        NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
    FROM proxies p
    JOIN account_consumables ac ON ac.proxy_id = p.id AND ac.unlinked_at IS NULL
    JOIN accounts a ON a.id = ac.account_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
    GROUP BY p.id, p.provider, p.geo, p.ip_address
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_consumable ON mv_consumable_scores (consumable_type, consumable_value)
  `);

  // mv_competitive_intelligence
  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_competitive_intelligence AS
    SELECT
      account_google_id,
      competitor_domain,
      ROUND(AVG(overlap_rate)::numeric, 4) AS overlap_rate,
      ROUND(AVG(outranking_share)::numeric, 4) AS outranking_share,
      ROUND(AVG(impression_share)::numeric, 4) AS impression_share,
      ROUND(AVG(position_above_rate)::numeric, 4) AS avg_position,
      COUNT(*)::int AS sample_count
    FROM auction_insights
    WHERE competitor_domain != '__raw__'
    GROUP BY account_google_id, competitor_domain
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_competitive ON mv_competitive_intelligence (account_google_id, competitor_domain)
  `);

  // mv_account_risk_summary
  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_account_risk_summary AS
    SELECT
      a.google_account_id AS account_id,
      a.display_name,
      a.status,
      a.account_age_days,
      COALESCE(a.total_spend, 0) AS total_spend,
      (SELECT ROUND(SUM(kds.metric_value)::numeric / 1000000, 2)
       FROM keyword_daily_stats kds
       WHERE kds.account_google_id = a.google_account_id
         AND kds.metric_name = 'stats.cost'
         AND kds.date = CURRENT_DATE - 1) AS yesterday_spend,
      (SELECT COUNT(*)::int FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS ban_count,
      (SELECT MAX(bl.banned_at) FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS last_ban_at,
      (SELECT COUNT(*)::int FROM notification_details nd
       WHERE nd.account_google_id = a.google_account_id
         AND nd.category IN ('CRITICAL', 'WARNING')
         AND nd.captured_at > NOW() - INTERVAL '7 days') AS recent_violation_count,
      (SELECT COUNT(*)::int FROM campaigns c WHERE c.account_google_id = a.google_account_id AND c.status = 3) AS active_campaigns
    FROM accounts a
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_account_risk ON mv_account_risk_summary (account_id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // ── 1. Drop materialized views ───────────────────────────────────────────
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_account_risk_summary CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_competitive_intelligence CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_consumable_scores CASCADE');
  await knex.raw('DROP MATERIALIZED VIEW IF EXISTS mv_ban_timing_heatmap CASCADE');

  // ── 2. Revert to varchar(255) — may truncate existing data ───────────────
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN title TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN notification_type TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN label TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN notification_id TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN category TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE notification_details ALTER COLUMN priority TYPE varchar(255)`);

  await knex.raw(`ALTER TABLE campaigns ALTER COLUMN campaign_name TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE ads ALTER COLUMN display_url TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE ad_groups ALTER COLUMN ad_group_name TYPE varchar(255)`);

  await knex.raw(`ALTER TABLE accounts ALTER COLUMN display_name TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN email TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN google_display_name TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN payer_name TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE accounts ALTER COLUMN timezone TYPE varchar(255)`);

  await knex.raw(`ALTER TABLE billing_info ALTER COLUMN payment_method TYPE varchar(255)`);
  await knex.raw(`ALTER TABLE billing_info ALTER COLUMN balance_formatted TYPE varchar(255)`);

  // ── 3. Recreate materialized views with varchar(255) columns ─────────────
  // (same SQL — PostgreSQL will use the reverted column types)

  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_ban_timing_heatmap AS
    SELECT
      EXTRACT(DOW FROM banned_at)::int AS day_of_week,
      EXTRACT(HOUR FROM banned_at)::int AS hour_of_day,
      COUNT(*)::int AS ban_count
    FROM ban_logs
    WHERE banned_at IS NOT NULL
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_ban_timing ON mv_ban_timing_heatmap (day_of_week, hour_of_day)
  `);

  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_consumable_scores AS
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
    GROUP BY ad_d.domain

    UNION ALL

    SELECT
      'proxy'::text AS consumable_type,
      COALESCE(p.provider || ' / ' || p.geo, p.ip_address, p.id::text) AS consumable_value,
      COUNT(DISTINCT a.google_account_id)::int AS total_accounts,
      COUNT(DISTINCT bl.account_google_id)::int AS banned_accounts,
      ROUND(
        COUNT(DISTINCT bl.account_google_id)::numeric /
        NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
    FROM proxies p
    JOIN account_consumables ac ON ac.proxy_id = p.id AND ac.unlinked_at IS NULL
    JOIN accounts a ON a.id = ac.account_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
    GROUP BY p.id, p.provider, p.geo, p.ip_address
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_consumable ON mv_consumable_scores (consumable_type, consumable_value)
  `);

  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_competitive_intelligence AS
    SELECT
      account_google_id,
      competitor_domain,
      ROUND(AVG(overlap_rate)::numeric, 4) AS overlap_rate,
      ROUND(AVG(outranking_share)::numeric, 4) AS outranking_share,
      ROUND(AVG(impression_share)::numeric, 4) AS impression_share,
      ROUND(AVG(position_above_rate)::numeric, 4) AS avg_position,
      COUNT(*)::int AS sample_count
    FROM auction_insights
    WHERE competitor_domain != '__raw__'
    GROUP BY account_google_id, competitor_domain
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_competitive ON mv_competitive_intelligence (account_google_id, competitor_domain)
  `);

  await knex.raw(`
    CREATE MATERIALIZED VIEW mv_account_risk_summary AS
    SELECT
      a.google_account_id AS account_id,
      a.display_name,
      a.status,
      a.account_age_days,
      COALESCE(a.total_spend, 0) AS total_spend,
      (SELECT ROUND(SUM(kds.metric_value)::numeric / 1000000, 2)
       FROM keyword_daily_stats kds
       WHERE kds.account_google_id = a.google_account_id
         AND kds.metric_name = 'stats.cost'
         AND kds.date = CURRENT_DATE - 1) AS yesterday_spend,
      (SELECT COUNT(*)::int FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS ban_count,
      (SELECT MAX(bl.banned_at) FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS last_ban_at,
      (SELECT COUNT(*)::int FROM notification_details nd
       WHERE nd.account_google_id = a.google_account_id
         AND nd.category IN ('CRITICAL', 'WARNING')
         AND nd.captured_at > NOW() - INTERVAL '7 days') AS recent_violation_count,
      (SELECT COUNT(*)::int FROM campaigns c WHERE c.account_google_id = a.google_account_id AND c.status = 3) AS active_campaigns
    FROM accounts a
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_mv_account_risk ON mv_account_risk_summary (account_id)
  `);
}
