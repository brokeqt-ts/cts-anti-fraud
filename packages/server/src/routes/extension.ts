import type { FastifyInstance } from 'fastify';
import { downloadExtensionHandler, adminDownloadExtensionHandler } from '../handlers/extension.handler.js';

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
  },
};

export async function extensionRoutes(fastify: FastifyInstance): Promise<void> {
  // Authenticated user downloads their own extension
  fastify.get(
    '/extension/download',
    {
      schema: {
        response: { 404: errorResponseSchema, 500: errorResponseSchema },
      },
      preHandler: [fastify.authenticate],
    },
    downloadExtensionHandler,
  );

  // Admin downloads extension for a specific user
  fastify.get<{ Params: { userId: string } }>(
    '/extension/download/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', format: 'uuid' },
          },
        },
        response: { 404: errorResponseSchema, 500: errorResponseSchema },
      },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    adminDownloadExtensionHandler,
  );
}
