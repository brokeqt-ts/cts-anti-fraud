import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { AIAnalyzer } from '../services/ai/ai-analyzer.js';
import * as aiRepo from '../repositories/ai-analysis.repository.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { compareModels } from '../services/ai/model-comparator.js';
import type { AggregationStrategy } from '../services/ai/model-comparator.js';
import { getConfiguredAdapters, getAllAdapters } from '../services/ai/model-adapter.js';
import { calculateLeaderboardSummary, getLeaderboard } from '../services/ai/leaderboard.service.js';
import * as feedbackService from '../services/ai/feedback.service.js';
import type { AI_PREDICTION_MODEL } from '@cts/shared';
import { getUserIdFilter } from '../utils/user-scope.js';

// Singleton analyzer instance
const analyzer = new AIAnalyzer();

export async function analyzeAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  try {
    const comparison = await analyzer.analyzeAccount(pool, accountId);

    // Backward-compatible: top-level fields = final_result (AiAnalysisResult shape)
    // _comparison = extended multi-model data for updated frontend
    await reply.status(200).send({
      ...comparison.final_result,
      _comparison: {
        strategy: comparison.strategy,
        individual_results: comparison.individual_results,
        consensus: comparison.consensus,
        models_used: comparison.models_used,
        models_failed: comparison.models_failed,
        total_cost_usd: comparison.total_cost_usd,
        generated_at: comparison.generated_at,
      },
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeAccountHandler', accountId }, 'AI analysis failed');
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('не найден') ? 404 : 500;
    await reply.status(status).send({
      error: message,
      code: status === 404 ? 'NOT_FOUND' : 'AI_ANALYSIS_ERROR',
    });
  }
}

export async function analyzeBanHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { banLogId } = request.params as { banLogId: string };

  // Verify buyer owns the ban's account
  const userId = getUserIdFilter(request);
  if (userId) {
    const banResult = await pool.query(
      `SELECT bl.account_google_id FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1 AND a.user_id = $2`,
      [banLogId, userId],
    );
    if (banResult.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  try {
    const result = await analyzer.analyzeBan(pool, banLogId);

    // Get account_google_id from ban log for saving
    const banResult = await pool.query(
      `SELECT account_google_id FROM ban_logs WHERE id = $1`,
      [banLogId],
    );
    const accountGoogleId = banResult.rows[0]?.['account_google_id'] as string | undefined;
    if (accountGoogleId) {
      await aiRepo.saveAnalysis(pool, accountGoogleId, 'ban', result);
    }

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeBanHandler', banLogId }, 'Ban AI analysis failed');
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('не найден') ? 404 : 500;
    await reply.status(status).send({
      error: message,
      code: status === 404 ? 'NOT_FOUND' : 'AI_ANALYSIS_ERROR',
    });
  }
}

export async function compareAccountsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_ids } = request.body as { account_ids: string[] };

  // Verify buyer owns ALL accounts in the comparison
  const userId = getUserIdFilter(request);
  if (userId) {
    for (const accId of account_ids) {
      const owned = await accountsRepo.getAccountIdByGoogleId(pool, accId, userId);
      if (!owned) {
        await reply.status(404).send({ error: `Account ${accId} not found`, code: 'NOT_FOUND' });
        return;
      }
    }
  }

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  if (!Array.isArray(account_ids) || account_ids.length < 2) {
    await reply.status(400).send({
      error: 'Нужно минимум 2 аккаунта для сравнения',
      code: 'INVALID_INPUT',
    });
    return;
  }

  if (account_ids.length > 10) {
    await reply.status(400).send({
      error: 'Максимум 10 аккаунтов для сравнения',
      code: 'INVALID_INPUT',
    });
    return;
  }

  try {
    const result = await analyzer.compareAccounts(pool, account_ids);

    // Save for each account
    for (const id of account_ids) {
      await aiRepo.saveAnalysis(pool, id, 'comparison', result);
    }

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'compareAccountsHandler' }, 'Comparison failed');
    const message = err instanceof Error ? err.message : String(err);
    await reply.status(500).send({
      error: message,
      code: 'AI_ANALYSIS_ERROR',
    });
  }
}

export async function compareModelsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };
  const query = request.query as { models?: string; strategy?: string };
  const modelList = query.models ? query.models.split(',') as AI_PREDICTION_MODEL[] : undefined;
  const validStrategies = ['best_model', 'majority_vote', 'weighted_ensemble'];
  const strategy = validStrategies.includes(query.strategy ?? '')
    ? query.strategy as AggregationStrategy
    : undefined;

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  try {
    const result = await compareModels(pool, accountId, strategy, modelList);
    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'compareModelsHandler', accountId }, 'Model comparison failed');
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('не найден') ? 404 : 500;
    await reply.status(status).send({ error: message, code: status === 404 ? 'NOT_FOUND' : 'COMPARISON_ERROR' });
  }
}

export async function leaderboardHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { period } = request.query as { period?: string };

  try {
    const summary = await calculateLeaderboardSummary(pool, period);
    await reply.status(200).send(summary);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'leaderboardHandler' }, 'Leaderboard calculation failed');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

export async function leaderboardHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { period } = request.query as { period?: string };

  try {
    const entries = await getLeaderboard(pool, period);
    await reply.status(200).send({ entries });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'leaderboardHistoryHandler' }, 'Failed to get leaderboard');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

export async function configuredModelsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const allAdapters = getAllAdapters();
  const models = allAdapters.map(a => ({
    model: a.modelId,
    display_name: a.displayName,
    status: a.isConfigured() ? 'active' as const : 'not_configured' as const,
  }));

  await reply.status(200).send({
    models,
    total: allAdapters.length,
    configured: models.filter(m => m.status === 'active').length,
  });
}

export async function analysisHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const history = await aiRepo.getAnalysisHistory(pool, accountId);
    await reply.status(200).send({ analyses: history });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analysisHistoryHandler' }, 'Failed to get history');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

// ─── Feedback Handlers ───────────────────────────────────────────────────────

export async function submitFeedbackHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { predictionId } = request.params as { predictionId: string };
  const { rating, comment, correct_outcome } = request.body as {
    rating: number;
    comment?: string;
    correct_outcome?: string;
  };

  if (rating !== -1 && rating !== 0 && rating !== 1) {
    await reply.status(400).send({ error: 'Rating must be -1, 0, or 1', code: 'INVALID_INPUT' });
    return;
  }

  const userId = request.user?.id;
  if (!userId) {
    await reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  try {
    const result = await feedbackService.submitFeedback(pool, {
      predictionId,
      userId,
      rating,
      comment,
      correctOutcome: correct_outcome,
    });

    await reply.status(200).send({
      id: result.feedback.id,
      created_at: result.feedback.created_at,
      updated_outcome: result.updated_outcome,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Prediction not found') {
      await reply.status(404).send({ error: message, code: 'NOT_FOUND' });
      return;
    }
    request.log.error({ err, handler: 'submitFeedbackHandler' }, 'Failed to submit feedback');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

export async function getPredictionFeedbackHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { predictionId } = request.params as { predictionId: string };

  try {
    const result = await feedbackService.getPredictionFeedback(pool, predictionId);

    // Include current user's vote if authenticated
    let my_vote: number | null = null;
    const userId = request.user?.id;
    if (userId) {
      const vote = await feedbackService.getUserVote(pool, predictionId, userId);
      my_vote = vote?.rating ?? null;
    }

    await reply.status(200).send({
      feedbacks: result.feedbacks,
      stats: result.stats,
      my_vote,
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'getPredictionFeedbackHandler' }, 'Failed to get feedback');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

export async function feedbackStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as { model?: string; period?: string };

  let periodDays: number | undefined;
  if (query.period) {
    const match = query.period.match(/^(\d+)d$/);
    if (match) periodDays = parseInt(match[1]!, 10);
  }

  try {
    const stats = await feedbackService.getModelStats(pool, query.model, periodDays);
    await reply.status(200).send({ stats });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'feedbackStatsHandler' }, 'Failed to get feedback stats');
    await reply.status(500).send({ error: 'Internal error', code: 'INTERNAL_ERROR' });
  }
}

// ─── Test-only: mock comparison result for UI testing without AI keys ────────

export async function mockCompareModelsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (env.NODE_ENV === 'production') {
    await reply.status(404).send({ error: 'Not found' });
    return;
  }

  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  // Fetch real predictions from DB for this account (or any if accountId = 'test')
  const predQuery = accountId === 'test'
    ? `SELECT id, model_id, predicted_risk_level, latency_ms, tokens_used, cost_usd, created_at
       FROM ai_model_predictions ORDER BY created_at DESC LIMIT 3`
    : `SELECT id, model_id, predicted_risk_level, latency_ms, tokens_used, cost_usd, created_at
       FROM ai_model_predictions WHERE account_google_id = $1 ORDER BY created_at DESC LIMIT 3`;

  const predResult = await pool.query(predQuery, accountId === 'test' ? [] : [accountId]);

  if (predResult.rows.length === 0) {
    await reply.status(404).send({
      error: 'No test predictions found. Insert test data into ai_model_predictions first.',
      code: 'NO_TEST_DATA',
    });
    return;
  }

  const mockResults = predResult.rows.map((row) => {
    const r = row as {
      id: string; model_id: string; predicted_risk_level: string | null;
      latency_ms: number; tokens_used: number; cost_usd: number;
    };
    const confidence = r.predicted_risk_level === 'high' ? 'high'
      : r.predicted_risk_level === 'medium' ? 'medium' : 'low';

    return {
      model_id: r.model_id,
      model_display: r.model_id.charAt(0).toUpperCase() + r.model_id.slice(1),
      result: {
        summary_ru: `[ТЕСТ] Анализ модели ${r.model_id}. Это тестовые данные для проверки UI фидбека.`,
        risk_assessment: `Уровень риска: ${confidence}. Тестовый анализ.`,
        immediate_actions: [
          { priority: 'high', action_ru: 'Тестовое действие 1', reasoning_ru: 'Проверка UI', estimated_impact: 'Высокий' },
          { priority: 'medium', action_ru: 'Тестовое действие 2', reasoning_ru: 'Проверка UI', estimated_impact: 'Средний' },
        ],
        strategic_recommendations: [
          { priority: 'low', action_ru: 'Тестовая рекомендация', reasoning_ru: 'Проверка UI', estimated_impact: 'Низкий' },
        ],
        similar_patterns: ['Тестовый паттерн'],
        confidence,
        model: r.model_id,
        tokens_used: Number(r.tokens_used),
        latency_ms: Number(r.latency_ms),
      },
      error: null,
      latency_ms: Number(r.latency_ms),
      tokens_used: Number(r.tokens_used),
      cost_usd: Number(r.cost_usd),
      prediction_id: r.id,
    };
  });

  const totalCost = mockResults.reduce((s, r) => s + r.cost_usd, 0);

  await reply.status(200).send({
    account_google_id: accountId,
    strategy: 'best_model',
    final_result: mockResults[0]!.result,
    individual_results: mockResults,
    consensus: {
      agreement_level: 0.8,
      divergence_points: ['[ТЕСТ] Расхождение по уровню уверенности'],
      all_agree_on_confidence: mockResults.length === 1,
    },
    models_used: mockResults.map(r => r.model_id),
    models_failed: [],
    total_cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
    generated_at: new Date().toISOString(),
  });
}
