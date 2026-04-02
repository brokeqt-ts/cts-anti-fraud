import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

export async function buyerPerformanceHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await pool.query(`
    SELECT
      u.id AS user_id,
      u.name,
      u.email,
      u.role,
      u.is_active,
      u.last_login_at,
      COUNT(DISTINCT a.id)::int AS total_accounts,
      COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END)::int AS active_accounts,
      COUNT(DISTINCT CASE WHEN a.status IN ('suspended', 'banned') THEN a.id END)::int AS suspended_accounts,
      COUNT(DISTINCT bl.id)::int AS total_bans,
      ROUND(
        CASE WHEN COUNT(DISTINCT a.id) > 0
          THEN COUNT(DISTINCT bl.account_google_id)::numeric / COUNT(DISTINCT a.id) * 100
          ELSE 0
        END, 1
      ) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours), 0)::numeric, 1) AS avg_lifetime_hours,
      ROUND(COALESCE(SUM(a.total_spend), 0)::numeric, 2) AS total_spend,
      MAX(bl.banned_at) AS last_ban_at,
      MAX(a.updated_at) AS last_activity
    FROM users u
    LEFT JOIN accounts a ON a.user_id = u.id AND a.google_account_id ~ '^\\d{7,13}$'
    LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
    WHERE u.is_active = true
    GROUP BY u.id, u.name, u.email, u.role, u.is_active, u.last_login_at
    ORDER BY total_accounts DESC
  `);

  await reply.send({ buyers: result.rows });
}

export async function buyerDetailHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;
  const auditLimit = Math.min(parseInt(query['audit_limit'] ?? '30', 10), 100);
  const auditOffset = parseInt(query['audit_offset'] ?? '0', 10);

  // User info + stats
  const statsRes = await pool.query(`
    SELECT
      u.id AS user_id, u.name, u.email, u.role, u.is_active,
      u.last_login_at, u.created_at,
      COUNT(DISTINCT a.id)::int AS total_accounts,
      COUNT(DISTINCT CASE WHEN a.status = 'active' THEN a.id END)::int AS active_accounts,
      COUNT(DISTINCT CASE WHEN a.status IN ('suspended', 'banned') THEN a.id END)::int AS suspended_accounts,
      COUNT(DISTINCT bl.id)::int AS total_bans,
      ROUND(CASE WHEN COUNT(DISTINCT a.id) > 0
        THEN COUNT(DISTINCT bl.account_google_id)::numeric / COUNT(DISTINCT a.id) * 100 ELSE 0 END, 1) AS ban_rate,
      ROUND(COALESCE(AVG(bl.lifetime_hours), 0)::numeric, 1) AS avg_lifetime_hours,
      ROUND(COALESCE(SUM(a.total_spend), 0)::numeric, 2) AS total_spend,
      MAX(bl.banned_at) AS last_ban_at
    FROM users u
    LEFT JOIN accounts a ON a.user_id = u.id AND a.google_account_id ~ '^\\d{7,13}$'
    LEFT JOIN ban_logs bl ON bl.account_google_id = a.google_account_id
    WHERE u.id = $1
    GROUP BY u.id
  `, [id]);

  if (statsRes.rows.length === 0) {
    await reply.status(404).send({ error: 'User not found', code: 'NOT_FOUND' });
    return;
  }

  // User's accounts
  const accountsRes = await pool.query(`
    SELECT a.google_account_id, a.display_name, a.status::text, a.currency,
           a.account_type, a.updated_at,
           (SELECT COUNT(*)::int FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS ban_count
    FROM accounts a
    WHERE a.user_id = $1 AND a.google_account_id ~ '^\\d{7,13}$'
    ORDER BY a.updated_at DESC
    LIMIT 50
  `, [id]);

  // Audit log for this user
  const [auditRes, auditCountRes] = await Promise.all([
    pool.query(
      `SELECT id, action, entity_type, entity_id, details, ip_address, created_at
       FROM audit_log WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [id, auditLimit, auditOffset],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_log WHERE user_id = $1`,
      [id],
    ),
  ]);

  // Bans by vertical for this user
  const verticalRes = await pool.query(`
    SELECT bl.offer_vertical, COUNT(*)::int AS count
    FROM ban_logs bl
    JOIN accounts a ON a.google_account_id = bl.account_google_id
    WHERE a.user_id = $1 AND bl.offer_vertical IS NOT NULL
    GROUP BY bl.offer_vertical ORDER BY count DESC
  `, [id]);

  await reply.send({
    buyer: statsRes.rows[0],
    accounts: accountsRes.rows,
    audit: {
      total: (auditCountRes.rows[0] as { total: number }).total,
      entries: auditRes.rows,
    },
    bans_by_vertical: verticalRes.rows,
  });
}
