import type { FastifyInstance } from 'fastify';
import { overviewHandler } from '../handlers/stats.handler.js';

export async function statsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/stats/overview',
    { preHandler: [fastify.authenticate] },
    overviewHandler,
  );
}
