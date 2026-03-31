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
    // 1. Accounts — search by google_id, display_name, vertical, account_type, payment
    const accounts = await pool.query(
      `SELECT a.google_account_id, a.display_name, a.status::text,
              a.account_type, a.offer_vertical, a.payment_bin, a.payment_bank
       FROM accounts a
       WHERE a.google_account_id ILIKE $1
          OR a.display_name ILIKE $1
          OR a.offer_vertical ILIKE $1
          OR a.account_type ILIKE $1
          OR a.country ILIKE $1
          OR a.payment_bin ILIKE $1
          OR a.payment_bank ILIKE $1
       ORDER BY a.updated_at DESC NULLS LAST
       LIMIT 8`,
      [pattern],
    );
    for (const row of accounts.rows as Array<{
      google_account_id: string; display_name: string | null; status: string | null;
      account_type: string | null; offer_vertical: string | null;
      payment_bin: string | null; payment_bank: string | null;
    }>) {
      const parts = [row.google_account_id];
      if (row.status) parts.push(row.status);
      if (row.offer_vertical) parts.push(row.offer_vertical);
      if (row.account_type) parts.push(row.account_type);
      if (row.payment_bank) parts.push(row.payment_bank);

      results.push({
        type: 'account',
        id: row.google_account_id,
        title: row.display_name || row.google_account_id,
        subtitle: parts.join(' · '),
        url: `/accounts/${row.google_account_id}`,
      });
    }

    // 2. Accounts by linked domain name (separate query to avoid missing join tables)
    try {
      const accountsByDomain = await pool.query(
        `SELECT DISTINCT a.google_account_id, a.display_name, a.status::text, d.domain_name
         FROM raw_payloads rp
         JOIN accounts a ON a.google_account_id = rp.profile_id
         JOIN domains d ON d.domain_name ILIKE $1
         WHERE rp.parsed_data::text ILIKE $1
         LIMIT 5`,
        [pattern],
      );
      for (const row of accountsByDomain.rows as Array<{
        google_account_id: string; display_name: string | null; status: string | null; domain_name: string;
      }>) {
        if (results.some(r => r.id === row.google_account_id)) continue;
        results.push({
          type: 'account',
          id: row.google_account_id,
          title: row.display_name || row.google_account_id,
          subtitle: `${row.google_account_id} · домен: ${row.domain_name}`,
          url: `/accounts/${row.google_account_id}`,
        });
      }
    } catch {
      // Skip if raw_payloads join fails
    }

    // 3. Domains — by name
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

    // 4. Ban logs — by account_id, reason, vertical, domain, campaign_type
    const bans = await pool.query(
      `SELECT b.id, b.account_google_id, b.ban_reason, b.offer_vertical,
              b.domain, b.campaign_type, b.banned_at
       FROM ban_logs b
       WHERE b.account_google_id ILIKE $1
          OR b.ban_reason ILIKE $1
          OR b.ban_reason_internal ILIKE $1
          OR b.offer_vertical ILIKE $1
          OR b.domain ILIKE $1
          OR b.campaign_type ILIKE $1
       ORDER BY b.banned_at DESC
       LIMIT 5`,
      [pattern],
    );
    for (const row of bans.rows as Array<{
      id: string; account_google_id: string; ban_reason: string | null;
      offer_vertical: string | null; domain: string | null;
      campaign_type: string | null; banned_at: string;
    }>) {
      const date = new Date(row.banned_at).toLocaleDateString('ru-RU');
      const parts = [date];
      if (row.offer_vertical) parts.push(row.offer_vertical);
      if (row.domain) parts.push(row.domain);
      if (row.ban_reason) parts.push(row.ban_reason.slice(0, 60));

      results.push({
        type: 'ban',
        id: row.id,
        title: `Бан ${row.account_google_id}`,
        subtitle: parts.join(' · '),
        url: `/bans/${row.id}`,
      });
    }

    await reply.send({ results });
  } catch (err) {
    request.log.error({ err, query: q }, 'Search handler error');
    await reply.status(500).send({ error: 'Search failed', code: 'SEARCH_ERROR' });
  }
}
