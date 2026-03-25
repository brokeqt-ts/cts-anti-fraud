import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface AccountFeatureVector {
  account_google_id: string;
  // Account features
  account_age_days: number;
  account_type: string | null;
  has_verification: boolean;
  policy_violation_count: number;
  active_campaign_count: number;
  // Domain features
  domain_age_days: number | null;
  domain_safe_page_score: number | null;
  domain_has_ssl: boolean;
  domain_has_privacy_page: boolean;
  // Financial features
  total_spend_usd: number;
  daily_spend_avg: number;
  spend_velocity_ratio: number;
  bin_prefix: string | null;
  bin_ban_rate: number | null;
  payment_method_count: number;
  // Campaign features
  campaign_count: number;
  avg_quality_score: number | null;
  low_qs_keyword_ratio: number;
  ad_disapproval_count: number;
  // Network features
  connected_banned_accounts: number;
  max_connection_weight: number;
  shared_domain_with_banned: boolean;
  shared_bin_with_banned: boolean;
  // Behavioral features
  days_since_last_change: number | null;
  change_frequency_7d: number;
  notification_warning_count: number;
  notification_critical_count: number;
  // Consumable features
  proxy_ban_rate: number | null;
  antidetect_browser_type: string | null;
  // Temporal features
  hour_of_day: number;
  day_of_week: number;
  is_high_risk_time: boolean;
}

export interface TrainingRow extends AccountFeatureVector {
  is_banned: boolean;
  days_to_ban: number | null;
}

// ─── Repository Functions ───────────────────────────────────────────────────

const FEATURE_QUERY = `
WITH account_base AS (
  SELECT
    a.id AS account_id,
    a.google_account_id,
    COALESCE(a.account_age_days, EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 86400)::int AS account_age_days,
    a.account_type,
    a.offer_vertical,
    a.payment_bin,
    a.total_spend,
    a.currency
  FROM accounts a
  WHERE a.google_account_id = $1
),
domain_data AS (
  SELECT
    d.domain_age_days,
    d.safe_page_quality_score,
    COALESCE(d.ssl_type, 'none') != 'none' AS has_ssl,
    d.has_privacy_page
  FROM account_base ab
  JOIN ads ad ON ad.account_google_id = ab.google_account_id
  JOIN domains d ON ad.final_urls::text ILIKE '%' || d.domain_name || '%'
  LIMIT 1
),
violation_data AS (
  SELECT
    COUNT(*) FILTER (WHERE nd.category = 'WARNING')::int AS warning_count,
    COUNT(*) FILTER (WHERE nd.category = 'CRITICAL')::int AS critical_count
  FROM notification_details nd
  WHERE nd.account_google_id = $1
    AND nd.captured_at > NOW() - INTERVAL '30 days'
),
campaign_data AS (
  SELECT
    COUNT(DISTINCT c.campaign_id)::int AS campaign_count,
    COUNT(DISTINCT c.campaign_id) FILTER (WHERE c.status = 3)::int AS active_count
  FROM campaigns c
  WHERE c.account_google_id = $1
),
keyword_data AS (
  SELECT
    ROUND(AVG(k.quality_score)::numeric, 1) AS avg_qs,
    CASE WHEN COUNT(*) > 0
      THEN ROUND(COUNT(*) FILTER (WHERE k.quality_score IS NOT NULL AND k.quality_score <= 4)::numeric / NULLIF(COUNT(*) FILTER (WHERE k.quality_score IS NOT NULL), 0), 3)
      ELSE 0
    END AS low_qs_ratio
  FROM keywords k
  WHERE k.account_google_id = $1
),
financial_data AS (
  SELECT
    COALESCE(ab.total_spend, 0)::numeric AS total_spend,
    CASE WHEN ab.account_age_days > 0
      THEN ROUND((COALESCE(ab.total_spend, 0) / GREATEST(ab.account_age_days, 1))::numeric, 2)
      ELSE 0
    END AS daily_avg
  FROM account_base ab
),
bin_data AS (
  SELECT
    COUNT(DISTINCT a2.google_account_id)::int AS bin_total,
    COUNT(DISTINCT bl.account_google_id)::int AS bin_banned
  FROM account_base ab
  JOIN accounts a2 ON a2.payment_bin = ab.payment_bin AND ab.payment_bin IS NOT NULL
  LEFT JOIN ban_logs bl ON bl.account_google_id = a2.google_account_id
),
network_data AS (
  SELECT
    COUNT(DISTINCT bl2.account_google_id)::int AS connected_banned,
    CASE WHEN EXISTS(
      SELECT 1 FROM ads ad1
      JOIN ads ad2 ON ad2.final_urls::text = ad1.final_urls::text AND ad2.account_google_id != $1
      JOIN ban_logs bl3 ON bl3.account_google_id = ad2.account_google_id
      WHERE ad1.account_google_id = $1
    ) THEN true ELSE false END AS shared_domain_banned,
    CASE WHEN EXISTS(
      SELECT 1 FROM accounts a3
      JOIN ban_logs bl4 ON bl4.account_google_id = a3.google_account_id
      WHERE a3.payment_bin = (SELECT payment_bin FROM account_base)
        AND a3.google_account_id != $1
        AND (SELECT payment_bin FROM account_base) IS NOT NULL
    ) THEN true ELSE false END AS shared_bin_banned
  FROM account_base ab
  LEFT JOIN ban_logs bl2 ON bl2.account_google_id IN (
    SELECT DISTINCT a4.google_account_id
    FROM accounts a4
    WHERE (a4.payment_bin = ab.payment_bin AND ab.payment_bin IS NOT NULL)
       OR a4.google_account_id IN (
         SELECT ad3.account_google_id FROM ads ad3
         WHERE ad3.final_urls::text IN (SELECT ad4.final_urls::text FROM ads ad4 WHERE ad4.account_google_id = $1)
           AND ad3.account_google_id != $1
       )
  )
),
consumable_data AS (
  SELECT
    ap.browser_type AS antidetect_browser_type
  FROM account_base ab
  LEFT JOIN account_consumables ac ON ac.account_id = ab.account_id
  LEFT JOIN antidetect_profiles ap ON ap.id = ac.antidetect_profile_id
  LIMIT 1
),
ad_disapprovals AS (
  SELECT COUNT(*)::int AS disapproval_count
  FROM ads ad
  WHERE ad.account_google_id = $1
    AND ad.review_status = 'DISAPPROVED'
),
payment_methods AS (
  SELECT COUNT(DISTINCT ac.payment_method_id)::int AS pm_count
  FROM account_base ab
  JOIN account_consumables ac ON ac.account_id = ab.account_id AND ac.payment_method_id IS NOT NULL
)
SELECT
  ab.google_account_id AS account_google_id,
  COALESCE(ab.account_age_days, 0) AS account_age_days,
  ab.account_type,
  false AS has_verification,
  COALESCE(vd.critical_count, 0) AS policy_violation_count,
  COALESCE(cd.active_count, 0) AS active_campaign_count,
  dd.domain_age_days,
  dd.safe_page_quality_score AS domain_safe_page_score,
  COALESCE(dd.has_ssl, false) AS domain_has_ssl,
  COALESCE(dd.has_privacy_page, false) AS domain_has_privacy_page,
  COALESCE(fd.total_spend, 0) AS total_spend_usd,
  COALESCE(fd.daily_avg, 0) AS daily_spend_avg,
  CASE WHEN fd.daily_avg > 0 AND ab.account_age_days > 7
    THEN ROUND((fd.daily_avg / GREATEST(COALESCE(fd.total_spend, 0) / GREATEST(ab.account_age_days, 1), 0.01))::numeric, 2)
    ELSE 1
  END AS spend_velocity_ratio,
  ab.payment_bin AS bin_prefix,
  CASE WHEN COALESCE(bd.bin_total, 0) > 0
    THEN ROUND((bd.bin_banned::numeric / bd.bin_total) * 100, 1)
    ELSE NULL
  END AS bin_ban_rate,
  COALESCE(pm.pm_count, 0) AS payment_method_count,
  COALESCE(cd.campaign_count, 0) AS campaign_count,
  kd.avg_qs AS avg_quality_score,
  COALESCE(kd.low_qs_ratio, 0) AS low_qs_keyword_ratio,
  COALESCE(adis.disapproval_count, 0) AS ad_disapproval_count,
  COALESCE(nd.connected_banned, 0) AS connected_banned_accounts,
  CASE WHEN COALESCE(nd.connected_banned, 0) > 0 THEN 1 ELSE 0 END AS max_connection_weight,
  COALESCE(nd.shared_domain_banned, false) AS shared_domain_with_banned,
  COALESCE(nd.shared_bin_banned, false) AS shared_bin_with_banned,
  NULL::int AS days_since_last_change,
  0 AS change_frequency_7d,
  COALESCE(vd.warning_count, 0) AS notification_warning_count,
  COALESCE(vd.critical_count, 0) AS notification_critical_count,
  NULL::numeric AS proxy_ban_rate,
  csd.antidetect_browser_type,
  EXTRACT(HOUR FROM NOW())::int AS hour_of_day,
  EXTRACT(DOW FROM NOW())::int AS day_of_week,
  false AS is_high_risk_time
FROM account_base ab
LEFT JOIN domain_data dd ON true
LEFT JOIN violation_data vd ON true
LEFT JOIN campaign_data cd ON true
LEFT JOIN keyword_data kd ON true
LEFT JOIN financial_data fd ON true
LEFT JOIN bin_data bd ON true
LEFT JOIN network_data nd ON true
LEFT JOIN consumable_data csd ON true
LEFT JOIN ad_disapprovals adis ON true
LEFT JOIN payment_methods pm ON true
`;

export async function extractFeatures(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<AccountFeatureVector | null> {
  const result = await pool.query(FEATURE_QUERY, [accountGoogleId]);
  if (result.rowCount === 0) return null;
  return mapRow(result.rows[0]!);
}

export async function extractBulkFeatures(
  pool: pg.Pool,
  userId?: string,
): Promise<AccountFeatureVector[]> {
  const conditions = ["account_status != 'suspended'"];
  const params: unknown[] = [];
  if (userId) {
    conditions.push(`user_id = $${params.length + 1}`);
    params.push(userId);
  }
  const accountsResult = await pool.query(
    `SELECT google_account_id FROM accounts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 500`,
    params,
  );
  const vectors: AccountFeatureVector[] = [];
  for (const row of accountsResult.rows) {
    const v = await extractFeatures(pool, row['google_account_id'] as string);
    if (v) vectors.push(v);
  }
  return vectors;
}

export async function extractTrainingData(
  pool: pg.Pool,
): Promise<TrainingRow[]> {
  // All accounts with known outcomes
  const accountsResult = await pool.query(
    `SELECT
       a.google_account_id,
       EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS is_banned,
       (SELECT MIN(bl.lifetime_hours) / 24.0 FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id)::numeric AS days_to_ban
     FROM accounts a
     WHERE a.account_age_days > 3 OR EXISTS(SELECT 1 FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id)
     ORDER BY a.created_at DESC
     LIMIT 1000`,
  );

  const rows: TrainingRow[] = [];
  for (const accountRow of accountsResult.rows) {
    const gid = accountRow['google_account_id'] as string;
    const features = await extractFeatures(pool, gid);
    if (!features) continue;
    rows.push({
      ...features,
      is_banned: accountRow['is_banned'] === true,
      days_to_ban: accountRow['days_to_ban'] != null ? Number(accountRow['days_to_ban']) : null,
    });
  }
  return rows;
}

function mapRow(row: Record<string, unknown>): AccountFeatureVector {
  return {
    account_google_id: row['account_google_id'] as string,
    account_age_days: Number(row['account_age_days'] ?? 0),
    account_type: (row['account_type'] as string | null) ?? null,
    has_verification: row['has_verification'] === true,
    policy_violation_count: Number(row['policy_violation_count'] ?? 0),
    active_campaign_count: Number(row['active_campaign_count'] ?? 0),
    domain_age_days: row['domain_age_days'] != null ? Number(row['domain_age_days']) : null,
    domain_safe_page_score: row['domain_safe_page_score'] != null ? Number(row['domain_safe_page_score']) : null,
    domain_has_ssl: row['domain_has_ssl'] === true,
    domain_has_privacy_page: row['domain_has_privacy_page'] === true,
    total_spend_usd: Number(row['total_spend_usd'] ?? 0),
    daily_spend_avg: Number(row['daily_spend_avg'] ?? 0),
    spend_velocity_ratio: Number(row['spend_velocity_ratio'] ?? 1),
    bin_prefix: (row['bin_prefix'] as string | null) ?? null,
    bin_ban_rate: row['bin_ban_rate'] != null ? Number(row['bin_ban_rate']) : null,
    payment_method_count: Number(row['payment_method_count'] ?? 0),
    campaign_count: Number(row['campaign_count'] ?? 0),
    avg_quality_score: row['avg_quality_score'] != null ? Number(row['avg_quality_score']) : null,
    low_qs_keyword_ratio: Number(row['low_qs_keyword_ratio'] ?? 0),
    ad_disapproval_count: Number(row['ad_disapproval_count'] ?? 0),
    connected_banned_accounts: Number(row['connected_banned_accounts'] ?? 0),
    max_connection_weight: Number(row['max_connection_weight'] ?? 0),
    shared_domain_with_banned: row['shared_domain_with_banned'] === true,
    shared_bin_with_banned: row['shared_bin_with_banned'] === true,
    days_since_last_change: row['days_since_last_change'] != null ? Number(row['days_since_last_change']) : null,
    change_frequency_7d: Number(row['change_frequency_7d'] ?? 0),
    notification_warning_count: Number(row['notification_warning_count'] ?? 0),
    notification_critical_count: Number(row['notification_critical_count'] ?? 0),
    proxy_ban_rate: row['proxy_ban_rate'] != null ? Number(row['proxy_ban_rate']) : null,
    antidetect_browser_type: (row['antidetect_browser_type'] as string | null) ?? null,
    hour_of_day: Number(row['hour_of_day'] ?? 12),
    day_of_week: Number(row['day_of_week'] ?? 1),
    is_high_risk_time: row['is_high_risk_time'] === true,
  };
}
