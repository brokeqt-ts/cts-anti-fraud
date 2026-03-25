import type { FastifyInstance } from 'fastify';
import {
  trainHandler,
  predictHandler,
  predictAllHandler,
  predictionSummaryHandler,
  predictionHistoryHandler,
  trainingStatsHandler,
  trainingExportHandler,
  bootstrapTrainHandler,
} from '../handlers/ml.handler.js';

export async function mlRoutes(fastify: FastifyInstance): Promise<void> {
  // --- Admin-only: training, export, bootstrap ---
  fastify.post(
    '/ml/train',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    trainHandler,
  );

  fastify.get(
    '/ml/training-stats',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    trainingStatsHandler,
  );

  fastify.get(
    '/ml/training-export',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    trainingExportHandler,
  );

  fastify.post(
    '/ml/bootstrap',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    bootstrapTrainHandler,
  );

  // --- User-scoped: predictions (ownership checked in handler) ---
  fastify.get(
    '/ml/predict/:accountId',
    { preHandler: [fastify.authenticate] },
    predictHandler,
  );

  fastify.post(
    '/ml/predict-all',
    { preHandler: [fastify.authenticate] },
    predictAllHandler,
  );

  fastify.get(
    '/ml/summary',
    { preHandler: [fastify.authenticate] },
    predictionSummaryHandler,
  );

  fastify.get(
    '/ml/history/:accountId',
    { preHandler: [fastify.authenticate] },
    predictionHistoryHandler,
  );
}
