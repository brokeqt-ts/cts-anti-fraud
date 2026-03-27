import type pg from 'pg';
import { AI_PREDICTION_MODEL } from '@cts/shared';
import type { ModelAdapter, ModelResponse } from './model-adapter.js';
import { getConfiguredAdapters, parseModelResponse } from './model-adapter.js';
import type { AiAnalysisResult, AiAnalysisAction } from './analysis-utils.js';
import {
  ACCOUNT_ANALYSIS_SYSTEM,
  buildAccountAnalysisPrompt,
} from './prompts/account-analysis.prompt.js';
import { getAccountFeatures } from '../feature-extraction.service.js';
import { BanPredictor } from '../ml/ban-predictor.js';
import * as aiRepo from '../../repositories/ai-analysis.repository.js';
import * as ampRepo from '../../repositories/ai-model-predictions.repository.js';
import { getModelWeights } from './leaderboard.service.js';

// --- Types ---

export type AggregationStrategy = 'best_model' | 'majority_vote' | 'weighted_ensemble';

export interface IndividualResult {
  model_id: string;
  model_display: string;
  result: AiAnalysisResult | null;
  error: string | null;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  prediction_id: string | null;
}

export interface ComparisonResult {
  account_google_id: string;
  strategy: AggregationStrategy;
  final_result: AiAnalysisResult;
  individual_results: IndividualResult[];
  consensus: {
    agreement_level: number;
    divergence_points: string[];
    all_agree_on_confidence: boolean;
  };
  models_used: string[];
  models_failed: Array<{ model_id: string; error: string }>;
  total_cost_usd: number;
  generated_at: string;
}

// --- Helpers for data fetching (shared with ai-analyzer) ---

async function getNotifications(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<Array<{ title: string; category: string }>> {
  const result = await pool.query(
    `SELECT title, category FROM notification_details
     WHERE account_google_id = $1 AND created_at > NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC LIMIT 20`,
    [accountGoogleId],
  );
  return result.rows.map(r => ({
    title: r['title'] as string,
    category: r['category'] as string,
  }));
}

async function getCampaignSummary(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<{ total: number; active: number; paused: number }> {
  // campaigns.status is integer from Google Ads proto; 3 = active (consistent with MV convention)
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT campaign_id)::int AS total,
       COUNT(DISTINCT campaign_id) FILTER (WHERE status = 3)::int AS active,
       COUNT(DISTINCT campaign_id) FILTER (WHERE status = 2)::int AS paused
     FROM campaigns WHERE account_google_id = $1`,
    [accountGoogleId],
  );
  const row = result.rows[0] ?? {};
  return {
    total: Number(row['total'] ?? 0),
    active: Number(row['active'] ?? 0),
    paused: Number(row['paused'] ?? 0),
  };
}

// --- Confidence to numeric mapping ---

/** Map confidence/risk level to a pseudo ban probability for outcome scoring. */
function confidenceToBanProb(riskLevel: string): number {
  const map: Record<string, number> = {
    critical: 0.9,
    high: 0.75,
    medium: 0.5,
    low: 0.2,
  };
  return map[riskLevel] ?? 0.5;
}

const CONFIDENCE_SCORE: Record<string, number> = { low: 0, medium: 0.5, high: 1 };

function confidenceToNum(c: string): number {
  return CONFIDENCE_SCORE[c] ?? 0;
}

function numToConfidence(n: number): 'low' | 'medium' | 'high' {
  if (n >= 0.7) return 'high';
  if (n >= 0.35) return 'medium';
  return 'low';
}

// --- Aggregation strategies ---

function aggregateBestModel(
  successful: Array<{ result: AiAnalysisResult; weight: number }>,
): AiAnalysisResult {
  // Pick the one with highest weight (from leaderboard accuracy)
  let best = successful[0]!;
  for (const entry of successful) {
    if (entry.weight > best.weight) {
      best = entry;
    }
  }
  return best.result;
}

function aggregateMajorityVote(
  successful: Array<{ result: AiAnalysisResult; weight: number }>,
): AiAnalysisResult {
  // Vote on confidence level
  const votes: Record<string, number> = { low: 0, medium: 0, high: 0 };
  for (const entry of successful) {
    votes[entry.result.confidence] = (votes[entry.result.confidence] ?? 0) + 1;
  }

  let majorityConfidence: 'low' | 'medium' | 'high' = 'medium';
  let maxVotes = 0;
  for (const [level, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      majorityConfidence = level as 'low' | 'medium' | 'high';
    }
  }

  // Pick the result closest to majority confidence, preferring higher-weighted model
  let bestMatch = successful[0]!;
  let bestScore = -1;
  for (const entry of successful) {
    const confidenceMatch = entry.result.confidence === majorityConfidence ? 10 : 0;
    const score = confidenceMatch + entry.weight;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = entry;
    }
  }

  // Merge: use best match as base, but override confidence with majority
  return {
    ...bestMatch.result,
    confidence: majorityConfidence,
  };
}

function aggregateWeightedEnsemble(
  successful: Array<{ result: AiAnalysisResult; weight: number }>,
): AiAnalysisResult {
  const totalWeight = successful.reduce((s, e) => s + e.weight, 0);
  const normalized = successful.map(e => ({
    ...e,
    w: totalWeight > 0 ? e.weight / totalWeight : 1 / successful.length,
  }));

  // Weighted confidence
  let weightedConfidence = 0;
  for (const entry of normalized) {
    weightedConfidence += confidenceToNum(entry.result.confidence) * entry.w;
  }

  // Pick the highest-weighted model's text fields as base
  const base = normalized.reduce((a, b) => (b.w > a.w ? b : a));

  // Merge all immediate_actions and strategic_recommendations, deduplicate by action_ru
  const allActions = normalized.flatMap(e => e.result.immediate_actions);
  const uniqueActions = deduplicateActions(allActions);

  const allRecs = normalized.flatMap(e => e.result.strategic_recommendations);
  const uniqueRecs = deduplicateActions(allRecs);

  const allPatterns = normalized.flatMap(e => e.result.similar_patterns);
  const uniquePatterns = [...new Set(allPatterns)];

  // Weighted latency/tokens/cost
  let totalLatency = 0;
  let totalTokens = 0;
  for (const entry of normalized) {
    totalLatency += entry.result.latency_ms;
    totalTokens += entry.result.tokens_used;
  }

  return {
    summary_ru: base.result.summary_ru,
    risk_assessment: base.result.risk_assessment,
    immediate_actions: uniqueActions,
    strategic_recommendations: uniqueRecs,
    similar_patterns: uniquePatterns,
    confidence: numToConfidence(weightedConfidence),
    model: `ensemble(${normalized.map(e => e.result.model).join('+')})`,
    tokens_used: totalTokens,
    latency_ms: totalLatency,
  };
}

function deduplicateActions(
  actions: AiAnalysisAction[],
): AiAnalysisAction[] {
  const seen = new Set<string>();
  const result: typeof actions = [];
  for (const a of actions) {
    const key = a.action_ru.toLowerCase().slice(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(a);
    }
  }
  return result;
}

// --- Consensus calculation ---

function calculateConsensus(
  successful: AiAnalysisResult[],
): { agreement_level: number; divergence_points: string[]; all_agree_on_confidence: boolean } {
  if (successful.length <= 1) {
    return { agreement_level: 1, divergence_points: [], all_agree_on_confidence: true };
  }

  const divergence: string[] = [];

  // Check confidence agreement
  const confidences = successful.map(r => r.confidence);
  const allAgree = new Set(confidences).size === 1;
  if (!allAgree) {
    divergence.push(`Уровень уверенности: ${confidences.join(' vs ')}`);
  }

  // Check action count divergence
  const actionCounts = successful.map(r => r.immediate_actions.length);
  const maxActions = Math.max(...actionCounts);
  const minActions = Math.min(...actionCounts);
  if (maxActions - minActions > 2) {
    divergence.push(`Количество срочных действий: от ${minActions} до ${maxActions}`);
  }

  // Check priority distribution divergence
  const criticalCounts = successful.map(
    r => r.immediate_actions.filter(a => a.priority === 'critical').length,
  );
  const hasCritical = criticalCounts.some(c => c > 0);
  const noCritical = criticalCounts.some(c => c === 0);
  if (hasCritical && noCritical) {
    divergence.push('Расхождение по наличию критических действий');
  }

  // Agreement level: 1 = full agreement, 0 = full disagreement
  const confidenceAgreement = allAgree ? 1 : (1 - (new Set(confidences).size - 1) / 2);
  const actionAgreement = maxActions > 0 ? 1 - (maxActions - minActions) / (maxActions + 1) : 1;
  const agreementLevel = Math.round((confidenceAgreement * 0.6 + actionAgreement * 0.4) * 100) / 100;

  return {
    agreement_level: agreementLevel,
    divergence_points: divergence,
    all_agree_on_confidence: allAgree,
  };
}

// --- Main compareModels function ---

export async function compareModels(
  pool: pg.Pool,
  accountGoogleId: string,
  strategy?: AggregationStrategy,
  models?: AI_PREDICTION_MODEL[],
): Promise<ComparisonResult> {
  // Get account data
  const [features, notifications, campaignSummary] = await Promise.all([
    getAccountFeatures(pool, accountGoogleId),
    getNotifications(pool, accountGoogleId),
    getCampaignSummary(pool, accountGoogleId),
  ]);

  if (!features) {
    throw new Error(`Аккаунт ${accountGoogleId} не найден`);
  }

  // Try ML prediction
  let prediction = null;
  try {
    const predictor = new BanPredictor();
    if (await predictor.loadModel(pool)) {
      prediction = predictor.predict(features);
    }
  } catch {
    // optional
  }

  // Load relevant best practices for prompt injection
  let bestPracticesText = '';
  try {
    const vertical = features.offer_vertical ?? '';
    const bpResult = await pool.query(
      `SELECT title, content, category FROM best_practices
       WHERE is_active = true
         AND (offer_vertical IS NULL OR offer_vertical = $1)
       ORDER BY priority DESC LIMIT 5`,
      [vertical],
    );
    if (bpResult.rows.length > 0) {
      bestPracticesText = bpResult.rows.map((r) => {
        const row = r as { title: string; content: string; category: string };
        return `### ${row.title} [${row.category}]\n${row.content}`;
      }).join('\n\n---\n\n');
    }
  } catch { /* optional */ }

  const prompt = buildAccountAnalysisPrompt(features, prediction, notifications, campaignSummary, bestPracticesText);

  // Get adapters
  let adapters: ModelAdapter[];
  if (models && models.length > 0) {
    const configured = getConfiguredAdapters();
    adapters = configured.filter(a => models.includes(a.modelId));
  } else {
    adapters = getConfiguredAdapters();
  }

  if (adapters.length === 0) {
    throw new Error('Нет настроенных моделей. Проверьте API ключи.');
  }

  // Auto-select strategy: if only 1 model, force best_model
  const effectiveStrategy: AggregationStrategy = adapters.length === 1
    ? 'best_model'
    : (strategy ?? 'majority_vote');

  // Run all models in parallel with allSettled for graceful degradation
  const settled = await Promise.allSettled(
    adapters.map(async (adapter): Promise<{ adapter: ModelAdapter; response: ModelResponse; result: AiAnalysisResult; predictionId: string | null }> => {
      const response = await adapter.call(ACCOUNT_ANALYSIS_SYSTEM, prompt);
      const result = parseModelResponse(response);

      // Save to legacy predictions table
      await aiRepo.saveAnalysis(pool, accountGoogleId, 'account', result);

      // Save to ai_model_predictions for outcome tracking (non-blocking for main analysis)
      const riskLevel = result.confidence;
      let predictionId: string | null = null;
      try {
        predictionId = await ampRepo.savePrediction(pool, {
          account_google_id: accountGoogleId,
          model_id: adapter.modelId,
          strategy: effectiveStrategy,
          predicted_ban_prob: confidenceToBanProb(riskLevel),
          predicted_risk_level: riskLevel,
          predicted_lifetime_days: null,
          analysis_type: 'account',
          latency_ms: response.latencyMs,
          tokens_used: response.tokens,
          cost_usd: response.costUsd,
          raw_result: result,
        });
      } catch (saveErr: unknown) {
        console.error(
          `[comparator] Failed to save prediction for ${adapter.modelId}:`,
          saveErr instanceof Error ? saveErr.message : saveErr,
        );
      }

      return { adapter, response, result, predictionId };
    }),
  );

  // Build individual results
  const individualResults: IndividualResult[] = [];
  const modelsUsed: string[] = [];
  const modelsFailed: Array<{ model_id: string; error: string }> = [];

  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i]!;
    const outcome = settled[i]!;

    if (outcome.status === 'fulfilled') {
      const { response, result, predictionId } = outcome.value;
      individualResults.push({
        model_id: adapter.modelId,
        model_display: adapter.displayName,
        result,
        error: null,
        latency_ms: response.latencyMs,
        tokens_used: response.tokens,
        cost_usd: response.costUsd,
        prediction_id: predictionId,
      });
      modelsUsed.push(adapter.modelId);
    } else {
      const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      individualResults.push({
        model_id: adapter.modelId,
        model_display: adapter.displayName,
        result: null,
        error,
        latency_ms: 0,
        tokens_used: 0,
        cost_usd: 0,
        prediction_id: null,
      });
      modelsFailed.push({ model_id: adapter.modelId, error });
    }
  }

  const successfulResults = individualResults.filter(
    (r): r is IndividualResult & { result: AiAnalysisResult } => r.result !== null,
  );

  if (successfulResults.length === 0) {
    throw new Error(`Все модели вернули ошибку: ${modelsFailed.map(f => `${f.model_id}: ${f.error}`).join('; ')}`);
  }

  // Get model weights from leaderboard for aggregation
  const weights = await getModelWeights(pool);

  const weightedResults = successfulResults.map(r => ({
    result: r.result,
    weight: weights[r.model_id as AI_PREDICTION_MODEL] ?? 1,
  }));

  // Aggregate based on strategy
  let finalResult: AiAnalysisResult;
  switch (effectiveStrategy) {
    case 'best_model':
      finalResult = aggregateBestModel(weightedResults);
      break;
    case 'majority_vote':
      finalResult = aggregateMajorityVote(weightedResults);
      break;
    case 'weighted_ensemble':
      finalResult = aggregateWeightedEnsemble(weightedResults);
      break;
  }

  // Consensus
  const consensus = calculateConsensus(successfulResults.map(r => r.result));

  const totalCost = individualResults.reduce((s, r) => s + r.cost_usd, 0);

  return {
    account_google_id: accountGoogleId,
    strategy: effectiveStrategy,
    final_result: finalResult,
    individual_results: individualResults,
    consensus,
    models_used: modelsUsed,
    models_failed: modelsFailed,
    total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
    generated_at: new Date().toISOString(),
  };
}
