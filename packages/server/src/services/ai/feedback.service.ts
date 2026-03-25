import type pg from 'pg';
import * as feedbackRepo from '../../repositories/ai-feedback.repository.js';

export type { AiFeedbackRow, ModelFeedbackStats, PredictionFeedbackStats } from '../../repositories/ai-feedback.repository.js';

export interface SubmitFeedbackInput {
  predictionId: string;
  userId: string;
  rating: number;
  comment?: string;
  correctOutcome?: string;
}

export interface SubmitFeedbackResult {
  feedback: feedbackRepo.AiFeedbackRow;
  updated_outcome: boolean;
}

/**
 * Submit or update feedback for an AI prediction.
 * - Validates prediction exists
 * - Upserts (one vote per user per prediction)
 * - If correctOutcome provided, updates ai_model_predictions.actual_outcome
 */
export async function submitFeedback(
  pool: pg.Pool,
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  // Validate prediction exists
  const pred = await pool.query(
    `SELECT id FROM ai_model_predictions WHERE id = $1`,
    [input.predictionId],
  );
  if (pred.rowCount === 0) {
    throw new Error('Prediction not found');
  }

  // Determine feedback_type
  const feedbackType = input.correctOutcome
    ? 'correction'
    : input.comment
      ? 'comment'
      : 'rating';

  const feedback = await feedbackRepo.upsertFeedback(pool, {
    prediction_id: input.predictionId,
    user_id: input.userId,
    rating: input.rating,
    feedback_type: feedbackType,
    comment: input.comment ?? null,
    correct_outcome: input.correctOutcome ?? null,
  });

  // If correctOutcome provided, update the prediction's actual_outcome
  let updatedOutcome = false;
  if (input.correctOutcome) {
    await pool.query(
      `UPDATE ai_model_predictions
       SET actual_outcome = $1, actual_outcome_at = NOW()
       WHERE id = $2 AND actual_outcome IS NULL`,
      [input.correctOutcome, input.predictionId],
    );
    updatedOutcome = true;
  }

  return { feedback, updated_outcome: updatedOutcome };
}

/**
 * Get feedback list + stats for a prediction.
 */
export async function getPredictionFeedback(
  pool: pg.Pool,
  predictionId: string,
): Promise<{
  feedbacks: feedbackRepo.AiFeedbackRow[];
  stats: feedbackRepo.PredictionFeedbackStats;
}> {
  const [feedbacks, stats] = await Promise.all([
    feedbackRepo.findByPrediction(pool, predictionId),
    feedbackRepo.getPredictionStats(pool, predictionId),
  ]);
  return { feedbacks, stats };
}

/**
 * Get aggregated model feedback stats.
 */
export async function getModelStats(
  pool: pg.Pool,
  modelName?: string,
  periodDays?: number,
): Promise<feedbackRepo.ModelFeedbackStats[]> {
  return feedbackRepo.getModelFeedbackStats(pool, modelName, periodDays);
}

/**
 * Get user's existing vote for a prediction.
 */
export async function getUserVote(
  pool: pg.Pool,
  predictionId: string,
  userId: string,
): Promise<feedbackRepo.AiFeedbackRow | null> {
  return feedbackRepo.getUserVote(pool, predictionId, userId);
}
