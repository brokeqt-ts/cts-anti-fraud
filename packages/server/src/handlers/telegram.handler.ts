import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import {
  isBotConfigured,
  getBotUsername,
  startConnect,
  getConnectStatus,
  disconnect,
} from '../services/telegram-bot.service.js';

const pool = getPool(env.DATABASE_URL);

// GET /telegram/bot-info
export async function botInfoHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const configured = isBotConfigured();
  const username = configured ? await getBotUsername() : null;

  await reply.status(200).send({
    configured,
    bot_username: username,
  });
}

// POST /telegram/connect
export async function connectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;

  if (!isBotConfigured()) {
    await reply.status(400).send({
      error: 'Telegram бот не настроен',
      code: 'TELEGRAM_NOT_CONFIGURED',
    });
    return;
  }

  const result = await startConnect(userId);

  await reply.status(200).send({
    code: result.code,
    bot_username: result.bot_username,
    expires_in_seconds: 600,
  });
}

// GET /telegram/connect/status
export async function connectStatusHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const status = await getConnectStatus(userId, pool);

  await reply.status(200).send(status);
}

// DELETE /telegram/disconnect
export async function disconnectHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  await disconnect(userId, pool);

  await reply.status(200).send({ status: 'ok' });
}
