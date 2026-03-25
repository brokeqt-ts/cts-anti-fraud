import type { FastifyInstance } from 'fastify';
import {
  botInfoHandler,
  connectHandler,
  connectStatusHandler,
  disconnectHandler,
} from '../handlers/telegram.handler.js';

export async function telegramRoutes(fastify: FastifyInstance): Promise<void> {
  // Public — bot info (needed to show bot link before auth in some cases)
  fastify.get('/telegram/bot-info', botInfoHandler);

  // Authenticated — connect flow
  fastify.post(
    '/telegram/connect',
    { preHandler: [fastify.authenticate] },
    connectHandler,
  );

  fastify.get(
    '/telegram/connect/status',
    { preHandler: [fastify.authenticate] },
    connectStatusHandler,
  );

  fastify.delete(
    '/telegram/disconnect',
    { preHandler: [fastify.authenticate] },
    disconnectHandler,
  );
}
