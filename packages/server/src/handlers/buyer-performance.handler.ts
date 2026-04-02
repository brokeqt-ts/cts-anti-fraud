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
