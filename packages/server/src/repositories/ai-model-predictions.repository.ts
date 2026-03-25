import type pg from 'pg';

export interface AiModelPredictionRow {
  id: string;
  account_google_id: string;
  model_id: string;
  strategy: string | null;
  predicted_ban_prob: number | null;
  predicted_risk_level: string | null;
  predicted_lifetime_days: number | null;
  analysis_type: string;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  actual_outcome: string | null;
  actual_outcome_at: string | null;
  actual_lifetime_days: number | null;
  ban_prediction_correct: boolean | null;
  lifetime_error_days: number | null;
  scored_at: string | null;
  created_at: string;
}

export interface SavePredictionInput {
  account_google_id: string;
  model_id: string;
  strategy: string | null;
  predicted_ban_prob: number | null;
  predicted_risk_level: string | null;
  predicted_lifetime_days: number | null;
  analysis_type: string;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  raw_result: unknown;
}

export async function savePrediction(
  pool: pg.Pool,
  input: SavePredictionInput,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ai_model_predictions (
       account_google_id, model_id, strategy,
       predicted_ban_prob, predicted_risk_level, predicted_lifetime_days,
       analysis_type, latency_ms, tokens_used, cost_usd, raw_result
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      input.account_google_id,
      input.model_id,
      input.strategy,
      input.predicted_ban_prob,
      input.predicted_risk_level,
      input.predicted_lifetime_days,
      input.analysis_type,
      input.latency_ms,
      input.tokens_used,
      input.cost_usd,
      input.raw_result ? JSON.stringify(input.raw_result) : null,
    ],
  );
  return result.rows[0]!['id'] as string;
}

/**
 * Score all pending predictions for an account that was just banned.
 * Sets actual_outcome = 'banned', calculates lifetime and correctness.
 */
export async function scoreOnBan(
  pool: pg.Pool,
  accountGoogleId: string,
  bannedAt: Date,
): Promise<number> {
  const result = await pool.query(
    `UPDATE ai_model_predictions
     SET
       actual_outcome = 'banned',
       actual_outcome_at = $2,
       actual_lifetime_days = GREATEST(0, EXTRACT(DAY FROM ($2::timestamptz - created_at))::int),
       ban_prediction_correct = CASE
         WHEN predicted_ban_prob IS NOT NULL AND predicted_ban_prob > 0.5 THEN true
         WHEN predicted_ban_prob IS NOT NULL THEN false
         ELSE NULL
       END,
       lifetime_error_days = CASE
         WHEN predicted_lifetime_days IS NOT NULL
         THEN ABS(predicted_lifetime_days - GREATEST(0, EXTRACT(DAY FROM ($2::timestamptz - created_at))::int))
         ELSE NULL
       END,
       scored_at = NOW()
     WHERE account_google_id = $1
       AND actual_outcome IS NULL
     RETURNING id`,
    [accountGoogleId, bannedAt.toISOString()],
  );
  return result.rowCount ?? 0;
}

/**
 * Score predictions for accounts that survived > 90 days without ban.
 * Called periodically (e.g., daily cron).
 */
export async function scoreSurvivedAccounts(
  pool: pg.Pool,
): Promise<number> {
  const result = await pool.query(
    `UPDATE ai_model_predictions
     SET
       actual_outcome = 'survived',
       actual_outcome_at = NOW(),
       actual_lifetime_days = EXTRACT(DAY FROM (NOW() - created_at))::int,
       ban_prediction_correct = CASE
         WHEN predicted_ban_prob IS NOT NULL AND predicted_ban_prob <= 0.5 THEN true
         WHEN predicted_ban_prob IS NOT NULL THEN false
         ELSE NULL
       END,
       lifetime_error_days = CASE
         WHEN predicted_lifetime_days IS NOT NULL
         THEN ABS(predicted_lifetime_days - EXTRACT(DAY FROM (NOW() - created_at))::int)
         ELSE NULL
       END,
       scored_at = NOW()
     WHERE actual_outcome IS NULL
       AND created_at < NOW() - INTERVAL '90 days'
     RETURNING id`,
  );
  return result.rowCount ?? 0;
}

/**
 * Get leaderboard metrics per model for a given period.
 */
export interface ModelMetrics {
  model_id: string;
  total_analyses: number;
  scored_count: number;
  correct_count: number;
  accuracy: number | null;
  precision_val: number | null;
  recall_val: number | null;
  avg_lifetime_error_days: number | null;
  avg_latency_ms: number;
  avg_cost_usd: number;
}

export async function getModelMetrics(
  pool: pg.Pool,
  periodDays: number | null,
): Promise<ModelMetrics[]> {
  const periodFilter = periodDays != null
    ? 'AND created_at > NOW() - make_interval(days => $1)'
    : '';
  const params: unknown[] = periodDays != null ? [periodDays] : [];

  const result = await pool.query(
    `SELECT
       model_id,
       COUNT(*)::int AS total_analyses,
       COUNT(*) FILTER (WHERE actual_outcome IS NOT NULL)::int AS scored_count,
       COUNT(*) FILTER (WHERE ban_prediction_correct = true)::int AS correct_count,

       -- True positives: predicted ban (prob > 0.5) AND actually banned
       COUNT(*) FILTER (
         WHERE predicted_ban_prob > 0.5 AND actual_outcome = 'banned'
       )::int AS tp,
       -- False positives: predicted ban (prob > 0.5) AND survived
       COUNT(*) FILTER (
         WHERE predicted_ban_prob > 0.5 AND actual_outcome = 'survived'
       )::int AS fp,
       -- False negatives: predicted no-ban (prob <= 0.5) AND banned
       COUNT(*) FILTER (
         WHERE predicted_ban_prob IS NOT NULL AND predicted_ban_prob <= 0.5 AND actual_outcome = 'banned'
       )::int AS fn,

       AVG(lifetime_error_days) FILTER (WHERE lifetime_error_days IS NOT NULL) AS avg_lifetime_error_days,
       AVG(latency_ms)::int AS avg_latency_ms,
       AVG(cost_usd) AS avg_cost_usd
     FROM ai_model_predictions
     WHERE 1=1 ${periodFilter}
     GROUP BY model_id
     ORDER BY model_id`,
    params,
  );

  return result.rows.map(row => {
    const scoredCount = Number(row['scored_count'] ?? 0);
    const correctCount = Number(row['correct_count'] ?? 0);
    const tp = Number(row['tp'] ?? 0);
    const fp = Number(row['fp'] ?? 0);
    const fn = Number(row['fn'] ?? 0);

    const accuracy = scoredCount > 0 ? correctCount / scoredCount : null;
    const precisionVal = (tp + fp) > 0 ? tp / (tp + fp) : null;
    const recallVal = (tp + fn) > 0 ? tp / (tp + fn) : null;

    return {
      model_id: row['model_id'] as string,
      total_analyses: Number(row['total_analyses'] ?? 0),
      scored_count: scoredCount,
      correct_count: correctCount,
      accuracy,
      precision_val: precisionVal,
      recall_val: recallVal,
      avg_lifetime_error_days: row['avg_lifetime_error_days'] != null
        ? Math.round(Number(row['avg_lifetime_error_days']))
        : null,
      avg_latency_ms: Number(row['avg_latency_ms'] ?? 0),
      avg_cost_usd: Number(row['avg_cost_usd'] ?? 0),
    };
  });
}

/**
 * Get prediction history with pagination.
 */
export async function getPredictionHistory(
  pool: pg.Pool,
  limit: number,
  offset: number,
): Promise<{ rows: AiModelPredictionRow[]; total: number }> {
  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, account_google_id, model_id, strategy,
              predicted_ban_prob, predicted_risk_level, predicted_lifetime_days,
              analysis_type, latency_ms, tokens_used, cost_usd,
              actual_outcome, actual_outcome_at, actual_lifetime_days,
              ban_prediction_correct, lifetime_error_days, scored_at, created_at
       FROM ai_model_predictions
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM ai_model_predictions`),
  ]);

  const total = Number(countResult.rows[0]?.['total'] ?? 0);
  const rows: AiModelPredictionRow[] = dataResult.rows.map(row => ({
    id: row['id'] as string,
    account_google_id: row['account_google_id'] as string,
    model_id: row['model_id'] as string,
    strategy: row['strategy'] as string | null,
    predicted_ban_prob: row['predicted_ban_prob'] != null ? Number(row['predicted_ban_prob']) : null,
    predicted_risk_level: row['predicted_risk_level'] as string | null,
    predicted_lifetime_days: row['predicted_lifetime_days'] != null ? Number(row['predicted_lifetime_days']) : null,
    analysis_type: row['analysis_type'] as string,
    latency_ms: Number(row['latency_ms']),
    tokens_used: Number(row['tokens_used']),
    cost_usd: Number(row['cost_usd']),
    actual_outcome: row['actual_outcome'] as string | null,
    actual_outcome_at: row['actual_outcome_at'] as string | null,
    actual_lifetime_days: row['actual_lifetime_days'] != null ? Number(row['actual_lifetime_days']) : null,
    ban_prediction_correct: row['ban_prediction_correct'] as boolean | null,
    lifetime_error_days: row['lifetime_error_days'] != null ? Number(row['lifetime_error_days']) : null,
    scored_at: row['scored_at'] as string | null,
    created_at: row['created_at'] as string,
  }));

  return { rows, total };
}
