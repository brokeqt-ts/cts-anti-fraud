import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as notificationService from '../services/notification.service.js';

export async function listNotificationsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = request.user!.id;
  const query = request.query as {
    limit?: string;
    offset?: string;
    unread_only?: string;
  };

  const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
  const unreadOnly = query.unread_only === 'true';

  const { notifications, total } = await notificationService.getUserNotifications(
    pool,
    userId,
    { limit, offset, unreadOnly },
  );

  const unreadCount = await notificationService.getUnreadCount(pool, userId);

  await reply.send({ notifications, unread_count: unreadCount, total });
}

export async function unreadCountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = request.user!.id;

  const count = await notificationService.getUnreadCount(pool, userId);

  await reply.send({ count });
}

export async function markReadHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = request.user!.id;
  const { id } = request.params as { id: string };

  const updated = await notificationService.markAsRead(pool, id, userId);

  if (!updated) {
    await reply.status(404).send({
      error: 'Notification not found or already read',
      code: 'NOT_FOUND',
    });
    return;
  }

  await reply.send({ success: true });
}

export async function markAllReadHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = request.user!.id;

  const count = await notificationService.markAllRead(pool, userId);

  await reply.send({ updated: count });
}
