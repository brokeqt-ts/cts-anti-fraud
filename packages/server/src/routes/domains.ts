import type { FastifyInstance } from 'fastify';
import {
  listDomainsHandler,
  getDomainHandler,
  analyzeDomainContentHandler,
  scanAllDomainsContentHandler,
} from '../handlers/domains.handler.js';

export async function domainsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/domains',
    { preHandler: [fastify.authenticate] },
    listDomainsHandler,
  );

  // Batch content scan — must be before :domain param route
  fastify.post(
    '/domains/content-analysis/scan',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    scanAllDomainsContentHandler,
  );

  fastify.get(
    '/domains/:domain',
    { preHandler: [fastify.authenticate] },
    getDomainHandler,
  );

  fastify.post(
    '/domains/:domain/content-analysis',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    analyzeDomainContentHandler,
  );
}
