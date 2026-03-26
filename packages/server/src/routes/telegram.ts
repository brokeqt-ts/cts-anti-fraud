import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  botInfoHandler,
  connectHandler,
  connectStatusHandler,
  disconnectHandler,
} from '../handlers/telegram.handler.js';
import { handleWebhookUpdate } from '../services/telegram-bot.service.js';

export async function telegramRoutes(fastify: FastifyInstance): Promise<void> {
  // Telegram webhook — no auth (Telegram sends updates here)
  fastify.post(
    '/telegram/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const update = request.body as Record<string, unknown>;
      // Process async — respond 200 immediately so Telegram doesn't retry
      void handleWebhookUpdate(update as Parameters<typeof handleWebhookUpdate>[0]);
      await reply.status(200).send({ ok: true });
    },
  );

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
