import type pg from 'pg';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  severity: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  message?: string | null;
  severity: string;
  metadata?: Record<string, unknown> | null;
  dedupKey?: string | null;
}

export interface ListNotificationsParams {
  limit: number;
  offset: number;
  unreadOnly: boolean;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function insertNotification(
  pool: pg.Pool,
  params: CreateNotificationParams,
): Promise<NotificationRow | null> {
  const dedupKey = params.dedupKey ?? null;

  // Skip duplicate: same user + dedup_key (all time, not just 24h)
  if (dedupKey) {
    const existing = await pool.query(
      `SELECT id FROM notifications
       WHERE user_id = $1 AND dedup_key = $2
       LIMIT 1`,
      [params.userId, dedupKey],
    );
    if (existing.rows.length > 0) return null;
  }

  const result = await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, severity, metadata, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.userId,
      params.type,
      params.title,
      params.message ?? null,
      params.severity,
      params.metadata ? JSON.stringify(params.metadata) : null,
      dedupKey,
    ],
  );
  return result.rows[0] as NotificationRow;
}

export async function findByUser(
  pool: pg.Pool,
  userId: string,
  params: ListNotificationsParams,
): Promise<{ notifications: NotificationRow[]; total: number }> {
  const conditions = ['user_id = $1'];
  const values: unknown[] = [userId];

  if (params.unreadOnly) {
    conditions.push('is_read = false');
  }

  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM notifications WHERE ${where}`,
    values,
  );
  const total = (countResult.rows[0] as { total: number }).total;

  const dataResult = await pool.query(
    `SELECT * FROM notifications
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, params.limit, params.offset],
  );

  return { notifications: dataResult.rows as NotificationRow[], total };
}

export async function countUnread(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return (result.rows[0] as { count: number }).count;
}

export async function markRead(
  pool: pg.Pool,
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 AND is_read = false`,
    [notificationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markAllRead(pool: pg.Pool, userId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [userId],
  );
  return result.rowCount ?? 0;
}

export async function deleteOlderThan(pool: pg.Pool, days: number): Promise<number> {
  const result = await pool.query(
    `DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
    [days],
  );
  return result.rowCount ?? 0;
}
