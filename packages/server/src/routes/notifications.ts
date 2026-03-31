import type { FastifyInstance } from 'fastify';
import {
  listNotificationsHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
  notificationStreamHandler,
} from '../handlers/notifications.handler.js';

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/notifications',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string' },
            offset: { type: 'string' },
            unread_only: { type: 'string', enum: ['true', 'false'] },
          },
        },
      },
    },
    listNotificationsHandler,
  );

  fastify.get(
    '/notifications/unread-count',
    { preHandler: [fastify.authenticate] },
    unreadCountHandler,
  );

  fastify.patch(
    '/notifications/:id/read',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    markReadHandler,
  );

  fastify.post(
    '/notifications/read-all',
    { preHandler: [fastify.authenticate] },
    markAllReadHandler,
  );

  // SSE doesn't support Authorization headers, so we accept token as query param
  fastify.get(
    '/notifications/stream',
    { preHandler: [fastify.authenticate] },
    notificationStreamHandler,
  );
}
