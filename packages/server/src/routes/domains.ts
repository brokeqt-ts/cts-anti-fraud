import type { FastifyInstance } from 'fastify';
import { listDomainsHandler, getDomainHandler } from '../handlers/domains.handler.js';

export async function domainsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/domains',
    { preHandler: [fastify.authenticate] },
    listDomainsHandler,
  );

  fastify.get(
    '/domains/:domain',
    { preHandler: [fastify.authenticate] },
    getDomainHandler,
  );
}
