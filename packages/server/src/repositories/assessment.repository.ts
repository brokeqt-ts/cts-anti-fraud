import type pg from 'pg';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface DomainInfo {
  domainAgeDays: number | null;
  safePageQualityScore: number | null;
}

export interface AccountInfo {
  accountAgeDays: number | null;
  hasActiveViolations: boolean;
}

export interface BinStats {
  total: number;
  banned: number;
  banRate: number;
  avgLifetimeHours: number;
}

export interface VerticalStats {
  banCount: number;
  totalAccounts: number;
  banRate: number;
  avgLifetimeHours: number;
}

export interface GeoStats {
  banCount: number;
  totalAccounts: number;
  banRate: number;
}

export interface ComparableAccounts {
  total: number;
  banned: number;
  avgLifetimeDays: number;
}

// ─── Repository Functions ───────────────────────────────────────────────────

export async function getDomainInfo(pool: pg.Pool, domain: string): Promise<DomainInfo> {
  const result = await pool.query(
    `SELECT domain_age_days, safe_page_quality_score
     FROM domains
     WHERE domain_name = $1`,
    [domain],
  );

  if (result.rowCount === 0) {
    return { domainAgeDays: null, safePageQualityScore: null };
  }

  const row = result.rows[0]!;
  return {
    domainAgeDays: row['domain_age_days'] != null ? Number(row['domain_age_days']) : null,
    safePageQualityScore: row['safe_page_quality_score'] != null ? Number(row['safe_page_quality_score']) : null,
  };
}

export async function getAccountInfo(pool: pg.Pool, accountGoogleId: string): Promise<AccountInfo | null> {
  const result = await pool.query(
    `SELECT
       account_age_days,
       EXISTS(
         SELECT 1 FROM account_signals
         WHERE account_google_id = $1
           AND signal_name IN ('policy_violation', 'account_warning')
           AND captured_at > NOW() - INTERVAL '7 days'
       ) AS has_active_violations
     FROM accounts
     WHERE google_account_id = $1`,
    [accountGoogleId],
  );

  if (result.rowCount === 0) return null;

  const row = result.rows[0]!;
  return {
    accountAgeDays: row['account_age_days'] != null ? Number(row['account_age_days']) : null,
    hasActiveViolations: row['has_active_violations'] === true,
  };
}

export async function getBinStats(pool: pg.Pool, bin: string): Promise<BinStats> {
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT a.google_account_id)::int AS total,
       COUNT(DISTINCT bl.account_google_id)::int AS banned,
       ROUND(
         COUNT(DISTINCT bl.account_google_id)::numeric /
         NULLIF(COUNT(DISTINCT a.google_account_id), 0) * 100, 1
       ) AS ban_rate,
       ROUND(COALESCE(AVG(bl.lifetime_hours), 0)::numeric, 1) AS avg_lifetime_hours
     FROM accounts a
     LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
     WHERE a.payment_bin = $1`,
    [bin],
  );

  const row = result.rows[0] ?? {};
  return {
    total: Number(row['total'] ?? 0),
    banned: Number(row['banned'] ?? 0),
    banRate: Number(row['ban_rate'] ?? 0),
    avgLifetimeHours: Number(row['avg_lifetime_hours'] ?? 0),
  };
}

export async function getVerticalStats(pool: pg.Pool, vertical: string): Promise<VerticalStats> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS ban_count,
       COUNT(DISTINCT bl.account_google_id)::int AS total_accounts,
       ROUND(COALESCE(AVG(bl.lifetime_hours), 0)::numeric, 1) AS avg_lifetime_hours
     FROM ban_logs bl
     WHERE COALESCE(bl.offer_vertical, 'other') = $1`,
    [vertical],
  );

  const allAccountsResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM accounts
     WHERE COALESCE(offer_vertical, 'other') = $1`,
    [vertical],
  );

  const row = result.rows[0] ?? {};
  const totalAccounts = Number(allAccountsResult.rows[0]?.['total'] ?? 0);
  const banCount = Number(row['ban_count'] ?? 0);

  return {
    banCount,
    totalAccounts,
    banRate: totalAccounts > 0 ? Math.round((banCount / totalAccounts) * 1000) / 10 : 0,
    avgLifetimeHours: Number(row['avg_lifetime_hours'] ?? 0),
  };
}

export async function getGeoStats(pool: pg.Pool, geo: string): Promise<GeoStats> {
  // Geo from campaign target_countries JSONB
  const result = await pool.query(
    `WITH geo_accounts AS (
       SELECT DISTINCT c.account_google_id
       FROM campaigns c
       WHERE c.target_countries::text ILIKE $1
     )
     SELECT
       COUNT(DISTINCT ga.account_google_id)::int AS total_accounts,
       COUNT(DISTINCT bl.account_google_id)::int AS ban_count
     FROM geo_accounts ga
     LEFT JOIN ban_logs bl ON bl.account_google_id = ga.account_google_id`,
    [`%${geo}%`],
  );

  const row = result.rows[0] ?? {};
  const totalAccounts = Number(row['total_accounts'] ?? 0);
  const banCount = Number(row['ban_count'] ?? 0);

  return {
    banCount,
    totalAccounts,
    banRate: totalAccounts > 0 ? Math.round((banCount / totalAccounts) * 1000) / 10 : 0,
  };
}

export async function getComparableAccounts(
  pool: pg.Pool,
  filters: { domain?: string; vertical?: string; bin?: string },
): Promise<ComparableAccounts> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.domain) {
    conditions.push(`EXISTS(
      SELECT 1 FROM ads a2
      WHERE a2.account_google_id = a.google_account_id
        AND a2.final_urls::text ILIKE $${idx++}
    )`);
    params.push(`%${filters.domain}%`);
  }

  if (filters.vertical) {
    conditions.push(`COALESCE(a.offer_vertical, 'other') = $${idx++}`);
    params.push(filters.vertical);
  }

  if (filters.bin) {
    conditions.push(`a.payment_bin = $${idx++}`);
    params.push(filters.bin);
  }

  if (conditions.length === 0) {
    return { total: 0, banned: 0, avgLifetimeDays: 0 };
  }

  const where = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT a.google_account_id)::int AS total,
       COUNT(DISTINCT bl.account_google_id)::int AS banned,
       ROUND(COALESCE(AVG(bl.lifetime_hours / 24.0), 0)::numeric, 1) AS avg_lifetime_days
     FROM accounts a
     LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
     WHERE ${where}`,
    params,
  );

  const row = result.rows[0] ?? {};
  return {
    total: Number(row['total'] ?? 0),
    banned: Number(row['banned'] ?? 0),
    avgLifetimeDays: Number(row['avg_lifetime_days'] ?? 0),
  };
}
