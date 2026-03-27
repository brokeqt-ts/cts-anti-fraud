import type { FastifyInstance } from 'fastify';
import {
  analyzeAccountHandler,
  analyzeBanHandler,
  compareAccountsHandler,
  analysisHistoryHandler,
  compareModelsHandler,
  leaderboardHandler,
  leaderboardHistoryHandler,
  configuredModelsHandler,
  submitFeedbackHandler,
  getPredictionFeedbackHandler,
  feedbackStatsHandler,
  mockCompareModelsHandler,
  analyzeDomainHandler,
  analyzeRotationHandler,
  analyzeAppealHandler,
  analyzeFarmHandler,
} from '../handlers/ai.handler.js';

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/ai/analyze/:accountId',
    { preHandler: [fastify.authenticate] },
    analyzeAccountHandler,
  );

  fastify.post(
    '/ai/analyze-ban/:banLogId',
    { preHandler: [fastify.authenticate] },
    analyzeBanHandler,
  );

  fastify.post(
    '/ai/compare',
    { preHandler: [fastify.authenticate] },
    compareAccountsHandler,
  );

  fastify.get(
    '/ai/history/:accountId',
    { preHandler: [fastify.authenticate] },
    analysisHistoryHandler,
  );

  // Multi-model comparison
  fastify.post(
    '/ai/compare-models/:accountId',
    { preHandler: [fastify.authenticate] },
    compareModelsHandler,
  );

  // Leaderboard
  fastify.get(
    '/ai/leaderboard',
    { preHandler: [fastify.authenticate] },
    leaderboardHandler,
  );

  fastify.get(
    '/ai/leaderboard/history',
    { preHandler: [fastify.authenticate] },
    leaderboardHistoryHandler,
  );

  // Configured models
  fastify.get(
    '/ai/models',
    { preHandler: [fastify.authenticate] },
    configuredModelsHandler,
  );

  // Specialized prompts: domain audit, rotation, appeal, farm analysis
  fastify.post(
    '/ai/audit-domain/:domainId',
    { preHandler: [fastify.authenticate] },
    analyzeDomainHandler,
  );

  fastify.post(
    '/ai/rotation-strategy/:banLogId',
    { preHandler: [fastify.authenticate] },
    analyzeRotationHandler,
  );

  fastify.post(
    '/ai/appeal-strategy/:banLogId',
    { preHandler: [fastify.authenticate] },
    analyzeAppealHandler,
  );

  fastify.post(
    '/ai/farm-analysis',
    { preHandler: [fastify.authenticate] },
    analyzeFarmHandler,
  );

  // Test-only mock (non-production)
  fastify.post(
    '/ai/mock-compare/:accountId',
    { preHandler: [fastify.authenticate] },
    mockCompareModelsHandler,
  );

  // Feedback
  fastify.post(
    '/ai/predictions/:predictionId/feedback',
    { preHandler: [fastify.authenticate] },
    submitFeedbackHandler,
  );

  fastify.get(
    '/ai/predictions/:predictionId/feedback',
    { preHandler: [fastify.authenticate] },
    getPredictionFeedbackHandler,
  );

  fastify.get(
    '/ai/feedback/stats',
    { preHandler: [fastify.authenticate] },
    feedbackStatsHandler,
  );
}
