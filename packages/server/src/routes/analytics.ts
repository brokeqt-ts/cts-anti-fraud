import type { FastifyInstance } from 'fastify';
import {
  banTimingHandler,
  analyticsOverviewHandler,
  spendVelocityHandler,
  spendVelocityAllHandler,
  banChainHandler,
  banChainAllHandler,
  consumableScoringHandler,
  creativeDecayHandler,
  creativeDecayScanHandler,
  creativeDecayTrendsHandler,
  postMortemHandler,
  postMortemAllHandler,
  competitiveIntelligenceHandler,
  mvFreshnessHandler,
  accountRiskSummaryHandler,
  banChainGraphHandler,
} from '../handlers/analytics.handler.js';

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/analytics/ban-timing',
    { preHandler: [fastify.authenticate] },
    banTimingHandler,
  );

  fastify.get(
    '/analytics/overview',
    { preHandler: [fastify.authenticate] },
    analyticsOverviewHandler,
  );

  fastify.get(
    '/analytics/spend-velocity',
    { preHandler: [fastify.authenticate] },
    spendVelocityHandler,
  );

  fastify.get(
    '/analytics/spend-velocity-all',
    { preHandler: [fastify.authenticate] },
    spendVelocityAllHandler,
  );

  fastify.get(
    '/analytics/ban-chain',
    { preHandler: [fastify.authenticate] },
    banChainHandler,
  );

  fastify.get(
    '/analytics/ban-chain-all',
    { preHandler: [fastify.authenticate] },
    banChainAllHandler,
  );

  fastify.get(
    '/analytics/ban-chain-graph',
    { preHandler: [fastify.authenticate] },
    banChainGraphHandler,
  );

  fastify.get(
    '/analytics/consumable-scoring',
    { preHandler: [fastify.authenticate] },
    consumableScoringHandler,
  );

  fastify.get(
    '/analytics/creative-decay',
    { preHandler: [fastify.authenticate] },
    creativeDecayHandler,
  );

  fastify.post(
    '/analytics/creative-decay/scan',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    creativeDecayScanHandler,
  );

  fastify.get(
    '/analytics/creative-decay/trends',
    { preHandler: [fastify.authenticate] },
    creativeDecayTrendsHandler,
  );

  fastify.post(
    '/analytics/post-mortem/:ban_id',
    { preHandler: [fastify.authenticate] },
    postMortemHandler,
  );

  fastify.post(
    '/analytics/post-mortem-all',
    { preHandler: [fastify.authenticate] },
    postMortemAllHandler,
  );

  fastify.get(
    '/analytics/competitive-intelligence',
    { preHandler: [fastify.authenticate] },
    competitiveIntelligenceHandler,
  );

  fastify.get(
    '/analytics/freshness',
    { preHandler: [fastify.authenticate] },
    mvFreshnessHandler,
  );

  fastify.get(
    '/analytics/account-risk-summary',
    { preHandler: [fastify.authenticate] },
    accountRiskSummaryHandler,
  );
}
