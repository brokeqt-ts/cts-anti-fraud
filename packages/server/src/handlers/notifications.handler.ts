import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as notificationService from '../services/notification.service.js';
import { addSseClient } from '../services/sse-bus.js';

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
    from_date?: string;
    to_date?: string;
  };

  const limit = Math.min(Math.max(parseInt(query.limit ?? '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset ?? '0', 10) || 0, 0);
  const unreadOnly = query.unread_only === 'true';

  const { notifications, total } = await notificationService.getUserNotifications(
    pool,
    userId,
    { limit, offset, unreadOnly, fromDate: query.from_date, toDate: query.to_date },
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

/** SSE stream — pushes real-time notification events to the connected client. */
export async function notificationStreamHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

  // Send initial unread count
  const pool = getPool(env.DATABASE_URL);
  const count = await notificationService.getUnreadCount(pool, userId);
  reply.raw.write(`event: unread_count\ndata: ${JSON.stringify({ count })}\n\n`);

  // Keep-alive ping every 30s
  const keepAlive = setInterval(() => {
    try { reply.raw.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
  }, 30_000);

  addSseClient(userId, reply);

  request.raw.on('close', () => {
    clearInterval(keepAlive);
  });
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
