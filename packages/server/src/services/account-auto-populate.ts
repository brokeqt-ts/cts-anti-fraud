import type pg from 'pg';

/**
 * Auto-populate missing account fields from available data:
 * - account_age_days: calculated from first_seen_at (earliest raw_payload)
 * - daily_spend_limit / billing_threshold_micros: from billing_info.threshold_micros
 * - first_seen_at: backfilled from raw_payloads min(created_at)
 */

// ─── Account Age ───────────────────────────────────────────────────────────

/**
 * Calculate and update account_age_days from the earliest raw payload timestamp.
 * Also sets first_seen_at if not yet populated.
 */
export async function updateAccountAge(pool: pg.Pool, googleAccountId: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT MIN(created_at) AS first_seen FROM raw_payloads WHERE profile_id = $1`,
    [googleAccountId],
  );

  const firstSeen = result.rows[0]?.['first_seen'] as string | null;
  if (!firstSeen) return null;

  const ageDays = Math.floor((Date.now() - new Date(firstSeen).getTime()) / (1000 * 60 * 60 * 24));

  await pool.query(
    `UPDATE accounts
     SET account_age_days = $1,
         first_seen_at = COALESCE(first_seen_at, $2::timestamptz),
         updated_at = NOW()
     WHERE google_account_id = $3`,
    [ageDays, firstSeen, googleAccountId],
  );

  return ageDays;
}

// ─── Payment Limits ────────────────────────────────────────────────────────

/**
 * Extract and denormalize billing threshold from billing_info to accounts table.
 * threshold_micros is in millionths of the currency unit (e.g., 50000000 = $50).
 */
export async function updatePaymentLimits(pool: pg.Pool, googleAccountId: string): Promise<number | null> {
  const result = await pool.query(
    `SELECT threshold_micros
     FROM billing_info
     WHERE account_google_id = $1
     ORDER BY captured_at DESC
     LIMIT 1`,
    [googleAccountId],
  );

  const thresholdMicros = result.rows[0]?.['threshold_micros'] as string | number | null;
  if (!thresholdMicros) return null;

  const micros = typeof thresholdMicros === 'string' ? parseInt(thresholdMicros, 10) : thresholdMicros;
  if (isNaN(micros) || micros <= 0) return null;

  const limitCurrency = micros / 1_000_000;

  await pool.query(
    `UPDATE accounts
     SET daily_spend_limit = $1,
         billing_threshold_micros = $2,
         updated_at = NOW()
     WHERE google_account_id = $3`,
    [limitCurrency, micros, googleAccountId],
  );

  return limitCurrency;
}

// ─── Batch Update ──────────────────────────────────────────────────────────

/**
 * Run all auto-population updates for a single account.
 * Called from collect.service.ts after processing a batch.
 */
export async function autoPopulateAccount(pool: pg.Pool, googleAccountId: string): Promise<void> {
  await Promise.all([
    updateAccountAge(pool, googleAccountId),
    updatePaymentLimits(pool, googleAccountId),
  ]);
}
