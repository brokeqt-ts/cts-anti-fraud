import type pg from 'pg';

export interface AiFeedbackRow {
  id: string;
  prediction_id: string;
  user_id: string;
  rating: number;
  feedback_type: string;
  comment: string | null;
  correct_outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateFeedbackInput {
  prediction_id: string;
  user_id: string;
  rating: number;
  feedback_type?: string;
  comment?: string | null;
  correct_outcome?: string | null;
}

export interface ModelFeedbackStats {
  model_id: string;
  total: number;
  likes: number;
  dislikes: number;
  avg_rating: number;
  corrections_count: number;
}

export interface PredictionFeedbackStats {
  likes: number;
  dislikes: number;
  corrections: number;
}

/**
 * Upsert feedback (one vote per user per prediction).
 */
export async function upsertFeedback(
  pool: pg.Pool,
  input: CreateFeedbackInput,
): Promise<AiFeedbackRow> {
  const result = await pool.query(
    `INSERT INTO ai_feedback (prediction_id, user_id, rating, feedback_type, comment, correct_outcome)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (prediction_id, user_id)
     DO UPDATE SET
       rating = EXCLUDED.rating,
       feedback_type = EXCLUDED.feedback_type,
       comment = COALESCE(EXCLUDED.comment, ai_feedback.comment),
       correct_outcome = COALESCE(EXCLUDED.correct_outcome, ai_feedback.correct_outcome),
       updated_at = now()
     RETURNING *`,
    [
      input.prediction_id,
      input.user_id,
      input.rating,
      input.feedback_type ?? 'rating',
      input.comment ?? null,
      input.correct_outcome ?? null,
    ],
  );
  return mapRow(result.rows[0]!);
}

/**
 * Get all feedback for a prediction.
 */
export async function findByPrediction(
  pool: pg.Pool,
  predictionId: string,
): Promise<AiFeedbackRow[]> {
  const result = await pool.query(
    `SELECT * FROM ai_feedback WHERE prediction_id = $1 ORDER BY created_at DESC`,
    [predictionId],
  );
  return result.rows.map(mapRow);
}

/**
 * Get aggregated stats for a prediction.
 */
export async function getPredictionStats(
  pool: pg.Pool,
  predictionId: string,
): Promise<PredictionFeedbackStats> {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE rating = 1) AS likes,
       COUNT(*) FILTER (WHERE rating = -1) AS dislikes,
       COUNT(*) FILTER (WHERE correct_outcome IS NOT NULL) AS corrections
     FROM ai_feedback
     WHERE prediction_id = $1`,
    [predictionId],
  );
  const row = result.rows[0]!;
  return {
    likes: Number(row['likes']),
    dislikes: Number(row['dislikes']),
    corrections: Number(row['corrections']),
  };
}

/**
 * Get feedback for a user (paginated).
 */
export async function findByUser(
  pool: pg.Pool,
  userId: string,
  limit: number,
  offset: number,
): Promise<AiFeedbackRow[]> {
  const result = await pool.query(
    `SELECT * FROM ai_feedback WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return result.rows.map(mapRow);
}

/**
 * Get aggregated feedback stats per model.
 */
export async function getModelFeedbackStats(
  pool: pg.Pool,
  modelName?: string,
  periodDays?: number,
): Promise<ModelFeedbackStats[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (modelName) {
    conditions.push(`amp.model_id = $${idx++}`);
    params.push(modelName);
  }

  if (periodDays) {
    conditions.push(`af.created_at > NOW() - INTERVAL '${periodDays} days'`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT
       amp.model_id,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE af.rating = 1)::int AS likes,
       COUNT(*) FILTER (WHERE af.rating = -1)::int AS dislikes,
       ROUND(AVG(af.rating)::numeric, 4) AS avg_rating,
       COUNT(*) FILTER (WHERE af.correct_outcome IS NOT NULL)::int AS corrections_count
     FROM ai_feedback af
     JOIN ai_model_predictions amp ON amp.id = af.prediction_id
     ${where}
     GROUP BY amp.model_id
     ORDER BY total DESC`,
    params,
  );

  return result.rows.map((row) => ({
    model_id: row['model_id'] as string,
    total: Number(row['total']),
    likes: Number(row['likes']),
    dislikes: Number(row['dislikes']),
    avg_rating: Number(row['avg_rating']),
    corrections_count: Number(row['corrections_count']),
  }));
}

/**
 * Get user's existing vote for a prediction (or null).
 */
export async function getUserVote(
  pool: pg.Pool,
  predictionId: string,
  userId: string,
): Promise<AiFeedbackRow | null> {
  const result = await pool.query(
    `SELECT * FROM ai_feedback WHERE prediction_id = $1 AND user_id = $2`,
    [predictionId, userId],
  );
  return result.rows.length > 0 ? mapRow(result.rows[0]!) : null;
}

function mapRow(row: Record<string, unknown>): AiFeedbackRow {
  return {
    id: row['id'] as string,
    prediction_id: row['prediction_id'] as string,
    user_id: row['user_id'] as string,
    rating: Number(row['rating']),
    feedback_type: row['feedback_type'] as string,
    comment: (row['comment'] as string) ?? null,
    correct_outcome: (row['correct_outcome'] as string) ?? null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}
