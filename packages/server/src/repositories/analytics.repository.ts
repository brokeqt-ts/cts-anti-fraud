import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface BanTimingRow {
  day_of_week: number;
  hour: number;
  ban_count: number;
}

export interface LifetimeStats {
  avg_lifetime_hours: number;
  min_lifetime_hours: number;
  max_lifetime_hours: number;
  total_bans: number;
}

export interface VerticalStats {
  vertical: string;
  avg_lifetime_hours: number;
  avg_spend: number;
  ban_count: number;
}

export interface BanRateStats {
  total_accounts: number;
  banned_accounts: number;
  active_accounts: number;
  suspended_accounts: number;
}

export interface SpendStats {
  avg_lifetime_spend: number;
  total_lifetime_spend: number;
  bans_with_spend: number;
}

export interface AccountAgeRow {
  account_age_days: number;
}

export interface DailySpendRow {
  date: string;
  spend: number;
}

export interface VelocityAccountRow {
  account_google_id: string;
  latest_spend: number;
  prev_spend: number | null;
  latest_date: string;
  change_pct: number | null;
  display_name: string | null;
  account_age_days: number;
  status: string | null;
  currency: string | null;
}

export interface ConnectionRow {
  account_google_id: string;
  display_name: string | null;
  link_value: string;
  banned_at: string | null;
}

export interface SharedDomainRow {
  domain: string;
  accounts: string[];
  account_count: number;
  banned_count: number;
}

export interface BinScoringRow {
  bin: string;
  total: number;
  banned: number;
  ban_rate: number;
  avg_lifetime_hours: number;
}

export interface DomainScoringRow {
  domain: string;
  total: number;
  banned: number;
  ban_rate: number;
  avg_lifetime_hours: number;
  safe_page_quality_score: number | null;
}

export interface ProxyScoringRow {
  proxy: string;
  total: number;
  banned: number;
  ban_rate: number;
  avg_lifetime_hours: number;
}

export interface CampaignDailyMetricsRow {
  campaign_id: string;
  campaign_name: string;
  account_google_id: string;
  date: string;
  ctr: number | null;
  cpc: number | null;
  clicks: number | null;
  impressions: number | null;
}

export interface CompetitorRow {
  domain: string;
  accounts_seen_in: number;
  avg_impression_share: number;
  avg_overlap_rate: number;
  avg_position_above_rate: number;
  first_seen: string;
  last_seen: string;
  longevity_days: number;
}

export interface AccountCompetitorRow {
  domain: string;
  avg_impression_share: number;
  avg_overlap_rate: number;
  avg_position_above_rate: number;
  avg_top_of_page_rate: number;
  avg_outranking_share: number;
  data_points: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns a SQL subquery clause filtering ban_logs or other tables by user's accounts. */
function userAccountFilter(userId: string | undefined, paramIdx: number, alias = 'account_google_id'): { clause: string; params: unknown[] } {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: `AND ${alias} IN (SELECT google_account_id FROM accounts WHERE user_id = $${paramIdx})`,
    params: [userId],
  };
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * Get ban timing heatmap. Uses materialized view when available (admin only),
 * falls back to direct query if MV doesn't exist yet or for user-scoped data.
 */
export async function getBanTimingHeatmap(pool: pg.Pool, useMV: boolean = true, userId?: string): Promise<BanTimingRow[]> {
  if (useMV && !userId) {
    try {
      const result = await pool.query(`
        SELECT day_of_week, hour_of_day AS hour, ban_count
        FROM mv_ban_timing_heatmap
        ORDER BY day_of_week, hour
      `);
      return result.rows.map(r => ({
        day_of_week: r['day_of_week'] as number,
        hour: r['hour'] as number,
        ban_count: r['ban_count'] as number,
      }));
    } catch {
      // MV doesn't exist yet — fall through to direct query
    }
  }

  const uf = userAccountFilter(userId, 1);
  const result = await pool.query(`
    SELECT
      EXTRACT(DOW FROM banned_at)::int AS day_of_week,
      EXTRACT(HOUR FROM banned_at)::int AS hour,
      COUNT(*)::int AS ban_count
    FROM ban_logs
    WHERE banned_at IS NOT NULL ${uf.clause}
    GROUP BY day_of_week, hour
    ORDER BY day_of_week, hour
  `, uf.params);
  return result.rows.map(r => ({
    day_of_week: r['day_of_week'] as number,
    hour: r['hour'] as number,
    ban_count: r['ban_count'] as number,
  }));
}

export async function getOverviewStats(pool: pg.Pool, userId?: string): Promise<{
  lifetime: LifetimeStats;
  verticals: VerticalStats[];
  banRate: BanRateStats;
  spend: SpendStats;
}> {
  const uf = userAccountFilter(userId, 1);
  const userAccountsWhere = userId
    ? `WHERE user_id = $1`
    : '';
  const accountsParams = userId ? [userId] : [];

  const [lifetimeResult, verticalResult, banRateResult, spendResult] = await Promise.all([
    pool.query(`
      SELECT
        ROUND(AVG(lifetime_hours)::numeric, 1) AS avg_lifetime_hours,
        MIN(lifetime_hours) AS min_lifetime_hours,
        MAX(lifetime_hours) AS max_lifetime_hours,
        COUNT(*)::int AS total_bans
      FROM ban_logs
      WHERE lifetime_hours IS NOT NULL ${uf.clause}
    `, uf.params),
    pool.query(`
      SELECT
        COALESCE(bl.offer_vertical, a.offer_vertical, 'unknown') AS vertical,
        ROUND(AVG(bl.lifetime_hours)::numeric, 1) AS avg_lifetime_hours,
        ROUND(AVG(bl.lifetime_spend)::numeric, 2) AS avg_spend,
        COUNT(*)::int AS ban_count
      FROM ban_logs bl
      LEFT JOIN accounts a ON a.google_account_id = bl.account_google_id
      WHERE 1=1 ${uf.clause}
      GROUP BY vertical
      ORDER BY ban_count DESC
    `, uf.params),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM accounts ${userAccountsWhere}) AS total_accounts,
        (SELECT COUNT(DISTINCT account_google_id)::int FROM ban_logs WHERE 1=1 ${uf.clause}) AS banned_accounts,
        (SELECT COUNT(*)::int FROM accounts WHERE status = 'active' ${userId ? `AND user_id = $1` : ''}) AS active_accounts,
        (SELECT COUNT(*)::int FROM accounts WHERE status = 'suspended' ${userId ? `AND user_id = $1` : ''}) AS suspended_accounts
    `, accountsParams),
    pool.query(`
      SELECT
        ROUND(AVG(lifetime_spend)::numeric, 2) AS avg_lifetime_spend,
        ROUND(SUM(lifetime_spend)::numeric, 2) AS total_lifetime_spend,
        COUNT(*)::int AS bans_with_spend
      FROM ban_logs
      WHERE lifetime_spend IS NOT NULL AND lifetime_spend > 0 ${uf.clause}
    `, uf.params),
  ]);

  const lt = lifetimeResult.rows[0] ?? {};
  const br = banRateResult.rows[0] ?? {};
  const sp = spendResult.rows[0] ?? {};

  return {
    lifetime: {
      avg_lifetime_hours: Number(lt['avg_lifetime_hours'] ?? 0),
      min_lifetime_hours: Number(lt['min_lifetime_hours'] ?? 0),
      max_lifetime_hours: Number(lt['max_lifetime_hours'] ?? 0),
      total_bans: Number(lt['total_bans'] ?? 0),
    },
    verticals: verticalResult.rows.map(r => ({
      vertical: r['vertical'] as string,
      avg_lifetime_hours: Number(r['avg_lifetime_hours'] ?? 0),
      avg_spend: Number(r['avg_spend'] ?? 0),
      ban_count: Number(r['ban_count'] ?? 0),
    })),
    banRate: {
      total_accounts: Number(br['total_accounts'] ?? 0),
      banned_accounts: Number(br['banned_accounts'] ?? 0),
      active_accounts: Number(br['active_accounts'] ?? 0),
      suspended_accounts: Number(br['suspended_accounts'] ?? 0),
    },
    spend: {
      avg_lifetime_spend: Number(sp['avg_lifetime_spend'] ?? 0),
      total_lifetime_spend: Number(sp['total_lifetime_spend'] ?? 0),
      bans_with_spend: Number(sp['bans_with_spend'] ?? 0),
    },
  };
}

export async function getAccountAge(pool: pg.Pool, accountGoogleId: string): Promise<number> {
  const result = await pool.query(
    `SELECT account_age_days FROM accounts WHERE google_account_id = $1`,
    [accountGoogleId],
  );
  return Number(result.rows[0]?.['account_age_days'] ?? 0);
}

export async function getDailySpend(pool: pg.Pool, accountGoogleId: string): Promise<DailySpendRow[]> {
  const result = await pool.query(
    `SELECT date, ROUND(SUM(metric_value)::numeric / 1000000, 2) AS spend
     FROM keyword_daily_stats
     WHERE account_google_id = $1
       AND metric_name = 'stats.cost'
       AND date >= CURRENT_DATE - INTERVAL '30 days'
     GROUP BY date
     ORDER BY date`,
    [accountGoogleId],
  );
  return result.rows.map(r => ({
    date: String(r['date']).slice(0, 10),
    spend: Number(r['spend'] ?? 0),
  }));
}

export async function getVelocityAllAccounts(pool: pg.Pool, userId?: string): Promise<VelocityAccountRow[]> {
  const userFilter = userId ? `AND a.user_id = $1` : '';
  const params = userId ? [userId] : [];

  const result = await pool.query(`
    WITH daily AS (
      SELECT
        account_google_id,
        date,
        ROUND(SUM(metric_value)::numeric / 1000000, 2) AS spend,
        ROW_NUMBER() OVER (PARTITION BY account_google_id ORDER BY date DESC) AS rn
      FROM keyword_daily_stats
      WHERE metric_name = 'stats.cost'
        AND date >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY account_google_id, date
    ),
    velocity AS (
      SELECT
        d1.account_google_id,
        d1.spend AS latest_spend,
        d2.spend AS prev_spend,
        d1.date AS latest_date,
        CASE WHEN d2.spend > 0
          THEN ROUND(((d1.spend - d2.spend) / d2.spend * 100)::numeric, 1)
          ELSE NULL
        END AS change_pct
      FROM daily d1
      LEFT JOIN daily d2 ON d2.account_google_id = d1.account_google_id AND d2.rn = 2
      WHERE d1.rn = 1
    )
    SELECT
      v.*,
      a.display_name,
      a.account_age_days,
      a.status,
      a.currency
    FROM velocity v
    LEFT JOIN accounts a ON a.google_account_id = v.account_google_id
    WHERE 1=1 ${userFilter}
    ORDER BY ABS(COALESCE(v.change_pct, 0)) DESC
  `, params);
  return result.rows.map(r => ({
    account_google_id: r['account_google_id'] as string,
    latest_spend: Number(r['latest_spend'] ?? 0),
    prev_spend: r['prev_spend'] != null ? Number(r['prev_spend']) : null,
    latest_date: String(r['latest_date']),
    change_pct: r['change_pct'] != null ? Number(r['change_pct']) : null,
    display_name: r['display_name'] as string | null,
    account_age_days: Number(r['account_age_days'] ?? 0),
    status: r['status'] as string | null,
    currency: r['currency'] as string | null,
  }));
}

export async function getDomainConnections(pool: pg.Pool, accountGoogleId: string): Promise<ConnectionRow[]> {
  const result = await pool.query(`
    WITH my_domains AS (
      SELECT DISTINCT
        regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
      FROM ads,
      LATERAL (SELECT jsonb_array_elements_text(final_urls) AS url
               WHERE final_urls IS NOT NULL AND jsonb_typeof(final_urls) = 'array') u
      WHERE account_google_id = $1
    ),
    other_accounts AS (
      SELECT DISTINCT a.account_google_id, md.domain
      FROM ads a,
      LATERAL (SELECT jsonb_array_elements_text(a.final_urls) AS url
               WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array') u,
      my_domains md
      WHERE regexp_replace(regexp_replace(u.url, '^https?://', ''), '/.*$', '') = md.domain
        AND a.account_google_id != $1
    )
    SELECT
      oa.account_google_id,
      oa.domain AS link_value,
      acc.display_name,
      bl.banned_at
    FROM other_accounts oa
    LEFT JOIN accounts acc ON acc.google_account_id = oa.account_google_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = oa.account_google_id
  `, [accountGoogleId]);

  return result.rows.map(r => ({
    account_google_id: r['account_google_id'] as string,
    display_name: r['display_name'] as string | null,
    link_value: r['link_value'] as string,
    banned_at: r['banned_at'] ? String(r['banned_at']) : null,
  }));
}

export async function getBinConnections(pool: pg.Pool, accountGoogleId: string): Promise<ConnectionRow[]> {
  const result = await pool.query(`
    SELECT
      a2.google_account_id AS account_google_id,
      a2.display_name,
      a2.payment_bin AS link_value,
      bl.banned_at
    FROM accounts a1
    JOIN accounts a2 ON a2.payment_bin = a1.payment_bin AND a2.google_account_id != a1.google_account_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = a2.google_account_id
    WHERE a1.google_account_id = $1
      AND a1.payment_bin IS NOT NULL
  `, [accountGoogleId]);

  return result.rows.map(r => ({
    account_google_id: r['account_google_id'] as string,
    display_name: r['display_name'] as string | null,
    link_value: r['link_value'] as string,
    banned_at: r['banned_at'] ? String(r['banned_at']) : null,
  }));
}

export async function getProxyConnections(pool: pg.Pool, accountGoogleId: string): Promise<ConnectionRow[]> {
  const result = await pool.query(`
    SELECT
      a2.google_account_id AS account_google_id,
      a2.display_name,
      COALESCE(p.provider || ' / ' || p.geo, p.ip_address, p.id::text) AS link_value,
      bl.banned_at
    FROM account_consumables ac1
    JOIN accounts a1 ON a1.id = ac1.account_id
    JOIN account_consumables ac2 ON ac2.proxy_id = ac1.proxy_id
      AND ac2.account_id != ac1.account_id
      AND ac2.unlinked_at IS NULL
    JOIN accounts a2 ON a2.id = ac2.account_id
    JOIN proxies p ON p.id = ac1.proxy_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = a2.google_account_id
    WHERE a1.google_account_id = $1
      AND ac1.proxy_id IS NOT NULL
      AND ac1.unlinked_at IS NULL
  `, [accountGoogleId]);

  return result.rows.map(r => ({
    account_google_id: r['account_google_id'] as string,
    display_name: r['display_name'] as string | null,
    link_value: r['link_value'] as string,
    banned_at: r['banned_at'] ? String(r['banned_at']) : null,
  }));
}

export async function getProfileConnections(pool: pg.Pool, accountGoogleId: string): Promise<ConnectionRow[]> {
  const result = await pool.query(`
    SELECT
      a2.google_account_id AS account_google_id,
      a2.display_name,
      COALESCE(ap.browser_type::text || ' / ' || ap.profile_external_id, ap.id::text) AS link_value,
      bl.banned_at
    FROM account_consumables ac1
    JOIN accounts a1 ON a1.id = ac1.account_id
    JOIN account_consumables ac2 ON ac2.antidetect_profile_id = ac1.antidetect_profile_id
      AND ac2.account_id != ac1.account_id
      AND ac2.unlinked_at IS NULL
    JOIN accounts a2 ON a2.id = ac2.account_id
    JOIN antidetect_profiles ap ON ap.id = ac1.antidetect_profile_id
    LEFT JOIN ban_logs bl ON bl.account_google_id = a2.google_account_id
    WHERE a1.google_account_id = $1
      AND ac1.antidetect_profile_id IS NOT NULL
      AND ac1.unlinked_at IS NULL
  `, [accountGoogleId]);

  return result.rows.map(r => ({
    account_google_id: r['account_google_id'] as string,
    display_name: r['display_name'] as string | null,
    link_value: r['link_value'] as string,
    banned_at: r['banned_at'] ? String(r['banned_at']) : null,
  }));
}

export async function getSharedDomains(pool: pg.Pool, userId?: string): Promise<SharedDomainRow[]> {
  const userFilter = userId
    ? `WHERE a.account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $1)`
    : '';
  const params = userId ? [userId] : [];

  const result = await pool.query(`
    WITH account_domains AS (
      SELECT DISTINCT
        a.account_google_id,
        regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
      FROM ads a,
      LATERAL (SELECT jsonb_array_elements_text(a.final_urls) AS url
               WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array') u
      ${userFilter}
    ),
    domain_groups AS (
      SELECT domain, array_agg(DISTINCT account_google_id) AS accounts, COUNT(DISTINCT account_google_id)::int AS account_count
      FROM account_domains
      GROUP BY domain
      HAVING COUNT(DISTINCT account_google_id) > 1
    )
    SELECT
      dg.domain,
      dg.accounts,
      dg.account_count,
      (SELECT COUNT(*)::int FROM ban_logs bl WHERE bl.account_google_id = ANY(dg.accounts)) AS banned_count
    FROM domain_groups dg
    ORDER BY dg.account_count DESC, banned_count DESC
  `, params);
  return result.rows.map(r => ({
    domain: r['domain'] as string,
    accounts: r['accounts'] as string[],
    account_count: Number(r['account_count']),
    banned_count: Number(r['banned_count']),
  }));
}

export async function getConsumableScoring(pool: pg.Pool, userId?: string): Promise<{
  bins: BinScoringRow[];
  domains: DomainScoringRow[];
  proxies: ProxyScoringRow[];
}> {
  const userAccountFilter = userId ? `AND a.user_id = $1` : '';
  const params = userId ? [userId] : [];

  const [binResult, domainResult, proxyResult] = await Promise.all([
    pool.query(`
      SELECT
        a.payment_bin AS bin,
        COUNT(DISTINCT a.google_account_id)::int AS total,
        COUNT(DISTINCT bl.account_google_id)::int AS banned,
        ROUND(
          COUNT(DISTINCT bl.account_google_id)::numeric /
          NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
        ) AS ban_rate,
        ROUND(AVG(bl.lifetime_hours)::numeric, 1) AS avg_lifetime_hours
      FROM accounts a
      LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
      WHERE a.payment_bin IS NOT NULL AND a.payment_bin != '' ${userAccountFilter}
      GROUP BY a.payment_bin
      ORDER BY ban_rate DESC NULLS LAST, total DESC
    `, params),
    pool.query(`
      WITH ad_domains AS (
        SELECT DISTINCT
          ads.account_google_id,
          regexp_replace(regexp_replace(url, '^https?://', ''), '/.*$', '') AS domain
        FROM ads,
        LATERAL (SELECT jsonb_array_elements_text(ads.final_urls) AS url
                 WHERE ads.final_urls IS NOT NULL AND jsonb_typeof(ads.final_urls) = 'array') u
        ${userId ? `WHERE ads.account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $1)` : ''}
      ),
      domain_stats AS (
        SELECT
          ad.domain,
          COUNT(DISTINCT ad.account_google_id)::int AS total,
          COUNT(DISTINCT bl.account_google_id)::int AS banned,
          ROUND(
            COUNT(DISTINCT bl.account_google_id)::numeric /
            NULLIF(COUNT(DISTINCT ad.account_google_id), 0) * 100, 1
          ) AS ban_rate,
          ROUND(AVG(bl.lifetime_hours)::numeric, 1) AS avg_lifetime_hours,
          d.safe_page_quality_score
        FROM ad_domains ad
        LEFT JOIN ban_logs bl ON bl.account_google_id = ad.account_google_id
        LEFT JOIN domains d ON d.domain_name = ad.domain
        GROUP BY ad.domain, d.safe_page_quality_score
      )
      SELECT * FROM domain_stats
      ORDER BY ban_rate DESC NULLS LAST, total DESC
    `, params),
    pool.query(`
      SELECT
        COALESCE(p.provider || ' / ' || p.geo, p.ip_address, p.id::text) AS proxy,
        COUNT(DISTINCT a.google_account_id)::int AS total,
        COUNT(DISTINCT bl.account_google_id)::int AS banned,
        ROUND(
          COUNT(DISTINCT bl.account_google_id)::numeric /
          NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
        ) AS ban_rate,
        ROUND(AVG(bl.lifetime_hours)::numeric, 1) AS avg_lifetime_hours
      FROM proxies p
      JOIN account_consumables ac ON ac.proxy_id = p.id AND ac.unlinked_at IS NULL
      JOIN accounts a ON a.id = ac.account_id
      LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
      WHERE 1=1 ${userAccountFilter}
      GROUP BY p.id, p.provider, p.geo, p.ip_address
      ORDER BY ban_rate DESC NULLS LAST, total DESC
    `, params),
  ]);

  return {
    bins: binResult.rows.map(r => ({
      bin: r['bin'] as string,
      total: Number(r['total']),
      banned: Number(r['banned']),
      ban_rate: Number(r['ban_rate'] ?? 0),
      avg_lifetime_hours: Number(r['avg_lifetime_hours'] ?? 0),
    })),
    domains: domainResult.rows.map(r => ({
      domain: r['domain'] as string,
      total: Number(r['total']),
      banned: Number(r['banned']),
      ban_rate: Number(r['ban_rate'] ?? 0),
      avg_lifetime_hours: Number(r['avg_lifetime_hours'] ?? 0),
      safe_page_quality_score: r['safe_page_quality_score'] != null ? Number(r['safe_page_quality_score']) : null,
    })),
    proxies: proxyResult.rows.map(r => ({
      proxy: r['proxy'] as string,
      total: Number(r['total']),
      banned: Number(r['banned']),
      ban_rate: Number(r['ban_rate'] ?? 0),
      avg_lifetime_hours: Number(r['avg_lifetime_hours'] ?? 0),
    })),
  };
}

export async function getCampaignDailyMetrics(pool: pg.Pool, accountGoogleId?: string, userId?: string): Promise<CampaignDailyMetricsRow[]> {
  const params: unknown[] = [];
  const conditions: string[] = ['kds.keyword_id IS NULL', 'kds.campaign_id IS NOT NULL'];

  if (accountGoogleId) {
    params.push(accountGoogleId);
    conditions.push(`kds.account_google_id = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`kds.account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $${params.length})`);
  }

  const result = await pool.query(`
    SELECT
      c.campaign_id,
      c.campaign_name,
      c.account_google_id,
      kds.date,
      MAX(CASE WHEN kds.metric_name = 'stats.ctr' THEN kds.metric_value END) AS ctr,
      MAX(CASE WHEN kds.metric_name = 'stats.average_cpc' THEN kds.metric_value END) AS cpc,
      MAX(CASE WHEN kds.metric_name = 'stats.clicks' THEN kds.metric_value END) AS clicks,
      MAX(CASE WHEN kds.metric_name = 'stats.impressions' THEN kds.metric_value END) AS impressions
    FROM keyword_daily_stats kds
    JOIN campaigns c ON c.campaign_id = kds.campaign_id AND c.account_google_id = kds.account_google_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY c.campaign_id, c.campaign_name, c.account_google_id, kds.date
    ORDER BY c.campaign_id, kds.date
  `, params);

  return result.rows.map(r => ({
    campaign_id: r['campaign_id'] as string,
    campaign_name: r['campaign_name'] as string,
    account_google_id: r['account_google_id'] as string,
    date: String(r['date']).slice(0, 10),
    ctr: r['ctr'] != null ? Number(r['ctr']) : null,
    cpc: r['cpc'] != null ? Number(r['cpc']) : null,
    clicks: r['clicks'] != null ? Number(r['clicks']) : null,
    impressions: r['impressions'] != null ? Number(r['impressions']) : null,
  }));
}

export async function getBanIdsWithoutPostMortem(pool: pg.Pool, limit: number, userId?: string): Promise<string[]> {
  const uf = userAccountFilter(userId, 1);
  const result = await pool.query(
    `SELECT id FROM ban_logs WHERE post_mortem IS NULL ${uf.clause} ORDER BY banned_at DESC LIMIT $${uf.params.length + 1}`,
    [...uf.params, limit],
  );
  return result.rows.map(r => r['id'] as string);
}

export async function getCompetitiveIntelligence(pool: pg.Pool, userId?: string): Promise<CompetitorRow[]> {
  const userFilter = userId
    ? `AND account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $1)`
    : '';
  const params = userId ? [userId] : [];

  const result = await pool.query(`
    SELECT
      competitor_domain AS domain,
      COUNT(DISTINCT account_google_id)::int AS accounts_seen_in,
      ROUND(AVG(impression_share)::numeric, 4) AS avg_impression_share,
      ROUND(AVG(overlap_rate)::numeric, 4) AS avg_overlap_rate,
      ROUND(AVG(position_above_rate)::numeric, 4) AS avg_position_above_rate,
      MIN(created_at)::text AS first_seen,
      MAX(created_at)::text AS last_seen,
      EXTRACT(EPOCH FROM MAX(created_at) - MIN(created_at))::int / 86400 AS longevity_days
    FROM auction_insights
    WHERE competitor_domain != '__raw__' ${userFilter}
    GROUP BY competitor_domain
    ORDER BY AVG(impression_share) DESC NULLS LAST
    LIMIT 100
  `, params);
  return result.rows.map(r => ({
    domain: r['domain'] as string,
    accounts_seen_in: r['accounts_seen_in'] as number,
    avg_impression_share: Number(r['avg_impression_share'] ?? 0),
    avg_overlap_rate: Number(r['avg_overlap_rate'] ?? 0),
    avg_position_above_rate: Number(r['avg_position_above_rate'] ?? 0),
    first_seen: (r['first_seen'] as string) ?? '',
    last_seen: (r['last_seen'] as string) ?? '',
    longevity_days: Number(r['longevity_days'] ?? 0),
  }));
}

export async function getAccountCompetitors(pool: pg.Pool, accountGoogleId: string): Promise<AccountCompetitorRow[]> {
  const result = await pool.query(`
    SELECT
      competitor_domain AS domain,
      ROUND(AVG(impression_share)::numeric, 4) AS avg_impression_share,
      ROUND(AVG(overlap_rate)::numeric, 4) AS avg_overlap_rate,
      ROUND(AVG(position_above_rate)::numeric, 4) AS avg_position_above_rate,
      ROUND(AVG(top_of_page_rate)::numeric, 4) AS avg_top_of_page_rate,
      ROUND(AVG(outranking_share)::numeric, 4) AS avg_outranking_share,
      COUNT(*)::int AS data_points
    FROM auction_insights
    WHERE account_google_id = $1 AND competitor_domain != '__raw__'
    GROUP BY competitor_domain
    ORDER BY AVG(impression_share) DESC NULLS LAST
    LIMIT 50
  `, [accountGoogleId]);

  return result.rows.map(r => ({
    domain: r['domain'] as string,
    avg_impression_share: Number(r['avg_impression_share'] ?? 0),
    avg_overlap_rate: Number(r['avg_overlap_rate'] ?? 0),
    avg_position_above_rate: Number(r['avg_position_above_rate'] ?? 0),
    avg_top_of_page_rate: Number(r['avg_top_of_page_rate'] ?? 0),
    avg_outranking_share: Number(r['avg_outranking_share'] ?? 0),
    data_points: r['data_points'] as number,
  }));
}
