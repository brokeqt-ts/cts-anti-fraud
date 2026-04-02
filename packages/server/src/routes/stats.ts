import type { FastifyInstance } from 'fastify';
import { overviewHandler } from '../handlers/stats.handler.js';
import { buyerPerformanceHandler } from '../handlers/buyer-performance.handler.js';

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/stats/overview',
    { preHandler: [fastify.authenticate] },
    overviewHandler,
  );

  fastify.get(
    '/stats/buyer-performance',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    buyerPerformanceHandler,
  );
}
