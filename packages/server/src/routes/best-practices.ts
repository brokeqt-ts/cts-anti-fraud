import type { FastifyInstance } from 'fastify';
import {
  listBestPracticesHandler,
  getBestPracticeHandler,
  createBestPracticeHandler,
  updateBestPracticeHandler,
  deleteBestPracticeHandler,
  getForPromptHandler,
} from '../handlers/best-practices.handler.js';

export async function bestPracticesRoutes(fastify: FastifyInstance): Promise<void> {
  // Public (authenticated)
  fastify.get(
    '/best-practices',
    { preHandler: [fastify.authenticate] },
    listBestPracticesHandler,
  );

  // For AI prompt injection (authenticated)
  fastify.get(
    '/best-practices/for-prompt',
    { preHandler: [fastify.authenticate] },
    getForPromptHandler,
  );

  fastify.get(
    '/best-practices/:id',
    { preHandler: [fastify.authenticate] },
    getBestPracticeHandler,
  );

  // Admin only
  fastify.post(
    '/best-practices',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    createBestPracticeHandler,
  );

  fastify.patch(
    '/best-practices/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    updateBestPracticeHandler,
  );

  fastify.delete(
    '/best-practices/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    deleteBestPracticeHandler,
  );
}
