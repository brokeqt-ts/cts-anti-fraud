import type pg from 'pg';
import type { PredictionResult } from '../services/ml/ban-predictor.js';

export interface PredictionRow {
  id: string;
  account_google_id: string;
  model: string;
  prediction_type: string;
  ban_probability: number | null;
  predicted_lifetime_days: number | null;
  risk_level: string;
  top_factors: unknown;
  created_at: string;
}

export async function savePrediction(
  pool: pg.Pool,
  accountGoogleId: string,
  result: PredictionResult,
  modelVersion: string,
): Promise<string> {
  const accountResult = await pool.query(
    `SELECT id FROM accounts WHERE google_account_id = $1`,
    [accountGoogleId],
  );
  const accountId = accountResult.rows[0]?.['id'] as string | undefined;

  const inputHash = `${accountGoogleId}_${modelVersion}_${new Date().toISOString().slice(0, 10)}`;

  const insertResult = await pool.query(
    `INSERT INTO predictions (account_id, model, prediction_type, input_hash, ban_probability, predicted_lifetime_days, actual_result)
     VALUES ($1, 'claude', 'ban_probability', $2, $3, $4, $5)
     RETURNING id`,
    [
      accountId ?? null,
      inputHash,
      result.ban_probability,
      result.predicted_days_to_ban,
      JSON.stringify({
        risk_level: result.risk_level,
        confidence: result.confidence,
        top_factors: result.top_factors,
        model_version: modelVersion,
      }),
    ],
  );

  return insertResult.rows[0]!['id'] as string;
}

export async function getLatestPrediction(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<PredictionRow | null> {
  const result = await pool.query(
    `SELECT p.id, a.google_account_id AS account_google_id, p.model::text, p.prediction_type::text,
            p.ban_probability, p.predicted_lifetime_days, p.actual_result, p.created_at
     FROM predictions p
     JOIN accounts a ON a.id = p.account_id
     WHERE a.google_account_id = $1
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [accountGoogleId],
  );

  if (result.rowCount === 0) return null;
  const row = result.rows[0]!;
  const actualResult = row['actual_result'] as Record<string, unknown> | null;

  return {
    id: row['id'] as string,
    account_google_id: row['account_google_id'] as string,
    model: row['model'] as string,
    prediction_type: row['prediction_type'] as string,
    ban_probability: row['ban_probability'] != null ? Number(row['ban_probability']) : null,
    predicted_lifetime_days: row['predicted_lifetime_days'] != null ? Number(row['predicted_lifetime_days']) : null,
    risk_level: (actualResult?.['risk_level'] as string) ?? 'unknown',
    top_factors: actualResult?.['top_factors'] ?? [],
    created_at: row['created_at'] as string,
  };
}

export async function getPredictionHistory(
  pool: pg.Pool,
  accountGoogleId: string,
  limit = 20,
): Promise<PredictionRow[]> {
  const result = await pool.query(
    `SELECT p.id, a.google_account_id AS account_google_id, p.model::text, p.prediction_type::text,
            p.ban_probability, p.predicted_lifetime_days, p.actual_result, p.created_at
     FROM predictions p
     JOIN accounts a ON a.id = p.account_id
     WHERE a.google_account_id = $1
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [accountGoogleId, limit],
  );

  return result.rows.map(row => {
    const actualResult = row['actual_result'] as Record<string, unknown> | null;
    return {
      id: row['id'] as string,
      account_google_id: row['account_google_id'] as string,
      model: row['model'] as string,
      prediction_type: row['prediction_type'] as string,
      ban_probability: row['ban_probability'] != null ? Number(row['ban_probability']) : null,
      predicted_lifetime_days: row['predicted_lifetime_days'] != null ? Number(row['predicted_lifetime_days']) : null,
      risk_level: (actualResult?.['risk_level'] as string) ?? 'unknown',
      top_factors: actualResult?.['top_factors'] ?? [],
      created_at: row['created_at'] as string,
    };
  });
}

export async function getPredictionSummary(
  pool: pg.Pool,
  userId?: string,
): Promise<{ total: number; by_risk_level: Record<string, number> }> {
  const userFilter = userId
    ? `AND p.account_id IN (SELECT id FROM accounts WHERE user_id = $1)`
    : '';
  const params = userId ? [userId] : [];
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE p.ban_probability < 0.25)::int AS low,
       COUNT(*) FILTER (WHERE p.ban_probability >= 0.25 AND p.ban_probability < 0.5)::int AS medium,
       COUNT(*) FILTER (WHERE p.ban_probability >= 0.5 AND p.ban_probability < 0.75)::int AS high,
       COUNT(*) FILTER (WHERE p.ban_probability >= 0.75)::int AS critical
     FROM predictions p
     WHERE p.created_at > NOW() - INTERVAL '24 hours' ${userFilter}`,
    params,
  );

  const row = result.rows[0] ?? {};
  return {
    total: Number(row['total'] ?? 0),
    by_risk_level: {
      low: Number(row['low'] ?? 0),
      medium: Number(row['medium'] ?? 0),
      high: Number(row['high'] ?? 0),
      critical: Number(row['critical'] ?? 0),
    },
  };
}
