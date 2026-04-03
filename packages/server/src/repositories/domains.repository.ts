import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface DomainListRow {
  domain: string;
  account_count: number;
  account_ids: string[];
  ban_count: number;
  domain_id: string | null;
  domain_age_days: number | null;
  registrar: string | null;
  created_date: string | null;
  expires_date: string | null;
  ssl_type_enum: string | null;
  hosting_ip: string | null;
  hosting_asn: string | null;
  hosting_provider: string | null;
  hosting_country: string | null;
  dns_provider_enum: string | null;
  has_cloudflare: boolean | null;
  has_google_analytics: boolean | null;
  has_gtm: boolean | null;
  has_facebook_pixel: boolean | null;
  has_privacy_page: boolean | null;
  has_terms_page: boolean | null;
  has_contact_page: boolean | null;
  has_blog: boolean | null;
  meta_title: string | null;
  page_word_count: number | null;
  http_status: number | null;
  site_status: string | null;
  safe_page_quality_score: number | null;
  content_quality_score: number | null;
  pagespeed_score: number | null;
  last_checked_at: string | null;
  cloaking_detected: boolean | null;
  cloaking_type: string | null;
  cloaking_checked_at: string | null;
  safe_page_type: string | null;
}

export interface DomainListResult {
  total: number;
  domains: DomainListRow[];
}

export interface DomainDetailRow {
  [key: string]: unknown;
}

export interface DomainAccountRow {
  google_account_id: string;
  display_name: string | null;
  status: string | null;
}

export interface DomainBanRow {
  id: string;
  account_google_id: string;
  banned_at: string;
  ban_reason: string | null;
  ban_target: string;
  offer_vertical: string | null;
}

export interface DomainDetailResult {
  domain: DomainDetailRow;
  accounts: DomainAccountRow[];
  bans: DomainBanRow[];
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * List all unique domains extracted from ads.final_urls,
 * enriched with data from the domains table if available.
 */
export async function listDomains(pool: pg.Pool, userId?: string): Promise<DomainListResult> {
  const params: unknown[] = [];
  const accountFilter = userId ? (params.push(userId), `AND acc.user_id = $${params.length}`) : '';
  const result = await pool.query(`
    WITH extracted AS (
      SELECT DISTINCT
        regexp_replace(
          regexp_replace(url, '^https?://', ''),
          '/.*$', ''
        ) AS domain,
        a.account_google_id
      FROM ads a
      JOIN accounts acc ON acc.google_account_id = a.account_google_id,
      LATERAL (
        SELECT jsonb_array_elements_text(a.final_urls) AS url
        WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array'
      ) urls
      WHERE a.final_urls IS NOT NULL ${accountFilter}
    ),
    domain_accounts AS (
      SELECT
        e.domain,
        COUNT(DISTINCT e.account_google_id) AS account_count,
        array_agg(DISTINCT e.account_google_id) AS account_ids
      FROM extracted e
      GROUP BY e.domain
    ),
    domain_bans AS (
      SELECT
        regexp_replace(
          regexp_replace(domain, '^https?://', ''),
          '/.*$', ''
        ) AS domain_clean,
        COUNT(*) AS ban_count
      FROM ban_logs
      WHERE domain IS NOT NULL
      GROUP BY domain_clean
    )
    SELECT
      da.domain,
      da.account_count,
      da.account_ids,
      COALESCE(db.ban_count, 0) AS ban_count,
      d.id AS domain_id,
      d.domain_age_days,
      d.registrar,
      d.created_date,
      d.expires_date,
      d.ssl_type AS ssl_type_enum,
      d.hosting_ip,
      d.asn AS hosting_asn,
      d.hosting_provider,
      d.hosting_country,
      d.dns_provider AS dns_provider_enum,
      d.has_cloudflare,
      d.has_google_analytics,
      d.has_gtm,
      d.has_facebook_pixel,
      d.has_privacy_page,
      d.has_terms_page,
      d.has_contact_page,
      d.has_blog,
      d.meta_title,
      d.page_word_count,
      d.http_status,
      d.site_status,
      d.safe_page_quality_score,
      d.content_quality_score,
      d.pagespeed_score,
      d.last_checked_at,
      d.cloaking_detected,
      d.cloaking_type,
      d.cloaking_checked_at,
      d.safe_page_type
    FROM domain_accounts da
    LEFT JOIN domain_bans db ON db.domain_clean = da.domain
    LEFT JOIN domains d ON d.domain_name = da.domain
    ORDER BY COALESCE(db.ban_count, 0) DESC, da.account_count DESC
  `, params);

  return {
    total: result.rowCount ?? 0,
    domains: result.rows as DomainListRow[],
  };
}

/**
 * Get domain enrichment data from the domains table.
 * Returns null if not found.
 */
export async function getDomainByName(
  pool: pg.Pool,
  domain: string,
): Promise<DomainDetailRow | null> {
  const result = await pool.query(
    `SELECT * FROM domains WHERE domain_name = $1`,
    [domain],
  );
  return (result.rows[0] as DomainDetailRow) ?? null;
}

/**
 * Get all accounts using a specific domain (based on ads.final_urls).
 */
export async function getAccountsByDomain(
  pool: pg.Pool,
  domain: string,
  userId?: string,
): Promise<DomainAccountRow[]> {
  const params: unknown[] = [`%${domain}%`];
  const userFilter = userId ? (params.push(userId), `AND a2.user_id = $${params.length}`) : '';
  const result = await pool.query(
    `SELECT DISTINCT a2.google_account_id, a2.display_name, a2.status
     FROM ads a
     JOIN accounts a2 ON a2.google_account_id = a.account_google_id
     WHERE a.final_urls::text ILIKE $1 ${userFilter}`,
    params,
  );
  return result.rows.map(r => ({
    google_account_id: r['google_account_id'] as string,
    display_name: r['display_name'] as string | null,
    status: r['status'] as string | null,
  }));
}

/**
 * Get all bans associated with a specific domain.
 */
export async function getBansByDomain(
  pool: pg.Pool,
  domain: string,
  userId?: string,
): Promise<DomainBanRow[]> {
  const params: unknown[] = [`%${domain}%`];
  const userFilter = userId
    ? (params.push(userId), `AND account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $${params.length})`)
    : '';
  const result = await pool.query(
    `SELECT id, account_google_id, banned_at, ban_reason, ban_target, offer_vertical
     FROM ban_logs
     WHERE domain ILIKE $1 ${userFilter}
     ORDER BY banned_at DESC`,
    params,
  );
  return result.rows.map(r => ({
    id: r['id'] as string,
    account_google_id: r['account_google_id'] as string,
    banned_at: r['banned_at'] as string,
    ban_reason: r['ban_reason'] as string | null,
    ban_target: r['ban_target'] as string,
    offer_vertical: r['offer_vertical'] as string | null,
  }));
}
