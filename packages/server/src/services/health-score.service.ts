/**
 * Account Health Score Service — calculates a 0-100 health score per account.
 *
 * Score starts at 100 and is reduced by risk factors:
 *   - Account status (banned/suspended/under_review)
 *   - Ban history (count + recency)
 *   - Suspended signal from Google Ads
 *   - Policy violation notifications
 *   - Account age (young accounts are riskier)
 *   - High-risk vertical
 *   - Missing verification
 *   - No active campaigns
 *
 * Called after each collect batch and on ban detection.
 */

import type pg from 'pg';

interface HealthFactors {
  status: string;
  banCount: number;
  recentBanDays: number | null; // days since last ban, null = never banned
  hasSuspendedSignal: boolean;
  policyViolationCount: number;
  accountAgeDays: number | null;
  verificationStatus: string | null;
  campaignCount: number;
  offerVertical: string | null;
}

const HIGH_RISK_VERTICALS = new Set(['gambling', 'crypto', 'nutra', 'dating', 'sweepstakes']);

export function calculateHealthScore(factors: HealthFactors): number {
  let score = 100;

  // ── Status penalties ──────────────────────────────────────────────────
  if (factors.status === 'banned') score -= 80;
  else if (factors.status === 'suspended') score -= 60;
  else if (factors.status === 'under_review') score -= 20;

  // ── Suspended signal (Google detected issue but account still active) ─
  if (factors.hasSuspendedSignal && factors.status === 'active') score -= 30;

  // ── Ban history ───────────────────────────────────────────────────────
  if (factors.banCount > 0) {
    score -= Math.min(factors.banCount * 15, 60);
  }
  // Recent ban = extra penalty
  if (factors.recentBanDays !== null && factors.recentBanDays < 7) score -= 15;
  else if (factors.recentBanDays !== null && factors.recentBanDays < 30) score -= 5;

  // ── Policy violation notifications ─────────────────────────────────────
  if (factors.policyViolationCount > 0) {
    score -= Math.min(factors.policyViolationCount * 5, 25);
  }

  // ── Account age ───────────────────────────────────────────────────────
  if (factors.accountAgeDays !== null) {
    if (factors.accountAgeDays < 3) score -= 15;
    else if (factors.accountAgeDays < 7) score -= 10;
    else if (factors.accountAgeDays < 30) score -= 5;
  }

  // ── High-risk vertical ────────────────────────────────────────────────
  if (factors.offerVertical && HIGH_RISK_VERTICALS.has(factors.offerVertical)) {
    score -= 10;
  }

  // ── Missing verification ──────────────────────────────────────────────
  if (!factors.verificationStatus || factors.verificationStatus === 'not_started') {
    score -= 5;
  } else if (factors.verificationStatus === 'failed') {
    score -= 15;
  }

  // ── No campaigns ──────────────────────────────────────────────────────
  if (factors.campaignCount === 0) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate and persist health score for a single account.
 */
export async function updateAccountHealthScore(
  pool: pg.Pool,
  googleAccountId: string,
): Promise<number> {
  const factors = await fetchHealthFactors(pool, googleAccountId);
  const score = calculateHealthScore(factors);

  await pool.query(
    `UPDATE accounts SET health_score = $1, updated_at = NOW() WHERE google_account_id = $2`,
    [score, googleAccountId],
  );

  return score;
}

/**
 * Batch-update health scores for all accounts.
 */
export async function updateAllHealthScores(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `SELECT google_account_id FROM accounts ORDER BY updated_at DESC`,
  );
  let updated = 0;
  for (const row of result.rows as Array<{ google_account_id: string }>) {
    try {
      await updateAccountHealthScore(pool, row.google_account_id);
      updated++;
    } catch {
      // Skip individual failures
    }
  }
  return updated;
}

async function fetchHealthFactors(pool: pg.Pool, googleAccountId: string): Promise<HealthFactors> {
  const accResult = await pool.query(
    `SELECT status::text, account_age_days, verification_status::text,
            campaign_count, offer_vertical
     FROM accounts WHERE google_account_id = $1`,
    [googleAccountId],
  );
  const acc = accResult.rows[0] as Record<string, unknown> | undefined;

  const banResult = await pool.query(
    `SELECT COUNT(*)::int AS ban_count,
            EXTRACT(DAY FROM (NOW() - MAX(banned_at)))::int AS days_since_last
     FROM ban_logs WHERE account_google_id = $1`,
    [googleAccountId],
  );
  const bans = banResult.rows[0] as { ban_count: number; days_since_last: number | null };

  const signalResult = await pool.query(
    `SELECT signal_value FROM account_signals
     WHERE account_google_id = $1 AND signal_name = 'account_suspended'
     ORDER BY captured_at DESC LIMIT 1`,
    [googleAccountId],
  );
  const suspendedSignal = signalResult.rows[0] as { signal_value: unknown } | undefined;
  const hasSuspendedSignal = suspendedSignal != null && suspendedSignal.signal_value != null
    && String(suspendedSignal.signal_value) !== 'false' && String(suspendedSignal.signal_value) !== '0';

  const notifResult = await pool.query(
    `SELECT COUNT(*)::int AS policy_count FROM notification_details
     WHERE account_google_id = $1
       AND (category = 'CRITICAL' OR notification_type ILIKE '%POLICY%' OR notification_type ILIKE '%SUSPEND%')`,
    [googleAccountId],
  );
  const policyCount = (notifResult.rows[0] as { policy_count: number }).policy_count;

  return {
    status: (acc?.status as string) ?? 'active',
    banCount: bans.ban_count,
    recentBanDays: bans.days_since_last,
    hasSuspendedSignal,
    policyViolationCount: policyCount,
    accountAgeDays: (acc?.account_age_days as number | null) ?? null,
    verificationStatus: (acc?.verification_status as string | null) ?? null,
    campaignCount: (acc?.campaign_count as number) ?? 0,
    offerVertical: (acc?.offer_vertical as string | null) ?? null,
  };
}
