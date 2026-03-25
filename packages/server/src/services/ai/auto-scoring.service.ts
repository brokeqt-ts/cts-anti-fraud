import type pg from 'pg';
import { BanPredictor } from '../ml/ban-predictor.js';
import { getAccountFeatures, getAllActiveFeatures } from '../feature-extraction.service.js';
import * as predictionsRepo from '../../repositories/predictions.repository.js';
import { notifyOwnerAndAdmins, formatCid } from '../notification.service.js';

let predictor: BanPredictor | null = null;

async function getPredictor(pool: pg.Pool): Promise<BanPredictor | null> {
  if (!predictor) {
    predictor = new BanPredictor();
    const loaded = await predictor.loadModel(pool);
    if (!loaded) return null;
  }
  return predictor.isReady() ? predictor : null;
}

/**
 * Score a single account after new data arrives.
 * Called from collect service after processing new data.
 */
export async function scoreAccountOnUpdate(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<void> {
  try {
    const p = await getPredictor(pool);
    if (!p) return; // Model not trained yet

    const features = await getAccountFeatures(pool, accountGoogleId);
    if (!features) return;

    const result = p.predict(features);
    await predictionsRepo.savePrediction(pool, accountGoogleId, result, p.getModelVersion());

    if (result.risk_level === 'critical' || result.risk_level === 'high') {
      console.log(
        `[auto-scoring] High risk detected for ${accountGoogleId}: ${(result.ban_probability * 100).toFixed(1)}% (${result.risk_level})`,
      );

      // Notify owner + admins about elevated risk
      const accountResult = await pool.query(
        `SELECT user_id FROM accounts WHERE google_account_id = $1`,
        [accountGoogleId],
      );
      const ownerUserId = (accountResult.rows[0]?.['user_id'] as string | null) ?? null;
      const pct = (result.ban_probability * 100).toFixed(0);
      notifyOwnerAndAdmins(pool, ownerUserId, {
        type: 'risk_elevated',
        title: `Риск бана ${formatCid(accountGoogleId)}: ${result.risk_level}`,
        message: `Вероятность бана: ${pct}%. Уровень: ${result.risk_level}`,
        severity: 'warning',
        metadata: { account_google_id: accountGoogleId, risk_level: result.risk_level, ban_probability: result.ban_probability },
      }).catch(() => {});
    }
  } catch (err) {
    console.error(`[auto-scoring] Failed to score ${accountGoogleId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Score an account right after a ban is detected.
 * Records a final pre-ban prediction for post-mortem analysis.
 */
export async function scoreAccountOnBan(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<void> {
  try {
    const p = await getPredictor(pool);
    if (!p) return;

    const features = await getAccountFeatures(pool, accountGoogleId);
    if (!features) return;

    const result = p.predict(features);
    await predictionsRepo.savePrediction(pool, accountGoogleId, result, `${p.getModelVersion()}_pre_ban`);

    console.log(
      `[auto-scoring] Pre-ban score for ${accountGoogleId}: ${(result.ban_probability * 100).toFixed(1)}%`,
    );
  } catch (err) {
    console.error(`[auto-scoring] Failed pre-ban scoring for ${accountGoogleId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Batch prediction for all active accounts.
 * Scheduled to run periodically (e.g. every 6 hours).
 */
export async function batchPredictAll(pool: pg.Pool): Promise<{
  total: number;
  scored: number;
  high_risk: number;
}> {
  const p = await getPredictor(pool);
  if (!p) return { total: 0, scored: 0, high_risk: 0 };

  const allFeatures = await getAllActiveFeatures(pool);
  let scored = 0;
  let highRisk = 0;

  for (const features of allFeatures) {
    try {
      const result = p.predict(features);
      await predictionsRepo.savePrediction(pool, features.account_google_id, result, p.getModelVersion());
      scored++;

      if (result.risk_level === 'critical' || result.risk_level === 'high') {
        highRisk++;
      }
    } catch {
      // Skip individual failures
    }
  }

  return { total: allFeatures.length, scored, high_risk: highRisk };
}

/**
 * Reset the singleton predictor (e.g. after retraining).
 */
export function resetPredictor(): void {
  predictor = null;
}
