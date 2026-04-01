import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

interface SearchResult {
  type: 'account' | 'domain' | 'ban' | 'practice' | 'notification';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  matchField: string | null; // which field matched — for highlight on frontend
}

/**
 * Parse search operators: "status:banned 812", "vertical:nutra casino"
 * Returns { field, value, text } where text is the free-text part after operator value.
 * Supports: "status:banned" (filter only) or "status:banned 812" (filter + text search).
 */
function parseOperator(q: string): { field: string; value: string; text: string } | null {
  const m = /^(vertical|status|bin|domain|type|reason|country|tag):(\S+)(?:\s+(.+))?$/i.exec(q);
  if (!m) return null;
  return { field: m[1].toLowerCase(), value: m[2].trim(), text: (m[3] ?? '').trim() };
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
  const results: SearchResult[] = [];
  const operator = parseOperator(q);

  try {
    if (operator) {
      // ── Operator-based search ──────────────────────────────────────────
      const pattern = `%${operator.value}%`;
      // text = свободная часть после оператора, например "status:banned 812" → text="812"
      const tp = operator.text ? `%${operator.text}%` : null;

      // AND-фильтр по свободному тексту внутри выборки оператора
      const accTextAnd = tp
        ? `AND (google_account_id ILIKE $2 OR display_name ILIKE $2 OR offer_vertical ILIKE $2 OR country ILIKE $2 OR payment_bin ILIKE $2)`
        : '';
      const banTextAnd = tp
        ? `AND (account_google_id ILIKE $2 OR domain ILIKE $2 OR offer_vertical ILIKE $2 OR ban_reason ILIKE $2)`
        : '';
      const domTextAnd = tp ? `AND domain_name ILIKE $2` : '';

      const accParams = (base: string[]) => tp ? [...base, tp] : base;
      const banParams = (base: string[]) => tp ? [...base, tp] : base;
      const domParams = (base: string[]) => tp ? [...base, tp] : base;

      if (operator.field === 'status') {
        const accs = await pool.query(
          `SELECT google_account_id, display_name, status::text, offer_vertical, account_type
           FROM accounts WHERE status::text ILIKE $1 ${accTextAnd} ORDER BY updated_at DESC LIMIT 15`,
          accParams([pattern]),
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'status',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, r.status, r.offer_vertical, r.account_type].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
      } else if (operator.field === 'vertical') {
        // Accounts by vertical
        const accs = await pool.query(
          `SELECT google_account_id, display_name, status::text, offer_vertical
           FROM accounts WHERE offer_vertical ILIKE $1 ${accTextAnd} ORDER BY updated_at DESC LIMIT 10`,
          accParams([pattern]),
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'offer_vertical',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, r.status, r.offer_vertical].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
        // Bans by vertical
        const bans = await pool.query(
          `SELECT id, account_google_id, ban_reason, offer_vertical, domain, banned_at
           FROM ban_logs WHERE offer_vertical ILIKE $1 ${banTextAnd} ORDER BY banned_at DESC LIMIT 10`,
          banParams([pattern]),
        );
        for (const r of bans.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'ban', id: r.id!, matchField: 'offer_vertical',
            title: `Бан ${r.account_google_id}`,
            subtitle: [fmtDate(r.banned_at), r.offer_vertical, r.domain, truncate(r.ban_reason, 50)].filter(Boolean).join(' · '),
            url: `/bans/${r.id}`,
          });
        }
      } else if (operator.field === 'bin') {
        const accs = await pool.query(
          `SELECT google_account_id, display_name, status::text, payment_bin, payment_bank
           FROM accounts WHERE payment_bin ILIKE $1 ${accTextAnd} ORDER BY updated_at DESC LIMIT 10`,
          accParams([pattern]),
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'payment_bin',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, `BIN: ${r.payment_bin}`, r.payment_bank, r.status].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
      } else if (operator.field === 'domain') {
        const doms = await pool.query(
          `SELECT id, domain_name FROM domains WHERE domain_name ILIKE $1 ${domTextAnd} ORDER BY created_at DESC LIMIT 10`,
          domParams([pattern]),
        );
        for (const r of doms.rows as Array<Record<string, string>>) {
          results.push({
            type: 'domain', id: r.id, matchField: 'domain_name',
            title: r.domain_name, subtitle: 'Домен', url: `/domains`,
          });
        }
        // Bans with this domain
        const bans = await pool.query(
          `SELECT id, account_google_id, ban_reason, offer_vertical, domain, banned_at
           FROM ban_logs WHERE domain ILIKE $1 ${banTextAnd} ORDER BY banned_at DESC LIMIT 5`,
          banParams([pattern]),
        );
        for (const r of bans.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'ban', id: r.id!, matchField: 'domain',
            title: `Бан ${r.account_google_id}`,
            subtitle: [fmtDate(r.banned_at), r.offer_vertical, r.domain].filter(Boolean).join(' · '),
            url: `/bans/${r.id}`,
          });
        }
      } else if (operator.field === 'type') {
        const accs = await pool.query(
          `SELECT google_account_id, display_name, status::text, account_type
           FROM accounts WHERE account_type ILIKE $1 ${accTextAnd} ORDER BY updated_at DESC LIMIT 15`,
          accParams([pattern]),
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'account_type',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, r.status, r.account_type].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
      } else if (operator.field === 'reason') {
        const bans = await pool.query(
          `SELECT id, account_google_id, ban_reason, offer_vertical, domain, banned_at
           FROM ban_logs WHERE (ban_reason ILIKE $1 OR ban_reason_internal ILIKE $1) ${banTextAnd}
           ORDER BY banned_at DESC LIMIT 10`,
          banParams([pattern]),
        );
        for (const r of bans.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'ban', id: r.id!, matchField: 'ban_reason',
            title: `Бан ${r.account_google_id}`,
            subtitle: [fmtDate(r.banned_at), r.offer_vertical, truncate(r.ban_reason, 60)].filter(Boolean).join(' · '),
            url: `/bans/${r.id}`,
          });
        }
      } else if (operator.field === 'country') {
        const accs = await pool.query(
          `SELECT google_account_id, display_name, status::text, country
           FROM accounts WHERE country ILIKE $1 ${accTextAnd} ORDER BY updated_at DESC LIMIT 15`,
          accParams([pattern]),
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'country',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, r.status, r.country].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
      } else if (operator.field === 'tag') {
        const accs = await pool.query(
          `SELECT a.google_account_id, a.display_name, a.status::text, t.name AS tag_name
           FROM accounts a
           JOIN account_tags at ON at.account_id = a.id
           JOIN tags t ON t.id = at.tag_id
           WHERE t.name ILIKE $1 ${tp ? `AND (a.google_account_id ILIKE $2 OR a.display_name ILIKE $2)` : ''}
           ORDER BY a.updated_at DESC LIMIT 15`,
          tp ? [pattern, tp] : [pattern],
        );
        for (const r of accs.rows as Array<Record<string, string | null>>) {
          results.push({
            type: 'account', id: r.google_account_id!, matchField: 'tag',
            title: r.display_name || r.google_account_id!,
            subtitle: [r.google_account_id, r.status, `#${r.tag_name}`].filter(Boolean).join(' · '),
            url: `/accounts/${r.google_account_id}`,
          });
        }
      }
    } else {
      // ── Free-text search ───────────────────────────────────────────────
      const pattern = `%${q}%`;

      // 1. Accounts
      const accounts = await pool.query(
        `SELECT google_account_id, display_name, status::text,
                account_type, offer_vertical, payment_bin, payment_bank
         FROM accounts
         WHERE google_account_id ILIKE $1
            OR display_name ILIKE $1
            OR status::text ILIKE $1
            OR offer_vertical ILIKE $1
            OR account_type ILIKE $1
            OR country ILIKE $1
            OR payment_bin ILIKE $1
            OR payment_bank ILIKE $1
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 8`,
        [pattern],
      );
      for (const row of accounts.rows as Array<Record<string, string | null>>) {
        results.push({
          type: 'account', id: row.google_account_id!, matchField: null,
          title: row.display_name || row.google_account_id!,
          subtitle: [row.google_account_id, row.status, row.offer_vertical, row.account_type, row.payment_bank].filter(Boolean).join(' · '),
          url: `/accounts/${row.google_account_id}`,
        });
      }

      // 2. Domains
      const domains = await pool.query(
        `SELECT id, domain_name FROM domains
         WHERE domain_name ILIKE $1 ORDER BY created_at DESC LIMIT 5`,
        [pattern],
      );
      for (const row of domains.rows as Array<{ id: string; domain_name: string }>) {
        results.push({
          type: 'domain', id: row.id, matchField: null,
          title: row.domain_name, subtitle: 'Домен', url: `/domains`,
        });
      }

      // 3. Ban logs
      const bans = await pool.query(
        `SELECT id, account_google_id, ban_reason, offer_vertical, domain, campaign_type, banned_at
         FROM ban_logs
         WHERE account_google_id ILIKE $1
            OR ban_reason ILIKE $1
            OR ban_reason_internal ILIKE $1
            OR offer_vertical ILIKE $1
            OR domain ILIKE $1
            OR campaign_type ILIKE $1
         ORDER BY banned_at DESC LIMIT 5`,
        [pattern],
      );
      for (const row of bans.rows as Array<Record<string, string | null>>) {
        results.push({
          type: 'ban', id: row.id!, matchField: null,
          title: `Бан ${row.account_google_id}`,
          subtitle: [fmtDate(row.banned_at), row.offer_vertical, row.domain, truncate(row.ban_reason, 50)].filter(Boolean).join(' · '),
          url: `/bans/${row.id}`,
        });
      }

      // 4. Best practices
      const practices = await pool.query(
        `SELECT id, title, category, offer_vertical FROM best_practices
         WHERE title ILIKE $1 OR content ILIKE $1 OR category ILIKE $1 OR offer_vertical ILIKE $1
         ORDER BY priority DESC LIMIT 5`,
        [pattern],
      );
      for (const row of practices.rows as Array<Record<string, string | null>>) {
        results.push({
          type: 'practice', id: row.id!, matchField: null,
          title: row.title!,
          subtitle: [row.category, row.offer_vertical].filter(Boolean).join(' · '),
          url: `/best-practices`,
        });
      }

      // 5. Notifications
      const notifications = await pool.query(
        `SELECT id, title, message, type, severity FROM notifications
         WHERE title ILIKE $1 OR message ILIKE $1
         ORDER BY created_at DESC LIMIT 5`,
        [pattern],
      );
      for (const row of notifications.rows as Array<Record<string, string | null>>) {
        results.push({
          type: 'notification', id: row.id!, matchField: null,
          title: row.title!,
          subtitle: [row.type, row.severity, truncate(row.message, 50)].filter(Boolean).join(' · '),
          url: `/notifications`,
        });
      }
    }

    await reply.send({ results });
  } catch (err) {
    request.log.error({ err, query: q }, 'Search handler error');
    await reply.status(500).send({ error: 'Search failed', code: 'SEARCH_ERROR' });
  }
}

function fmtDate(d: string | null): string | null {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('ru-RU'); } catch { return null; }
}

function truncate(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + '…' : s;
}
