import type pg from 'pg';
import { BanPredictor } from './ml/ban-predictor.js';
import { getAccountFeatures } from './feature-extraction.service.js';
import { notifyOwnerAndAdmins } from './notification.service.js';
import * as telegram from './telegram-bot.service.js';

/** Minimum ban probability to trigger an alert (default 60%). */
const DEFAULT_THRESHOLD = 0.6;

/**
 * Scan all active accounts with ML predictor and send alerts
 * for accounts with high ban probability.
 *
 * Called on a cron schedule (default: every hour).
 */
export async function runPredictiveAlertScan(
  pool: pg.Pool,
  threshold: number = DEFAULT_THRESHOLD,
): Promise<{ scanned: number; alerted: number }> {
  const predictor = new BanPredictor();
  const loaded = await predictor.loadModel(pool);
  if (!loaded || !predictor.isReady()) {
    return { scanned: 0, alerted: 0 };
  }

  // Get all active (non-banned) accounts
  const accountsResult = await pool.query<Record<string, unknown>>(
    `SELECT google_account_id, user_id
     FROM accounts
     WHERE status NOT IN ('suspended', 'banned', 'closed')
     ORDER BY updated_at DESC`,
  );

  let scanned = 0;
  let alerted = 0;

  for (const row of accountsResult.rows) {
    const googleId = row['google_account_id'] as string;
    const ownerUserId = (row['user_id'] as string | null) ?? null;

    try {
      const features = await getAccountFeatures(pool, googleId);
      if (!features) continue;

      scanned++;
      const result = predictor.predict(features);

      if (result.ban_probability < threshold) continue;

      // Check if we already alerted about this account recently
      // (cooldown is handled by notification.service via settings,
      //  but do a quick check to avoid unnecessary DB queries)
      const recentAlert = await pool.query(
        `SELECT id FROM notifications
         WHERE type = 'predictive_ban_alert'
           AND metadata->>'account_google_id' = $1
           AND created_at > NOW() - INTERVAL '6 hours'
         LIMIT 1`,
        [googleId],
      );
      if (recentAlert.rowCount && recentAlert.rowCount > 0) continue;

      const topFactorLabels = result.top_factors.slice(0, 5).map(f => f.label);
      const pct = (result.ban_probability * 100).toFixed(0);

      // Send in-app + SSE notification
      await notifyOwnerAndAdmins(pool, ownerUserId, {
        type: 'predictive_ban_alert',
        title: `Риск бана ${formatCid(googleId)}: ${pct}%`,
        message: `Вероятность бана: ${pct}%. Факторы: ${topFactorLabels.join(', ')}. ${result.predicted_days_to_ban != null ? `Прогноз: ~${result.predicted_days_to_ban} дн.` : ''}`,
        severity: 'warning',
        metadata: {
          account_google_id: googleId,
          ban_probability: result.ban_probability,
          risk_level: result.risk_level,
          top_factors: topFactorLabels,
          predicted_days_to_ban: result.predicted_days_to_ban,
        },
        dedupKey: `predictive_ban_alert:${googleId}`,
      });

      // Send Telegram alert
      telegram.sendPredictiveBanAlert({
        accountGoogleId: googleId,
        banProbability: result.ban_probability,
        riskLevel: result.risk_level,
        topFactors: topFactorLabels,
        daysToExpectedBan: result.predicted_days_to_ban,
      }).catch(() => {});

      alerted++;
    } catch (err) {
      console.warn(`[predictive-alert] Failed to scan ${googleId}:`, err instanceof Error ? err.message : err);
    }
  }

  return { scanned, alerted };
}

function formatCid(cid: string): string {
  const digits = cid.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return cid;
}
