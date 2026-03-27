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
import {
  SPECIALIZED_SYSTEM,
  buildRotationStrategyPrompt,
  buildDomainAuditPrompt,
  buildAppealStrategyPrompt,
  buildFarmAnalysisPrompt,
  type ConsumableData,
  type FarmAccount,
} from '../services/ai/prompts/specialized.prompt.js';
import type { DomainAnalysisData } from '../services/ai/prompts/account-analysis.prompt.js';
import { getAccountFeatures } from '../services/feature-extraction.service.js';
import { BanPredictor } from '../services/ml/ban-predictor.js';

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

// ─── Specialized AI Handlers ──────────────────────────────────────────────────

/** Helper: call first available adapter with SPECIALIZED_SYSTEM, parse raw JSON response. */
async function callSpecializedAI(systemPrompt: string, userPrompt: string): Promise<unknown> {
  const adapters = getConfiguredAdapters();
  if (adapters.length === 0) {
    throw new Error('Нет настроенных API ключей моделей');
  }
  const adapter = adapters[0]!;
  const response = await adapter.call(systemPrompt, userPrompt);
  return JSON.parse(response.text) as unknown;
}

/** Helper: fetch domain_content_analysis row for a given domain_id UUID. */
async function fetchDomainAnalysis(
  pool: import('pg').Pool,
  domainId: string,
): Promise<DomainAnalysisData | null> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT
       d.domain_name,
       dca.content_risk_score,
       dca.keyword_risk_score,
       dca.compliance_score,
       dca.structure_risk_score,
       dca.has_privacy_policy,
       dca.has_terms_of_service,
       dca.has_disclaimer,
       dca.has_age_verification,
       dca.has_countdown_timer,
       dca.has_fake_reviews,
       dca.has_before_after,
       dca.has_hidden_text,
       dca.redirect_count,
       dca.url_mismatch,
       dca.analysis_summary,
       COALESCE(dca.red_flags, '[]'::jsonb) AS red_flags,
       COALESCE(dca.keyword_matches, '[]'::jsonb) AS keyword_matches
     FROM domain_content_analysis dca
     JOIN domains d ON d.id = dca.domain_id
     WHERE dca.domain_id = $1
     ORDER BY dca.analyzed_at DESC
     LIMIT 1`,
    [domainId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0]!;
  return {
    domain_name: r['domain_name'] as string,
    content_risk_score: r['content_risk_score'] != null ? Number(r['content_risk_score']) : null,
    keyword_risk_score: r['keyword_risk_score'] != null ? Number(r['keyword_risk_score']) : null,
    compliance_score: r['compliance_score'] != null ? Number(r['compliance_score']) : null,
    structure_risk_score: r['structure_risk_score'] != null ? Number(r['structure_risk_score']) : null,
    has_privacy_policy: Boolean(r['has_privacy_policy']),
    has_terms_of_service: Boolean(r['has_terms_of_service']),
    has_disclaimer: Boolean(r['has_disclaimer']),
    has_age_verification: Boolean(r['has_age_verification']),
    has_countdown_timer: Boolean(r['has_countdown_timer']),
    has_fake_reviews: Boolean(r['has_fake_reviews']),
    has_before_after: Boolean(r['has_before_after']),
    has_hidden_text: Boolean(r['has_hidden_text']),
    redirect_count: Number(r['redirect_count'] ?? 0),
    url_mismatch: Boolean(r['url_mismatch']),
    analysis_summary: (r['analysis_summary'] as string | null) ?? null,
    red_flags: (r['red_flags'] as DomainAnalysisData['red_flags']) ?? [],
    keyword_matches: (r['keyword_matches'] as DomainAnalysisData['keyword_matches']) ?? [],
  };
}

export async function analyzeDomainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domainId } = request.params as { domainId: string };

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  try {
    const domainAnalysis = await fetchDomainAnalysis(pool, domainId);
    if (!domainAnalysis) {
      await reply.status(404).send({ error: 'Domain analysis not found', code: 'NOT_FOUND' });
      return;
    }

    // Fetch offer_vertical and account age from an account using this domain
    const ctxResult = await pool.query<Record<string, unknown>>(
      `SELECT a.offer_vertical, a.created_at
       FROM accounts a
       JOIN ads ad ON ad.account_google_id = a.google_account_id
       JOIN domains d ON d.id = $1 AND ad.final_urls::text ILIKE '%' || d.domain_name || '%'
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [domainId],
    );
    const ctxRow = ctxResult.rows[0];
    const offerVertical = ctxRow ? (ctxRow['offer_vertical'] as string | null) : null;
    const accountAge = ctxRow
      ? Math.floor((Date.now() - new Date(ctxRow['created_at'] as string).getTime()) / 86400000)
      : null;

    const prompt = buildDomainAuditPrompt(domainAnalysis, offerVertical, accountAge);
    const result = await callSpecializedAI(SPECIALIZED_SYSTEM, prompt);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeDomainHandler', domainId }, 'Domain audit failed');
    const message = err instanceof Error ? err.message : String(err);
    await reply.status(500).send({ error: message, code: 'AI_ANALYSIS_ERROR' });
  }
}

export async function analyzeRotationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { banLogId } = request.params as { banLogId: string };

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  // Verify ownership
  const userId = getUserIdFilter(request);
  if (userId) {
    const ownerCheck = await pool.query(
      `SELECT bl.id FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1 AND a.user_id = $2`,
      [banLogId, userId],
    );
    if (ownerCheck.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const banResult = await pool.query<Record<string, unknown>>(
      `SELECT bl.account_google_id, bl.ban_reason, bl.banned_at, a.created_at AS account_created_at
       FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1`,
      [banLogId],
    );
    if (banResult.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }

    const ban = banResult.rows[0]!;
    const accountGoogleId = ban['account_google_id'] as string;
    const bannedAt = new Date(ban['banned_at'] as string);
    const createdAt = new Date(ban['account_created_at'] as string);
    const lifetimeHours = Math.round((bannedAt.getTime() - createdAt.getTime()) / 3_600_000);

    const features = await getAccountFeatures(pool, accountGoogleId);
    if (!features) {
      await reply.status(404).send({ error: `Account features not found`, code: 'NOT_FOUND' });
      return;
    }

    // Fetch consumables (proxy, antidetect, payment)
    const consumablesResult = await pool.query<Record<string, unknown>>(
      `SELECT
         p.proxy_type,
         p.geo AS proxy_geo,
         p.provider AS proxy_provider,
         p.ip_address AS proxy_ip,
         ap.browser_type AS antidetect_browser,
         COUNT(ap2.id) FILTER (WHERE ap2.id IS NOT NULL) AS fingerprint_change_count,
         MAX(ap.updated_at)::text AS fingerprint_last_changed_at,
         pm.bin AS payment_bin,
         pm.provider_bank AS payment_bank,
         pm.country AS payment_card_country
       FROM account_consumables ac
       JOIN accounts a ON a.id = ac.account_id
       LEFT JOIN proxies p ON p.id = ac.proxy_id
       LEFT JOIN antidetect_profiles ap ON ap.id = ac.antidetect_profile_id
       LEFT JOIN antidetect_profiles ap2 ON ap2.id = ac.antidetect_profile_id AND ap2.updated_at > ac.linked_at
       LEFT JOIN payment_methods pm ON pm.id = ac.payment_method_id
       WHERE a.google_account_id = $1 AND ac.unlinked_at IS NULL
       GROUP BY p.proxy_type, p.geo, p.provider, p.ip_address, ap.browser_type, ap.updated_at, pm.bin, pm.provider_bank, pm.country
       LIMIT 1`,
      [accountGoogleId],
    );

    const cr = consumablesResult.rows[0];
    const consumables: ConsumableData = {
      proxy_type: cr ? (cr['proxy_type'] as string | null) : null,
      proxy_geo: cr ? (cr['proxy_geo'] as string | null) : null,
      proxy_provider: cr ? (cr['proxy_provider'] as string | null) : null,
      proxy_ip: cr ? (cr['proxy_ip'] as string | null) : null,
      antidetect_browser: cr ? (cr['antidetect_browser'] as string | null) : null,
      fingerprint_change_count: cr ? Number(cr['fingerprint_change_count'] ?? 0) : 0,
      fingerprint_last_changed_at: cr ? (cr['fingerprint_last_changed_at'] as string | null) : null,
      payment_bin: cr ? (cr['payment_bin'] as string | null) : null,
      payment_bank: cr ? (cr['payment_bank'] as string | null) : null,
      payment_card_country: cr ? (cr['payment_card_country'] as string | null) : null,
    };

    // Fetch connected accounts (sharing BIN, domain, or proxy)
    const connectedResult = await pool.query<Record<string, unknown>>(
      `SELECT DISTINCT a2.google_account_id,
         CASE
           WHEN pm.bin IS NOT NULL AND pm.bin = pm2.bin THEN 'BIN'
           WHEN p.ip_address IS NOT NULL AND p.ip_address = p2.ip_address THEN 'proxy'
           ELSE 'domain'
         END AS shared_what
       FROM accounts a2
       JOIN account_consumables ac2 ON ac2.account_id = a2.id AND ac2.unlinked_at IS NULL
       LEFT JOIN payment_methods pm2 ON pm2.id = ac2.payment_method_id
       LEFT JOIN proxies p2 ON p2.id = ac2.proxy_id
       JOIN account_consumables ac ON ac.account_id = (
         SELECT id FROM accounts WHERE google_account_id = $1
       ) AND ac.unlinked_at IS NULL
       LEFT JOIN payment_methods pm ON pm.id = ac.payment_method_id
       LEFT JOIN proxies p ON p.id = ac.proxy_id
       WHERE a2.google_account_id != $1
         AND (
           (pm.bin IS NOT NULL AND pm.bin = pm2.bin)
           OR (p.ip_address IS NOT NULL AND p.ip_address = p2.ip_address)
         )
       LIMIT 10`,
      [accountGoogleId],
    );
    const connectedAccounts = connectedResult.rows.map(r => ({
      google_account_id: r['google_account_id'] as string,
      shared_what: r['shared_what'] as string,
    }));

    const prompt = buildRotationStrategyPrompt(
      accountGoogleId,
      ban['ban_reason'] as string | null,
      lifetimeHours,
      features,
      consumables,
      connectedAccounts,
    );
    const result = await callSpecializedAI(SPECIALIZED_SYSTEM, prompt);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeRotationHandler', banLogId }, 'Rotation strategy failed');
    const message = err instanceof Error ? err.message : String(err);
    await reply.status(500).send({ error: message, code: 'AI_ANALYSIS_ERROR' });
  }
}

export async function analyzeAppealHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { banLogId } = request.params as { banLogId: string };
  const body = request.body as { fixes_applied?: string[] } | undefined;
  const fixesApplied: string[] = body?.fixes_applied ?? [];

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  // Verify ownership
  const userId = getUserIdFilter(request);
  if (userId) {
    const ownerCheck = await pool.query(
      `SELECT bl.id FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1 AND a.user_id = $2`,
      [banLogId, userId],
    );
    if (ownerCheck.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const banResult = await pool.query<Record<string, unknown>>(
      `SELECT bl.account_google_id, bl.ban_reason, bl.banned_at, a.created_at AS account_created_at
       FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1`,
      [banLogId],
    );
    if (banResult.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }

    const ban = banResult.rows[0]!;
    const accountGoogleId = ban['account_google_id'] as string;
    const bannedAt = new Date(ban['banned_at'] as string);
    const createdAt = new Date(ban['account_created_at'] as string);
    const lifetimeHours = Math.round((bannedAt.getTime() - createdAt.getTime()) / 3_600_000);

    const features = await getAccountFeatures(pool, accountGoogleId);
    if (!features) {
      await reply.status(404).send({ error: 'Account features not found', code: 'NOT_FOUND' });
      return;
    }

    // Fetch domain analysis for the account
    const domainIdResult = await pool.query<Record<string, unknown>>(
      `SELECT dca.domain_id
       FROM ads ad
       JOIN domains d ON ad.final_urls::text ILIKE '%' || d.domain_name || '%'
       JOIN domain_content_analysis dca ON dca.domain_id = d.id
       WHERE ad.account_google_id = $1
       ORDER BY dca.analyzed_at DESC
       LIMIT 1`,
      [accountGoogleId],
    );

    let domainAnalysis: DomainAnalysisData | null = null;
    if (domainIdResult.rows.length > 0) {
      domainAnalysis = await fetchDomainAnalysis(
        pool,
        domainIdResult.rows[0]!['domain_id'] as string,
      );
    }

    const prompt = buildAppealStrategyPrompt(
      accountGoogleId,
      ban['ban_reason'] as string | null,
      lifetimeHours,
      features,
      domainAnalysis,
      fixesApplied,
    );
    const result = await callSpecializedAI(SPECIALIZED_SYSTEM, prompt);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeAppealHandler', banLogId }, 'Appeal strategy failed');
    const message = err instanceof Error ? err.message : String(err);
    await reply.status(500).send({ error: message, code: 'AI_ANALYSIS_ERROR' });
  }
}

export async function analyzeFarmHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_ids } = request.body as { account_ids: string[] };

  if (!Array.isArray(account_ids) || account_ids.length < 2) {
    await reply.status(400).send({ error: 'Нужно минимум 2 аккаунта для анализа фарма', code: 'INVALID_INPUT' });
    return;
  }
  if (account_ids.length > 20) {
    await reply.status(400).send({ error: 'Максимум 20 аккаунтов', code: 'INVALID_INPUT' });
    return;
  }

  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    await reply.status(400).send({ error: 'Нет настроенных API ключей моделей', code: 'NO_MODELS_CONFIGURED' });
    return;
  }

  // Verify ownership
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

  try {
    // Load ML predictor
    let predictor: BanPredictor | null = null;
    try {
      const bp = new BanPredictor();
      if (await bp.loadModel(pool)) predictor = bp;
    } catch { /* optional */ }

    // Fetch features + domain score + ban status for each account
    const accounts: FarmAccount[] = [];
    for (const accountGoogleId of account_ids) {
      const features = await getAccountFeatures(pool, accountGoogleId);
      if (!features) continue;

      const banResult = await pool.query<Record<string, unknown>>(
        `SELECT ban_reason FROM ban_logs
         WHERE account_google_id = $1
         ORDER BY banned_at DESC LIMIT 1`,
        [accountGoogleId],
      );
      const isBanned = banResult.rows.length > 0;
      const banReason = isBanned ? (banResult.rows[0]!['ban_reason'] as string | null) : null;

      const domainResult = await pool.query<Record<string, unknown>>(
        `SELECT d.domain_name, dca.content_risk_score
         FROM ads ad
         JOIN domains d ON ad.final_urls::text ILIKE '%' || d.domain_name || '%'
         LEFT JOIN domain_content_analysis dca ON dca.domain_id = d.id
         WHERE ad.account_google_id = $1
         ORDER BY dca.analyzed_at DESC NULLS LAST
         LIMIT 1`,
        [accountGoogleId],
      );
      const domainRow = domainResult.rows[0];

      const vertResult = await pool.query<Record<string, unknown>>(
        `SELECT offer_vertical FROM accounts WHERE google_account_id = $1`,
        [accountGoogleId],
      );

      let prediction = null;
      if (predictor) {
        try { prediction = predictor.predict(features); } catch { /* skip */ }
      }

      accounts.push({
        id: accountGoogleId,
        features,
        prediction,
        is_banned: isBanned,
        ban_reason: banReason,
        offer_vertical: vertResult.rows[0] ? (vertResult.rows[0]['offer_vertical'] as string | null) : null,
        domain_name: domainRow ? (domainRow['domain_name'] as string | null) : null,
        domain_score: domainRow && domainRow['content_risk_score'] != null
          ? Number(domainRow['content_risk_score'])
          : null,
      });
    }

    if (accounts.length < 2) {
      await reply.status(400).send({ error: 'Нужно минимум 2 аккаунта с данными', code: 'INVALID_INPUT' });
      return;
    }

    // Compute shared infrastructure: BINs, domains, proxies
    const sharedBinsResult = await pool.query<Record<string, unknown>>(
      `SELECT pm.bin, array_agg(DISTINCT a.google_account_id) AS account_ids
       FROM account_consumables ac
       JOIN accounts a ON a.id = ac.account_id
       JOIN payment_methods pm ON pm.id = ac.payment_method_id
       WHERE a.google_account_id = ANY($1)
         AND pm.bin IS NOT NULL
         AND ac.unlinked_at IS NULL
       GROUP BY pm.bin
       HAVING count(DISTINCT a.google_account_id) > 1`,
      [account_ids],
    );

    const sharedProxiesResult = await pool.query<Record<string, unknown>>(
      `SELECT p.ip_address AS proxy_ip, array_agg(DISTINCT a.google_account_id) AS account_ids
       FROM account_consumables ac
       JOIN accounts a ON a.id = ac.account_id
       JOIN proxies p ON p.id = ac.proxy_id
       WHERE a.google_account_id = ANY($1)
         AND p.ip_address IS NOT NULL
         AND ac.unlinked_at IS NULL
       GROUP BY p.ip_address
       HAVING count(DISTINCT a.google_account_id) > 1`,
      [account_ids],
    );

    const sharedDomainsResult = await pool.query<Record<string, unknown>>(
      `SELECT d.domain_name, array_agg(DISTINCT ad.account_google_id) AS account_ids
       FROM ads ad
       JOIN domains d ON ad.final_urls::text ILIKE '%' || d.domain_name || '%'
       WHERE ad.account_google_id = ANY($1)
       GROUP BY d.domain_name
       HAVING count(DISTINCT ad.account_google_id) > 1`,
      [account_ids],
    );

    const sharedInfrastructure = {
      shared_bins: sharedBinsResult.rows.map(r => ({
        bin: r['bin'] as string,
        account_ids: r['account_ids'] as string[],
      })),
      shared_proxies: sharedProxiesResult.rows.map(r => ({
        proxy_ip: r['proxy_ip'] as string,
        account_ids: r['account_ids'] as string[],
      })),
      shared_domains: sharedDomainsResult.rows.map(r => ({
        domain: r['domain_name'] as string,
        account_ids: r['account_ids'] as string[],
      })),
    };

    const prompt = buildFarmAnalysisPrompt(accounts, sharedInfrastructure);
    const result = await callSpecializedAI(SPECIALIZED_SYSTEM, prompt);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeFarmHandler' }, 'Farm analysis failed');
    const message = err instanceof Error ? err.message : String(err);
    await reply.status(500).send({ error: message, code: 'AI_ANALYSIS_ERROR' });
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
