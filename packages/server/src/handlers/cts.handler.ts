import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as ctsRepo from '../repositories/cts.repository.js';
import { CTSService } from '../services/cts.service.js';

/**
 * GET /cts/sites — list all CTS site links.
 */
export async function listCtsSitesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await ctsRepo.listCtsSites(pool);

  await reply.status(200).send(result);
}

/**
 * POST /cts/sites — create a new CTS site link.
 * Body: { domain: string, external_cts_id?: string }
 */
export async function createCtsSiteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domain, external_cts_id } = request.body as {
    domain?: string;
    external_cts_id?: string;
  };

  if (!domain || domain.trim().length === 0) {
    await reply.status(400).send({ error: 'domain is required', code: 'VALIDATION_ERROR' });
    return;
  }

  const site = await ctsRepo.createCtsSite(
    pool,
    domain.trim(),
    external_cts_id?.trim() ?? null,
  );

  await reply.status(201).send(site);
}

/**
 * PATCH /cts/sites/:id — update a CTS site link.
 * Body: { domain?: string, external_cts_id?: string }
 */
export async function updateCtsSiteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const { domain, external_cts_id } = request.body as {
    domain?: string;
    external_cts_id?: string;
  };

  const fields: ctsRepo.CtsSiteUpdateFields = {};

  if (domain !== undefined) {
    fields.domain = domain.trim();
  }
  if (external_cts_id !== undefined) {
    fields.external_cts_id = external_cts_id?.trim() ?? null;
  }

  if (fields.domain === undefined && fields.external_cts_id === undefined) {
    await reply.status(400).send({ error: 'Nothing to update', code: 'VALIDATION_ERROR' });
    return;
  }

  const site = await ctsRepo.updateCtsSite(pool, id, fields);

  if (!site) {
    await reply.status(404).send({ error: 'CTS site not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send(site);
}

/**
 * DELETE /cts/sites/:id — remove a CTS site link.
 */
export async function deleteCtsSiteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };

  const deletedId = await ctsRepo.deleteCtsSite(pool, id);

  if (!deletedId) {
    await reply.status(404).send({ error: 'CTS site not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send({ deleted: id });
}

/**
 * POST /cts/sync — trigger manual sync from external CTS system.
 */
export async function syncCtsSitesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const service = new CTSService(pool);

  try {
    const result = await service.syncSitesFromCTS();
    await reply.status(200).send({
      message: `Синхронизация завершена: ${result.synced}/${result.total} сайтов`,
      ...result,
    });
  } catch (err: unknown) {
    await reply.status(500).send({
      error: 'Ошибка синхронизации с CTS',
      code: 'CTS_SYNC_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * GET /cts/sites/:id/traffic — get traffic data for a CTS site.
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
export async function getCtsSiteTrafficHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const query = request.query as { from?: string; to?: string };

  // Look up the site to get the external CTS ID
  const siteResult = await pool.query(
    `SELECT external_cts_id FROM cts_sites WHERE id = $1`,
    [id],
  );

  if (siteResult.rows.length === 0) {
    await reply.status(404).send({ error: 'CTS сайт не найден', code: 'NOT_FOUND' });
    return;
  }

  const externalCtsId = siteResult.rows[0]!['external_cts_id'] as string | null;
  if (!externalCtsId) {
    await reply.status(400).send({
      error: 'Сайт не имеет external_cts_id — невозможно получить данные трафика',
      code: 'MISSING_CTS_ID',
    });
    return;
  }

  const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86400_000);
  const to = query.to ? new Date(query.to) : new Date();

  try {
    const service = new CTSService(pool);
    const traffic = await service.getTrafficData(externalCtsId, from, to);
    await reply.status(200).send(traffic);
  } catch (err: unknown) {
    await reply.status(500).send({
      error: 'Ошибка получения данных трафика',
      code: 'CTS_TRAFFIC_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /cts/sites/:id/link — link a CTS site to a Google Ads account.
 * Body: { account_google_id: string }
 */
export async function linkCtsSiteToAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const { account_google_id } = request.body as { account_google_id?: string };

  if (!account_google_id) {
    await reply.status(400).send({ error: 'account_google_id обязателен', code: 'VALIDATION_ERROR' });
    return;
  }

  // Verify site exists
  const siteResult = await pool.query(`SELECT domain FROM cts_sites WHERE id = $1`, [id]);
  if (siteResult.rows.length === 0) {
    await reply.status(404).send({ error: 'CTS сайт не найден', code: 'NOT_FOUND' });
    return;
  }

  // Verify account exists
  const accountResult = await pool.query(
    `SELECT id FROM accounts WHERE google_account_id = $1`,
    [account_google_id],
  );
  if (accountResult.rows.length === 0) {
    await reply.status(404).send({ error: 'Аккаунт не найден', code: 'NOT_FOUND' });
    return;
  }

  const domain = siteResult.rows[0]!['domain'] as string;
  const accountId = accountResult.rows[0]!['id'] as string;

  // Link domain to account (via domains table if domain exists there)
  try {
    await pool.query(
      `UPDATE accounts SET
         domain = COALESCE(domain, $1),
         updated_at = NOW()
       WHERE id = $2`,
      [domain, accountId],
    );
    await reply.status(200).send({
      message: `Сайт ${domain} привязан к аккаунту ${account_google_id}`,
    });
  } catch (err: unknown) {
    await reply.status(500).send({
      error: 'Ошибка привязки сайта к аккаунту',
      code: 'LINK_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
