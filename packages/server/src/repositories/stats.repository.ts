import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface AccountCountRow {
  total: number;
}

export interface BanCountRow {
  total: number;
}

export interface AvgLifetimeRow {
  avg: number | null;
}

export interface VerticalCountRow {
  offer_vertical: string;
  count: number;
}

export interface TargetCountRow {
  ban_target: string;
  count: number;
}

export interface RecentBanRow {
  id: string;
  account_google_id: string;
  banned_at: string;
  ban_target: string;
  ban_reason: string | null;
  ban_reason_internal: string | null;
  offer_vertical: string | null;
  domain: string | null;
  lifetime_hours: number | null;
  source: string;
}

export interface SignalSummaryRow {
  signal_name: string;
  signal_value: unknown;
  count: number;
}

export interface DistinctBannedCountRow {
  count: number;
}

export interface SuspendedAccountsCountRow {
  count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function banUserFilter(userId: string | undefined, paramIdx: number): { clause: string; params: unknown[] } {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: `AND account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $${paramIdx})`,
    params: [userId],
  };
}

function accountUserFilter(userId: string | undefined, paramIdx: number): { clause: string; params: unknown[] } {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: `AND user_id = $${paramIdx}`,
    params: [userId],
  };
}

function signalUserFilter(userId: string | undefined, paramIdx: number): { clause: string; params: unknown[] } {
  if (!userId) return { clause: '', params: [] };
  return {
    clause: `AND account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $${paramIdx})`,
    params: [userId],
  };
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * Count of accounts with valid Google IDs (7-13 digit pattern).
 */
export async function getAccountCount(pool: pg.Pool, userId?: string): Promise<number> {
  const uf = accountUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT COUNT(*) as total FROM accounts WHERE google_account_id ~ '^\\d{7,13}$' ${uf.clause}`,
    uf.params,
  );
  return parseInt(result.rows[0]?.['total'] as string, 10);
}

/**
 * Total ban count.
 */
export async function getBanCount(pool: pg.Pool, userId?: string): Promise<number> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT COUNT(*) as total FROM ban_logs WHERE 1=1 ${uf.clause}`,
    uf.params,
  );
  return parseInt(result.rows[0]?.['total'] as string, 10);
}

/**
 * Average lifetime hours across all bans with non-null lifetime.
 */
export async function getAvgLifetimeHours(pool: pg.Pool, userId?: string): Promise<number | null> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT ROUND(AVG(lifetime_hours)) as avg FROM ban_logs WHERE lifetime_hours IS NOT NULL ${uf.clause}`,
    uf.params,
  );
  const val = result.rows[0]?.['avg'];
  return val ? parseInt(val as string, 10) : null;
}

/**
 * Bans grouped by offer_vertical.
 */
export async function getBansByVertical(pool: pg.Pool, userId?: string): Promise<VerticalCountRow[]> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT offer_vertical, COUNT(*) as count
     FROM ban_logs
     WHERE offer_vertical IS NOT NULL ${uf.clause}
     GROUP BY offer_vertical
     ORDER BY count DESC`,
    uf.params,
  );
  return result.rows.map(r => ({
    offer_vertical: r['offer_vertical'] as string,
    count: parseInt(r['count'] as string, 10),
  }));
}

/**
 * Bans grouped by ban_target.
 */
export async function getBansByTarget(pool: pg.Pool, userId?: string): Promise<TargetCountRow[]> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT ban_target::text, COUNT(*) as count
     FROM ban_logs
     WHERE 1=1 ${uf.clause}
     GROUP BY ban_target
     ORDER BY count DESC`,
    uf.params,
  );
  return result.rows.map(r => ({
    ban_target: r['ban_target'] as string,
    count: parseInt(r['count'] as string, 10),
  }));
}

/**
 * Most recent 5 bans with domain auto-resolved from ads if missing.
 */
export async function getRecentBans(pool: pg.Pool, userId?: string): Promise<RecentBanRow[]> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT bl.id, bl.account_google_id, bl.banned_at, bl.ban_target::text as ban_target,
            bl.ban_reason, bl.ban_reason_internal, bl.offer_vertical,
            COALESCE(bl.domain, (
              SELECT COALESCE(ads.display_url, (ads.final_urls->>0)::text)
              FROM ads WHERE ads.account_google_id = bl.account_google_id
              ORDER BY ads.captured_at DESC LIMIT 1
            )) AS domain,
            bl.lifetime_hours, COALESCE(bl.source, 'manual') as source
     FROM ban_logs bl
     WHERE 1=1 ${uf.clause}
     ORDER BY bl.banned_at DESC
     LIMIT 5`,
    uf.params,
  );
  return result.rows.map(r => ({
    id: r['id'] as string,
    account_google_id: r['account_google_id'] as string,
    banned_at: r['banned_at'] as string,
    ban_target: r['ban_target'] as string,
    ban_reason: r['ban_reason'] as string | null,
    ban_reason_internal: r['ban_reason_internal'] as string | null,
    offer_vertical: r['offer_vertical'] as string | null,
    domain: r['domain'] as string | null,
    lifetime_hours: r['lifetime_hours'] != null ? Number(r['lifetime_hours']) : null,
    source: r['source'] as string,
  }));
}

/**
 * Latest signal per account grouped by signal_name and signal_value with counts.
 */
export async function getSignalsSummary(pool: pg.Pool, userId?: string): Promise<SignalSummaryRow[]> {
  const uf = signalUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT signal_name, signal_value, COUNT(*) as count
     FROM (
       SELECT DISTINCT ON (account_google_id, signal_name)
         signal_name, signal_value, account_google_id
       FROM account_signals
       WHERE 1=1 ${uf.clause}
       ORDER BY account_google_id, signal_name, captured_at DESC
     ) latest
     GROUP BY signal_name, signal_value
     ORDER BY signal_name, count DESC`,
    uf.params,
  );
  return result.rows.map(r => ({
    signal_name: r['signal_name'] as string,
    signal_value: r['signal_value'] as unknown,
    count: parseInt(r['count'] as string, 10),
  }));
}

/**
 * Count of distinct accounts that have at least one ban.
 */
export async function getDistinctBannedAccountCount(pool: pg.Pool, userId?: string): Promise<number> {
  const uf = banUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT COUNT(DISTINCT account_google_id) as count FROM ban_logs WHERE 1=1 ${uf.clause}`,
    uf.params,
  );
  return parseInt(result.rows[0]?.['count'] as string, 10);
}

/**
 * Count of accounts currently suspended based on latest account_suspended signal.
 */
export async function getSuspendedAccountCount(pool: pg.Pool, userId?: string): Promise<number> {
  const uf = signalUserFilter(userId, 1);
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM (
       SELECT DISTINCT ON (account_google_id)
         account_google_id, signal_value
       FROM account_signals
       WHERE signal_name = 'account_suspended' ${uf.clause}
       ORDER BY account_google_id, captured_at DESC
     ) latest
     WHERE (signal_value->'value'->>'1') = 'true'
        OR (signal_value->>'1') = 'true'`,
    uf.params,
  );
  return parseInt(result.rows[0]?.['count'] as string, 10);
}
