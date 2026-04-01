import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as settingsService from '../services/notification-settings.service.js';
import { createNotification } from '../services/notification.service.js';
import { sendTestMessage } from '../services/telegram-bot.service.js';
import { audit } from '../services/audit.service.js';

// ─── 3A: Notification Settings ───────────────────────────────────────────────

export async function listSettingsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const settings = await settingsService.getAllSettings(pool);
  await reply.send({ settings });
}

export async function updateSettingHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { key } = request.params as { key: string };
  const body = request.body as settingsService.UpdateSettingParams;

  const setting = await settingsService.updateSetting(pool, key, body);

  if (!setting) {
    await reply.status(404).send({
      error: 'Setting not found',
      code: 'NOT_FOUND',
    });
    return;
  }

  audit(pool, request, 'settings.update', { entityType: 'notification_setting', entityId: key, details: body as Record<string, unknown> });
  await reply.send({ setting });
}

// ─── 3A2: Test Telegram ───────────────────────────────────────────────────────

export async function testTelegramHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { key } = request.params as { key: string };

  const setting = await settingsService.getSetting(pool, key);
  if (!setting) {
    await reply.status(404).send({ error: 'Setting not found', code: 'NOT_FOUND' });
    return;
  }

  // Use per-setting chat ID if set, otherwise global TELEGRAM_CHAT_ID
  const chatId = setting.telegram_chat_id ?? env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    await reply.status(400).send({
      error: 'Telegram Chat ID не настроен. Укажите Chat ID в настройке или в переменной окружения TELEGRAM_CHAT_ID.',
      code: 'TELEGRAM_CHAT_ID_MISSING',
    });
    return;
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    await reply.status(400).send({
      error: 'TELEGRAM_BOT_TOKEN не задан в переменных окружения',
      code: 'TELEGRAM_TOKEN_MISSING',
    });
    return;
  }

  const ok = await sendTestMessage(chatId);
  if (!ok) {
    await reply.status(502).send({ error: 'Не удалось отправить сообщение в Telegram', code: 'TELEGRAM_SEND_FAILED' });
    return;
  }

  await reply.send({ ok: true, chat_id: chatId });
}

// ─── 3B: Manual Send ─────────────────────────────────────────────────────────

interface SendNotificationBody {
  target: 'all' | 'buyers' | 'admins' | 'user_id';
  user_id?: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
}

export async function sendNotificationHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const body = request.body as SendNotificationBody;

  let userIds: string[];

  if (body.target === 'user_id') {
    if (!body.user_id) {
      await reply.status(400).send({
        error: 'user_id is required when target is user_id',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    const result = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND is_active = true`,
      [body.user_id],
    );
    if (result.rowCount === 0) {
      await reply.status(404).send({
        error: 'User not found or inactive',
        code: 'USER_NOT_FOUND',
      });
      return;
    }
    userIds = [body.user_id];
  } else {
    let query = `SELECT id FROM users WHERE is_active = true`;
    if (body.target === 'buyers') {
      query += ` AND role = 'buyer'`;
    } else if (body.target === 'admins') {
      query += ` AND role = 'admin'`;
    }
    const result = await pool.query(query);
    userIds = result.rows.map((r: Record<string, unknown>) => r['id'] as string);
  }

  for (const userId of userIds) {
    await createNotification(pool, {
      userId,
      type: 'system',
      title: body.title,
      message: body.message,
      severity: body.severity,
    });
  }

  await reply.send({ sent_to: userIds.length });
}

// ─── 3C: History ─────────────────────────────────────────────────────────────

export async function notificationHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as { limit?: string };
  const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 200);

  const result = await pool.query(
    `SELECT
       title,
       message,
       severity,
       COUNT(*)::int AS target_count,
       MIN(created_at) AS sent_at
     FROM notifications
     WHERE type = 'system'
     GROUP BY title, message, severity,
       date_trunc('second', created_at)
     ORDER BY sent_at DESC
     LIMIT $1`,
    [limit],
  );

  await reply.send({ history: result.rows });
}
