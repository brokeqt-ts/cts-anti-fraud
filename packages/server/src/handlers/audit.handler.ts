import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

export async function listAuditHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;

  const limit = Math.min(parseInt(query['limit'] ?? '50', 10), 200);
  const offset = parseInt(query['offset'] ?? '0', 10);
  const action = query['action'];
  const userId = query['user_id'];
  const entityType = query['entity_type'];
  const fromDate = query['from_date'];
  const toDate = query['to_date'];

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (action) {
    conditions.push(`a.action ILIKE $${idx++}`);
    params.push(`%${action}%`);
  }
  if (userId) {
    conditions.push(`a.user_id = $${idx++}`);
    params.push(userId);
  }
  if (entityType) {
    conditions.push(`a.entity_type = $${idx++}`);
    params.push(entityType);
  }
  if (fromDate) {
    conditions.push(`a.created_at >= $${idx++}`);
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push(`a.created_at <= $${idx++}::date + interval '1 day'`);
    params.push(toDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, countRes] = await Promise.all([
    pool.query(
      `SELECT a.id, a.user_id, a.user_name, a.action, a.entity_type, a.entity_id,
              a.details, a.ip_address, a.created_at
       FROM audit_log a ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_log a ${where}`,
      params,
    ),
  ]);

  await reply.send({
    total: (countRes.rows[0] as { total: number }).total,
    entries: rows.rows,
  });
}
