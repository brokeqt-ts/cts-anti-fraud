import type pg from 'pg';
import { sendCreativeDecayAlert } from './telegram-bot.service.js';
import { notifyOwnerAndAdmins } from './notification.service.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const DECAY_THRESHOLD_PERCENT = 15;
const CRITICAL_DECAY_PERCENT = 30;
const MIN_IMPRESSIONS = 100;
const LOOKBACK_DAYS = 7;
const COMPARE_DAYS = 3;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecayResult {
  campaign_id: string;
  campaign_name: string;
  account_google_id: string;
  ctr_previous: number;
  ctr_current: number;
  decline_percent: number;
  severity: 'warning' | 'critical';
}

export interface SnapshotResult {
  snapshotted: number;
  skipped: number;
}

export interface ScanResult {
  scanned: number;
  decayed: number;
  critical: number;
  results: DecayResult[];
}

// ─── Snapshot: collect daily campaign metrics ────────────────────────────────

/**
 * Take a snapshot of all active campaign metrics for today.
 * Uses keyword_daily_stats (campaign-level aggregates) as the data source.
 * Upserts into creative_snapshots so it's safe to call multiple times per day.
 */
export async function snapshotCreativePerformance(pool: pg.Pool): Promise<SnapshotResult> {
  const result = await pool.query(`
    INSERT INTO creative_snapshots (account_google_id, campaign_id, campaign_name, snapshot_date,
                                     impressions, clicks, ctr, cpc, conversions, cost_micros)
    SELECT
      c.account_google_id,
      c.campaign_id,
      c.campaign_name,
      kds.date AS snapshot_date,
      MAX(CASE WHEN kds.metric_name = 'stats.impressions' THEN kds.metric_value END)::bigint AS impressions,
      MAX(CASE WHEN kds.metric_name = 'stats.clicks' THEN kds.metric_value END)::bigint AS clicks,
      MAX(CASE WHEN kds.metric_name = 'stats.ctr' THEN kds.metric_value END) AS ctr,
      MAX(CASE WHEN kds.metric_name = 'stats.average_cpc' THEN kds.metric_value END) AS cpc,
      0 AS conversions,
      0 AS cost_micros
    FROM keyword_daily_stats kds
    JOIN campaigns c ON c.campaign_id = kds.campaign_id AND c.account_google_id = kds.account_google_id
    WHERE kds.keyword_id IS NULL
      AND kds.campaign_id IS NOT NULL
      AND kds.date >= CURRENT_DATE - INTERVAL '1 day'
    GROUP BY c.account_google_id, c.campaign_id, c.campaign_name, kds.date
    HAVING MAX(CASE WHEN kds.metric_name = 'stats.impressions' THEN kds.metric_value END) IS NOT NULL
    ON CONFLICT (campaign_id, account_google_id, snapshot_date)
    DO UPDATE SET
      campaign_name = EXCLUDED.campaign_name,
      impressions = EXCLUDED.impressions,
      clicks = EXCLUDED.clicks,
      ctr = EXCLUDED.ctr,
      cpc = EXCLUDED.cpc,
      conversions = EXCLUDED.conversions,
      cost_micros = EXCLUDED.cost_micros
  `);

  return { snapshotted: result.rowCount ?? 0, skipped: 0 };
}

// ─── Detect decay ────────────────────────────────────────────────────────────

/**
 * Detect creative decay across all campaigns (or filtered by account/campaign).
 *
 * Algorithm:
 *  - For each campaign with >= LOOKBACK_DAYS + COMPARE_DAYS days of snapshots:
 *    - baseline = avg CTR over LOOKBACK_DAYS preceding the last COMPARE_DAYS
 *    - current  = avg CTR over last COMPARE_DAYS
 *    - decline  = (baseline - current) / baseline * 100
 *    - If decline > DECAY_THRESHOLD_PERCENT → warning
 *    - If decline > CRITICAL_DECAY_PERCENT → critical
 *    - Ignore campaigns with < MIN_IMPRESSIONS total in the compare window
 */
export async function detectDecay(
  pool: pg.Pool,
  accountGoogleId?: string,
  campaignId?: string,
): Promise<ScanResult> {
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (accountGoogleId) {
    params.push(accountGoogleId);
    conditions.push(`cs.account_google_id = $${params.length}`);
  }
  if (campaignId) {
    params.push(campaignId);
    conditions.push(`cs.campaign_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get per-campaign baseline vs current CTR
  const result = await pool.query(`
    WITH campaign_data AS (
      SELECT
        cs.campaign_id,
        cs.campaign_name,
        cs.account_google_id,
        cs.snapshot_date,
        cs.ctr,
        cs.impressions,
        ROW_NUMBER() OVER (PARTITION BY cs.campaign_id, cs.account_google_id ORDER BY cs.snapshot_date DESC) AS rn,
        COUNT(*) OVER (PARTITION BY cs.campaign_id, cs.account_google_id) AS total_days
      FROM creative_snapshots cs
      ${whereClause}
    ),
    baseline AS (
      SELECT
        campaign_id,
        account_google_id,
        AVG(ctr) AS baseline_ctr
      FROM campaign_data
      WHERE rn > ${COMPARE_DAYS} AND rn <= ${COMPARE_DAYS + LOOKBACK_DAYS}
        AND ctr IS NOT NULL
      GROUP BY campaign_id, account_google_id
    ),
    current_period AS (
      SELECT
        campaign_id,
        campaign_name,
        account_google_id,
        AVG(ctr) AS current_ctr,
        SUM(impressions) AS total_impressions
      FROM campaign_data
      WHERE rn <= ${COMPARE_DAYS}
        AND ctr IS NOT NULL
      GROUP BY campaign_id, campaign_name, account_google_id
    )
    SELECT
      cp.campaign_id,
      cp.campaign_name,
      cp.account_google_id,
      b.baseline_ctr,
      cp.current_ctr,
      cp.total_impressions,
      cd.total_days
    FROM current_period cp
    JOIN baseline b ON b.campaign_id = cp.campaign_id AND b.account_google_id = cp.account_google_id
    JOIN (SELECT DISTINCT campaign_id, account_google_id, total_days FROM campaign_data) cd
      ON cd.campaign_id = cp.campaign_id AND cd.account_google_id = cp.account_google_id
    WHERE cd.total_days >= ${COMPARE_DAYS + LOOKBACK_DAYS}
      AND cp.total_impressions >= ${MIN_IMPRESSIONS}
      AND b.baseline_ctr > 0
  `, params);

  const results: DecayResult[] = [];

  for (const row of result.rows) {
    const baselineCtr = Number(row['baseline_ctr']);
    const currentCtr = Number(row['current_ctr']);
    const declinePercent = ((baselineCtr - currentCtr) / baselineCtr) * 100;

    if (declinePercent < DECAY_THRESHOLD_PERCENT) continue;

    const severity: 'warning' | 'critical' = declinePercent >= CRITICAL_DECAY_PERCENT ? 'critical' : 'warning';

    results.push({
      campaign_id: row['campaign_id'] as string,
      campaign_name: (row['campaign_name'] as string) ?? 'Unknown',
      account_google_id: row['account_google_id'] as string,
      ctr_previous: Math.round(baselineCtr * 10000) / 10000,
      ctr_current: Math.round(currentCtr * 10000) / 10000,
      decline_percent: Math.round(declinePercent * 10) / 10,
      severity,
    });
  }

  // Sort critical first, then by decline
  results.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.decline_percent - a.decline_percent;
  });

  return {
    scanned: result.rows.length,
    decayed: results.length,
    critical: results.filter(r => r.severity === 'critical').length,
    results,
  };
}

// ─── Decay trends for an account ─────────────────────────────────────────────

export interface DecayTrend {
  campaign_id: string;
  campaign_name: string;
  data: Array<{ date: string; ctr: number | null; impressions: number }>;
}

export async function getDecayTrends(pool: pg.Pool, accountGoogleId: string, days: number = 30): Promise<DecayTrend[]> {
  const result = await pool.query(`
    SELECT
      campaign_id,
      campaign_name,
      snapshot_date,
      ctr,
      impressions
    FROM creative_snapshots
    WHERE account_google_id = $1
      AND snapshot_date >= CURRENT_DATE - $2::int
    ORDER BY campaign_id, snapshot_date
  `, [accountGoogleId, days]);

  const map = new Map<string, DecayTrend>();

  for (const row of result.rows) {
    const cid = row['campaign_id'] as string;
    if (!map.has(cid)) {
      map.set(cid, {
        campaign_id: cid,
        campaign_name: (row['campaign_name'] as string) ?? 'Unknown',
        data: [],
      });
    }
    map.get(cid)!.data.push({
      date: String(row['snapshot_date']).slice(0, 10),
      ctr: row['ctr'] != null ? Number(row['ctr']) : null,
      impressions: Number(row['impressions'] ?? 0),
    });
  }

  return Array.from(map.values());
}

// ─── Full scan with notifications ────────────────────────────────────────────

/**
 * Run a full decay scan, create notifications and send Telegram alerts for detected decay.
 */
export async function runDecayScanWithAlerts(pool: pg.Pool): Promise<ScanResult> {
  const scan = await detectDecay(pool);

  for (const decay of scan.results) {
    // Dedup is handled by notification service via dedupKey
    // Find account owner
    const ownerResult = await pool.query(
      `SELECT user_id FROM accounts WHERE google_account_id = $1 LIMIT 1`,
      [decay.account_google_id],
    );
    const ownerUserId = (ownerResult.rows[0]?.['user_id'] as string) ?? null;

    // Create in-app notification — dedup is enforced by notification service
    let notifyResult = { sent: 0, skipped: false };
    try {
      notifyResult = await notifyOwnerAndAdmins(pool, ownerUserId, {
        type: 'creative_decay',
        severity: decay.severity,
        title: `Creative Decay: ${decay.campaign_name}`,
        message: `CTR упал на ${decay.decline_percent}% (${(decay.ctr_previous * 100).toFixed(2)}% → ${(decay.ctr_current * 100).toFixed(2)}%)`,
        metadata: {
          account_google_id: decay.account_google_id,
          campaign_id: decay.campaign_id,
          decline_percent: decay.decline_percent,
        },
      });
    } catch {
      // notification failure should not block scan
    }

    // Send Telegram only if a new notification was actually created (not a dedup skip)
    if (notifyResult.sent > 0) {
      try {
        await sendCreativeDecayAlert({
          accountGoogleId: decay.account_google_id,
          campaignName: decay.campaign_name,
          adId: decay.campaign_id,
          ctrPrevious: decay.ctr_previous * 100,
          ctrCurrent: decay.ctr_current * 100,
          declinePercent: decay.decline_percent,
        });
      } catch {
        // telegram failure should not block scan
      }
    }
  }

  return scan;
}
