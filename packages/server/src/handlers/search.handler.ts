import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

interface SearchResult {
  type: 'account' | 'domain' | 'ban';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

export async function searchHandler(
  request: FastifyRequest<{ Querystring: { q?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const q = (request.query.q ?? '').trim();
  if (!q || q.length < 2) {
    await reply.send({ results: [] });
    return;
  }

  const pool = getPool(env.DATABASE_URL);
  const pattern = `%${q}%`;
  const results: SearchResult[] = [];

  try {
  // Search accounts (by google_id or display_name)
  const accounts = await pool.query(
    `SELECT google_account_id, display_name, status::text
     FROM accounts
     WHERE google_account_id ILIKE $1 OR display_name ILIKE $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 5`,
    [pattern],
  );
  for (const row of accounts.rows as Array<{ google_account_id: string; display_name: string | null; status: string | null }>) {
    results.push({
      type: 'account',
      id: row.google_account_id,
      title: row.display_name || row.google_account_id,
      subtitle: row.google_account_id + (row.status ? ` · ${row.status}` : ''),
      url: `/accounts/${row.google_account_id}`,
    });
  }

  // Search domains
  const domains = await pool.query(
    `SELECT id, domain_name
     FROM domains
     WHERE domain_name ILIKE $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [pattern],
  );
  for (const row of domains.rows as Array<{ id: string; domain_name: string }>) {
    results.push({
      type: 'domain',
      id: row.id,
      title: row.domain_name,
      subtitle: 'Домен',
      url: `/domains`,
    });
  }

  // Search bans (by reason or account id)
  const bans = await pool.query(
    `SELECT b.id, b.account_google_id, b.ban_reason, b.offer_vertical, b.banned_at
     FROM bans b
     WHERE b.account_google_id ILIKE $1
        OR b.ban_reason ILIKE $1
        OR b.ban_reason_internal ILIKE $1
        OR b.domain ILIKE $1
     ORDER BY b.banned_at DESC
     LIMIT 5`,
    [pattern],
  );
  for (const row of bans.rows as Array<{ id: string; account_google_id: string; ban_reason: string | null; offer_vertical: string | null; banned_at: string }>) {
    const date = new Date(row.banned_at).toLocaleDateString('ru-RU');
    results.push({
      type: 'ban',
      id: row.id,
      title: `Бан ${row.account_google_id}`,
      subtitle: `${date}${row.offer_vertical ? ' · ' + row.offer_vertical : ''}${row.ban_reason ? ' · ' + row.ban_reason.slice(0, 50) : ''}`,
      url: `/bans/${row.id}`,
    });
  }

  await reply.send({ results });
  } catch (err) {
    request.log.error({ err, query: q }, 'Search handler error');
    await reply.status(500).send({ error: 'Search failed', code: 'SEARCH_ERROR' });
  }
}
