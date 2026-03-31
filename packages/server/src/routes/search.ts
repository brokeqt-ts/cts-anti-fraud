import type { FastifyInstance } from 'fastify';
import { searchHandler } from '../handlers/search.handler.js';

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { q?: string } }>(
    '/search',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', minLength: 2, maxLength: 100 },
          },
        },
      },
    },
    searchHandler,
  );
}
