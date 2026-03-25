import type { FastifyInstance } from 'fastify';
import {
  listAccountsHandler,
  getAccountHandler,
  patchAccountHandler,
  addConsumableHandler,
  deleteConsumableHandler,
  qualityScoreDistributionHandler,
  lowQualityKeywordsHandler,
  qualityScoreHistoryHandler,
} from '../handlers/accounts.handler.js';
import { accountCompetitiveIntelligenceHandler } from '../handlers/analytics.handler.js';

export async function accountsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/accounts',
    { preHandler: [fastify.authenticate] },
    listAccountsHandler,
  );

  fastify.get(
    '/accounts/:google_id',
    { preHandler: [fastify.authenticate] },
    getAccountHandler,
  );

  fastify.patch(
    '/accounts/:google_id',
    { preHandler: [fastify.authenticate] },
    patchAccountHandler,
  );

  fastify.post(
    '/accounts/:google_id/consumables',
    { preHandler: [fastify.authenticate] },
    addConsumableHandler,
  );

  fastify.delete(
    '/accounts/:google_id/consumables/:id',
    { preHandler: [fastify.authenticate] },
    deleteConsumableHandler,
  );

  fastify.get(
    '/accounts/:google_id/competitive-intelligence',
    { preHandler: [fastify.authenticate] },
    accountCompetitiveIntelligenceHandler,
  );

  fastify.get(
    '/accounts/:google_id/quality-score',
    { preHandler: [fastify.authenticate] },
    qualityScoreDistributionHandler,
  );

  fastify.get(
    '/accounts/:google_id/keywords/low-quality',
    { preHandler: [fastify.authenticate] },
    lowQualityKeywordsHandler,
  );

  fastify.get(
    '/accounts/:google_id/quality-score/history',
    { preHandler: [fastify.authenticate] },
    qualityScoreHistoryHandler,
  );
}
