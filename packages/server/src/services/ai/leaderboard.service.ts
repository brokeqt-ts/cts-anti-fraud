import type pg from 'pg';
import { AI_PREDICTION_MODEL } from '@cts/shared';
import * as ampRepo from '../../repositories/ai-model-predictions.repository.js';
import * as feedbackRepo from '../../repositories/ai-feedback.repository.js';

// --- Types ---

export interface LeaderboardEntry {
  model: string;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  avg_lifetime_error_days: number | null;
  avg_latency_ms: number;
  avg_cost_usd: number;
  total_analyses: number;
  scored_count: number;
  composite_score: number;
  feedback_count: number;
  user_satisfaction: number | null;
}

export interface LeaderboardSummary {
  period: string;
  period_days: number | null;
  entries: LeaderboardEntry[];
  has_outcomes: boolean;
}

// --- Composite score calculation ---

/**
 * Composite score for ranking models.
 *
 * If outcomes exist:
 *   score = accuracy * 0.4 + precision * 0.2 + recall * 0.2
 *           + (1 - normalized_lifetime_error) * 0.1
 *           + (1 - normalized_latency) * 0.05
 *           + (1 - normalized_cost) * 0.05
 *
 * If no outcomes (0 bans recorded):
 *   score = (1 - normalized_latency) * 0.5 + (1 - normalized_cost) * 0.5
 */
function computeCompositeScores(
  metrics: ampRepo.ModelMetrics[],
  feedbackMap: Map<string, feedbackRepo.ModelFeedbackStats>,
): LeaderboardEntry[] {
  if (metrics.length === 0) return [];

  const hasOutcomes = metrics.some(m => m.scored_count > 0);

  // Normalization helpers — find max values for relative scoring
  const maxLatency = Math.max(...metrics.map(m => m.avg_latency_ms), 1);
  const maxCost = Math.max(...metrics.map(m => m.avg_cost_usd), 0.0001);
  const maxLifetimeError = Math.max(
    ...metrics.map(m => m.avg_lifetime_error_days ?? 0),
    1,
  );

  return metrics.map(m => {
    const normLatency = m.avg_latency_ms / maxLatency;
    const normCost = m.avg_cost_usd / maxCost;
    const normLifetimeError = (m.avg_lifetime_error_days ?? maxLifetimeError) / maxLifetimeError;

    // User satisfaction from feedback (only if > 5 votes)
    const fb = feedbackMap.get(m.model_id);
    const feedbackCount = fb?.total ?? 0;
    const hasFeedback = feedbackCount >= 5;
    const satisfaction = hasFeedback
      ? fb!.likes / (fb!.likes + fb!.dislikes || 1)
      : null;

    let compositeScore: number;

    if (hasOutcomes && m.scored_count > 0) {
      const accuracy = m.accuracy ?? 0;
      const precision = m.precision_val ?? 0;
      const recall = m.recall_val ?? 0;

      // With feedback: accuracy 35%, precision 15%, recall 15%, satisfaction 10%, lifetime 10%, latency 7.5%, cost 7.5%
      // Without feedback: accuracy 40%, precision 20%, recall 20%, lifetime 10%, latency 5%, cost 5%
      if (hasFeedback && satisfaction != null) {
        compositeScore =
          accuracy * 0.35 +
          precision * 0.15 +
          recall * 0.15 +
          satisfaction * 0.10 +
          (1 - normLifetimeError) * 0.10 +
          (1 - normLatency) * 0.075 +
          (1 - normCost) * 0.075;
      } else {
        compositeScore =
          accuracy * 0.4 +
          precision * 0.2 +
          recall * 0.2 +
          (1 - normLifetimeError) * 0.1 +
          (1 - normLatency) * 0.05 +
          (1 - normCost) * 0.05;
      }
    } else {
      // No outcomes yet — rank by speed, cost, and satisfaction
      if (hasFeedback && satisfaction != null) {
        compositeScore =
          satisfaction * 0.2 +
          (1 - normLatency) * 0.4 +
          (1 - normCost) * 0.4;
      } else {
        compositeScore = (1 - normLatency) * 0.5 + (1 - normCost) * 0.5;
      }
    }

    return {
      model: m.model_id,
      accuracy: m.accuracy != null ? Math.round(m.accuracy * 10000) / 10000 : null,
      precision: m.precision_val != null ? Math.round(m.precision_val * 10000) / 10000 : null,
      recall: m.recall_val != null ? Math.round(m.recall_val * 10000) / 10000 : null,
      avg_lifetime_error_days: m.avg_lifetime_error_days,
      avg_latency_ms: m.avg_latency_ms,
      avg_cost_usd: Math.round(m.avg_cost_usd * 1_000_000) / 1_000_000,
      total_analyses: m.total_analyses,
      scored_count: m.scored_count,
      composite_score: Math.round(compositeScore * 10000) / 10000,
      feedback_count: feedbackCount,
      user_satisfaction: satisfaction != null ? Math.round(satisfaction * 10000) / 10000 : null,
    };
  }).sort((a, b) => b.composite_score - a.composite_score);
}

// --- Period parsing ---

function parsePeriodDays(period?: string): { days: number | null; label: string } {
  if (!period || period === 'all') return { days: null, label: 'all' };
  const match = period.match(/^(\d+)d$/);
  if (match) return { days: parseInt(match[1]!, 10), label: period };
  // Support "7d", "30d", or plain number
  const num = parseInt(period, 10);
  if (!isNaN(num) && num > 0) return { days: num, label: `${num}d` };
  return { days: 30, label: '30d' };
}

// --- Public API ---

/**
 * Calculate leaderboard summary from ai_model_predictions.
 */
export async function calculateLeaderboardSummary(
  pool: pg.Pool,
  period?: string,
): Promise<LeaderboardSummary> {
  const { days, label } = parsePeriodDays(period);
  const [metrics, feedbackStats] = await Promise.all([
    ampRepo.getModelMetrics(pool, days),
    feedbackRepo.getModelFeedbackStats(pool, undefined, days ?? undefined).catch(() => []),
  ]);

  const feedbackMap = new Map(feedbackStats.map(fs => [fs.model_id, fs]));
  const entries = computeCompositeScores(metrics, feedbackMap);
  const hasOutcomes = metrics.some(m => m.scored_count > 0);

  // Write composite scores to ai_leaderboard for weighted strategies
  for (const entry of entries) {
    await recordMetric(pool, entry.model, 'composite_score', entry.composite_score, label);
  }

  return { period: label, period_days: days, entries, has_outcomes: hasOutcomes };
}

/**
 * Record a metric to the ai_leaderboard table (for historical tracking).
 */
export async function recordMetric(
  pool: pg.Pool,
  model: string,
  metricType: string,
  score: number,
  period: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai_leaderboard (model, metric_type, score, period)
     VALUES ($1::ai_prediction_model, $2, $3, $4)`,
    [model, metricType, score, period],
  );
}

/**
 * Get raw leaderboard entries from ai_leaderboard table.
 */
export async function getLeaderboard(
  pool: pg.Pool,
  period?: string,
): Promise<Array<{ model: string; metric_type: string; score: number; period: string; calculated_at: string }>> {
  const periodFilter = period ? 'AND period = $1' : '';
  const params = period ? [period] : [];

  const result = await pool.query(
    `SELECT model::text, metric_type, score, period, calculated_at
     FROM ai_leaderboard
     WHERE 1=1 ${periodFilter}
     ORDER BY calculated_at DESC
     LIMIT 100`,
    params,
  );

  return result.rows.map(row => ({
    model: row['model'] as string,
    metric_type: row['metric_type'] as string,
    score: Number(row['score']),
    period: row['period'] as string,
    calculated_at: row['calculated_at'] as string,
  }));
}

/**
 * Get model weights for aggregation strategies.
 * Uses composite_score from ai_leaderboard (last 30 days).
 * Falls back to equal weights (1.0) if no data.
 */
export async function getModelWeights(
  pool: pg.Pool,
): Promise<Record<AI_PREDICTION_MODEL, number>> {
  const defaults: Record<AI_PREDICTION_MODEL, number> = {
    [AI_PREDICTION_MODEL.CLAUDE]: 1,
    [AI_PREDICTION_MODEL.OPENAI]: 1,
    [AI_PREDICTION_MODEL.GEMINI]: 1,
  };

  try {
    const result = await pool.query(
      `SELECT model::text, score
       FROM ai_leaderboard
       WHERE metric_type = 'composite_score'
         AND calculated_at > NOW() - INTERVAL '30 days'
       ORDER BY calculated_at DESC`,
    );

    if (result.rowCount === 0) return defaults;

    const seen = new Set<string>();
    for (const row of result.rows) {
      const model = row['model'] as AI_PREDICTION_MODEL;
      if (!seen.has(model)) {
        seen.add(model);
        defaults[model] = Math.max(0.1, Number(row['score']));
      }
    }
  } catch {
    // If query fails, use equal weights
  }

  return defaults;
}

/**
 * Score predictions when a ban is detected.
 * Called from auto-ban-detector.
 */
export async function scoreOnBanDetected(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<number> {
  return ampRepo.scoreOnBan(pool, accountGoogleId, new Date());
}

/**
 * Score predictions for long-surviving accounts (>90 days).
 * Called periodically (e.g., daily cron).
 */
export async function scoreSurvivedAccounts(
  pool: pg.Pool,
): Promise<number> {
  return ampRepo.scoreSurvivedAccounts(pool);
}
