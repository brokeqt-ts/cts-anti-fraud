import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface AutoResolvedDomain {
  domain: string | null;
}

export interface LifetimeHoursResult {
  lifetime_hours: number | null;
}

export interface AccountSnapshot {
  account: Record<string, unknown> | null;
  signals: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  snapshot_taken_at: string;
}

export interface BanRow {
  [key: string]: unknown;
}

export interface BanListResult {
  total: number;
  bans: BanRow[];
}

export interface BanListFilters {
  account_google_id?: string;
  offer_vertical?: string;
  ban_target?: string;
  from_date?: string;
  to_date?: string;
  limit: number;
  offset: number;
  userId?: string;
}

export interface BanInsertParams {
  account_google_id: string;
  ban_date: string;
  ban_reason_google: string | null;
  ban_target: string;
  lifetime_hours: number | null;
  snapshot: string;
  offer_vertical: string | null;
  campaign_type: string | null;
  domain: string | null;
  ban_reason_internal: string | null;
}

export interface BanUpdateField {
  key: string;
  column: string;
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * Auto-resolve domain from account's most recent ad if not provided.
 */
export async function resolveAccountDomain(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT COALESCE(display_url, (final_urls->>0)::text) AS domain
     FROM ads WHERE account_google_id = $1
     ORDER BY captured_at DESC LIMIT 1`,
    [accountGoogleId],
  );
  return (result.rows[0]?.['domain'] as string | undefined) ?? null;
}

/**
 * Calculate lifetime_hours: hours from earliest campaign start_date to ban_date.
 * Fallback to first raw_payload created_at if no campaigns exist.
 */
export async function calculateLifetimeHours(
  pool: pg.Pool,
  accountGoogleId: string,
  banDate: string,
): Promise<number | null> {
  // start_date from Google Ads is stored as "YYYYMMDDHHmmss" — use TO_TIMESTAMP for correct parsing.
  // Fallback chain: earliest Google campaign start → earliest raw_payload capture.
  const result = await pool.query(
    `SELECT COALESCE(
       (SELECT EXTRACT(EPOCH FROM ($2::timestamptz - MIN(TO_TIMESTAMP(SUBSTRING(start_date, 1, 8), 'YYYYMMDD')))) / 3600
        FROM campaigns
        WHERE account_google_id = $1
          AND start_date IS NOT NULL
          AND LENGTH(start_date) >= 8
          AND start_date ~ '^[0-9]{8}'),
       (SELECT EXTRACT(EPOCH FROM ($2::timestamptz - MIN(created_at))) / 3600
        FROM raw_payloads WHERE profile_id = $1)
     ) AS lifetime_hours`,
    [accountGoogleId, banDate],
  );
  const val = result.rows[0]?.['lifetime_hours'];
  return val ? Math.round(Number(val)) : null;
}

/**
 * Build snapshot: current account state + latest signals + latest notifications.
 */
export async function buildAccountSnapshot(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<AccountSnapshot> {
  const [accountSnap, signalsSnap, notificationsSnap] = await Promise.all([
    pool.query(
      `SELECT * FROM accounts WHERE google_account_id = $1`,
      [accountGoogleId],
    ),
    pool.query(
      `SELECT signal_name, signal_value, captured_at
       FROM account_signals
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 50`,
      [accountGoogleId],
    ),
    pool.query(
      `SELECT notifications, captured_at
       FROM account_notifications
       WHERE account_google_id = $1
       ORDER BY captured_at DESC
       LIMIT 5`,
      [accountGoogleId],
    ),
  ]);

  return {
    account: (accountSnap.rows[0] as Record<string, unknown>) ?? null,
    signals: signalsSnap.rows as Record<string, unknown>[],
    notifications: notificationsSnap.rows as Record<string, unknown>[],
    snapshot_taken_at: new Date().toISOString(),
  };
}

/**
 * Insert a new ban log record.
 */
export async function insertBan(
  pool: pg.Pool,
  params: BanInsertParams,
): Promise<BanRow> {
  const result = await pool.query(
    `INSERT INTO ban_logs (
       account_google_id, is_banned, banned_at, ban_reason,
       ban_target, lifetime_hours, snapshot,
       offer_vertical, campaign_type, domain, ban_reason_internal
     ) VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      params.account_google_id,
      params.ban_date,
      params.ban_reason_google,
      params.ban_target,
      params.lifetime_hours,
      params.snapshot,
      params.offer_vertical,
      params.campaign_type,
      params.domain,
      params.ban_reason_internal,
    ],
  );
  return result.rows[0] as BanRow;
}

/**
 * Update a ban log record dynamically based on provided fields.
 * Returns the updated row, or null if not found.
 */
export async function updateBan(
  pool: pg.Pool,
  id: string,
  fields: Array<{ column: string; value: unknown }>,
): Promise<BanRow | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  for (const { column, value } of fields) {
    setClauses.push(`${column} = $${paramIdx++}`);
    params.push(value);
  }

  setClauses.push('updated_at = NOW()');
  params.push(id);

  const result = await pool.query(
    `UPDATE ban_logs SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
    params,
  );

  return (result.rows[0] as BanRow) ?? null;
}

/**
 * List bans with optional filters, pagination, and total count.
 */
export async function listBans(
  pool: pg.Pool,
  filters: BanListFilters,
): Promise<BanListResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // User data isolation: buyer sees only bans for their accounts
  if (filters.userId) {
    conditions.push(`bl.account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $${paramIdx++})`);
    params.push(filters.userId);
  }
  if (filters.account_google_id) {
    conditions.push(`bl.account_google_id = $${paramIdx++}`);
    params.push(filters.account_google_id);
  }
  if (filters.offer_vertical) {
    conditions.push(`bl.offer_vertical = $${paramIdx++}`);
    params.push(filters.offer_vertical);
  }
  if (filters.ban_target) {
    conditions.push(`bl.ban_target = $${paramIdx++}`);
    params.push(filters.ban_target);
  }
  if (filters.from_date) {
    conditions.push(`bl.banned_at >= $${paramIdx++}::date`);
    params.push(filters.from_date);
  }
  if (filters.to_date) {
    conditions.push(`bl.banned_at < ($${paramIdx++}::date + interval '1 day')`);
    params.push(filters.to_date);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM ban_logs bl ${where}`,
    params,
  );

  const result = await pool.query(
    `SELECT bl.id, bl.account_google_id, bl.banned_at, bl.ban_target, bl.ban_reason,
            bl.ban_reason_internal, bl.offer_vertical,
            COALESCE(bl.domain, (
              SELECT COALESCE(ads.display_url, (ads.final_urls->>0)::text)
              FROM ads WHERE ads.account_google_id = bl.account_google_id
              ORDER BY ads.captured_at DESC LIMIT 1
            )) AS domain,
            bl.campaign_type, bl.lifetime_hours, bl.source,
            bl.post_mortem_generated_at, bl.created_at
     FROM ban_logs bl
     ${where}
     ORDER BY bl.banned_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, filters.limit, filters.offset],
  );

  return {
    total: parseInt(countResult.rows[0]?.['total'] as string, 10),
    bans: result.rows as BanRow[],
  };
}

/**
 * Get a single ban by ID. When userId is provided, only returns ban
 * if it belongs to an account owned by that user.
 */
export async function getBanById(
  pool: pg.Pool,
  id: string,
  userId?: string,
): Promise<BanRow | null> {
  const conditions = ['bl.id = $1'];
  const params: unknown[] = [id];
  if (userId) {
    conditions.push('bl.account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $2)');
    params.push(userId);
  }
  const result = await pool.query(
    `SELECT bl.* FROM ban_logs bl WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return (result.rows[0] as BanRow) ?? null;
}
