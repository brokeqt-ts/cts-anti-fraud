import type { FastifyInstance } from 'fastify';
import {
  listCtsSitesHandler,
  createCtsSiteHandler,
  updateCtsSiteHandler,
  deleteCtsSiteHandler,
  syncCtsSitesHandler,
  getCtsSiteTrafficHandler,
  linkCtsSiteToAccountHandler,
} from '../handlers/cts.handler.js';

export async function ctsRoutes(fastify: FastifyInstance): Promise<void> {
  // --- Read-only: any authenticated user can view ---
  fastify.get(
    '/cts/sites',
    { preHandler: [fastify.authenticate] },
    listCtsSitesHandler,
  );

  fastify.get(
    '/cts/sites/:id/traffic',
    { preHandler: [fastify.authenticate] },
    getCtsSiteTrafficHandler,
  );

  // --- Write operations: admin only ---
  fastify.post(
    '/cts/sites',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    createCtsSiteHandler,
  );

  fastify.patch(
    '/cts/sites/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    updateCtsSiteHandler,
  );

  fastify.delete(
    '/cts/sites/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    deleteCtsSiteHandler,
  );

  fastify.post(
    '/cts/sync',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    syncCtsSitesHandler,
  );

  fastify.post(
    '/cts/sites/:id/link',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    linkCtsSiteToAccountHandler,
  );
}
