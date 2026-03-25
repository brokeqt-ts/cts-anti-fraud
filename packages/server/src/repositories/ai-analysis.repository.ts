import type pg from 'pg';
import type { AiAnalysisResult } from '../services/ai/analysis-utils.js';

export interface AiAnalysisRow {
  id: string;
  account_google_id: string;
  analysis_type: string;
  model: string;
  summary_ru: string;
  risk_assessment: string;
  immediate_actions: unknown;
  strategic_recommendations: unknown;
  similar_patterns: string[];
  confidence: string;
  tokens_used: number;
  latency_ms: number;
  created_at: string;
}

export async function saveAnalysis(
  pool: pg.Pool,
  accountGoogleId: string,
  analysisType: 'account' | 'ban' | 'comparison',
  result: AiAnalysisResult,
): Promise<string> {
  const insertResult = await pool.query(
    `INSERT INTO predictions (account_id, model, prediction_type, input_hash, ban_probability, actual_result)
     SELECT a.id, 'claude'::ai_prediction_model, 'risk_score'::prediction_type, $2, NULL, $3
     FROM accounts a WHERE a.google_account_id = $1
     RETURNING id`,
    [
      accountGoogleId,
      `ai_${analysisType}_${accountGoogleId}_${new Date().toISOString().slice(0, 10)}`,
      JSON.stringify({
        analysis_type: analysisType,
        summary_ru: result.summary_ru,
        risk_assessment: result.risk_assessment,
        immediate_actions: result.immediate_actions,
        strategic_recommendations: result.strategic_recommendations,
        similar_patterns: result.similar_patterns,
        confidence: result.confidence,
        model: result.model,
        tokens_used: result.tokens_used,
        latency_ms: result.latency_ms,
      }),
    ],
  );

  // If account not found in accounts table, insert without account_id
  if (insertResult.rowCount === 0) {
    const fallback = await pool.query(
      `INSERT INTO predictions (account_id, model, prediction_type, input_hash, ban_probability, actual_result)
       VALUES (NULL, 'claude'::ai_prediction_model, 'risk_score'::prediction_type, $1, NULL, $2)
       RETURNING id`,
      [
        `ai_${analysisType}_${accountGoogleId}_${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify({
          analysis_type: analysisType,
          summary_ru: result.summary_ru,
          risk_assessment: result.risk_assessment,
          immediate_actions: result.immediate_actions,
          strategic_recommendations: result.strategic_recommendations,
          similar_patterns: result.similar_patterns,
          confidence: result.confidence,
          model: result.model,
          tokens_used: result.tokens_used,
          latency_ms: result.latency_ms,
        }),
      ],
    );
    return fallback.rows[0]!['id'] as string;
  }

  return insertResult.rows[0]!['id'] as string;
}

export async function getAnalysisHistory(
  pool: pg.Pool,
  accountGoogleId: string,
  limit = 10,
): Promise<AiAnalysisRow[]> {
  const result = await pool.query(
    `SELECT p.id, a.google_account_id AS account_google_id,
            p.model::text, p.prediction_type::text, p.actual_result, p.created_at
     FROM predictions p
     JOIN accounts a ON a.id = p.account_id
     WHERE a.google_account_id = $1
       AND p.prediction_type = 'risk_score'
     ORDER BY p.created_at DESC
     LIMIT $2`,
    [accountGoogleId, limit],
  );

  return result.rows.map(row => {
    const ar = (row['actual_result'] as Record<string, unknown>) ?? {};
    return {
      id: row['id'] as string,
      account_google_id: row['account_google_id'] as string,
      analysis_type: (ar['analysis_type'] as string) ?? 'account',
      model: (ar['model'] as string) ?? (row['model'] as string),
      summary_ru: (ar['summary_ru'] as string) ?? '',
      risk_assessment: (ar['risk_assessment'] as string) ?? '',
      immediate_actions: ar['immediate_actions'] ?? [],
      strategic_recommendations: ar['strategic_recommendations'] ?? [],
      similar_patterns: (ar['similar_patterns'] as string[]) ?? [],
      confidence: (ar['confidence'] as string) ?? 'low',
      tokens_used: Number(ar['tokens_used'] ?? 0),
      latency_ms: Number(ar['latency_ms'] ?? 0),
      created_at: row['created_at'] as string,
    };
  });
}

export async function getLatestAnalysis(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<AiAnalysisRow | null> {
  const rows = await getAnalysisHistory(pool, accountGoogleId, 1);
  return rows[0] ?? null;
}
