import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as domainsRepo from '../repositories/domains.repository.js';
import { analyzeAndSave, analyzeAllDomains } from '../services/domain-content-analyzer.js';

/**
 * GET /domains — list all unique domains from ads.final_urls,
 * enriched with data from the domains table if available.
 */
export async function listDomainsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const result = await domainsRepo.listDomains(pool);

    await reply.status(200).send(result);
  } catch (err: unknown) {
    _request.log.error({ err, handler: 'listDomainsHandler' }, 'Failed to list domains');
    await reply.status(500).send({
      error: 'Failed to list domains',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * GET /domains/:domain — details for a specific domain.
 */
export async function getDomainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domain } = request.params as { domain: string };

  try {
    const [domainData, accounts, bans, contentAnalysis] = await Promise.all([
      domainsRepo.getDomainByName(pool, domain),
      domainsRepo.getAccountsByDomain(pool, domain),
      domainsRepo.getBansByDomain(pool, domain),
      pool.query(
        `SELECT dca.* FROM domain_content_analysis dca
         JOIN domains d ON d.id = dca.domain_id
         WHERE d.domain_name = $1 LIMIT 1`,
        [domain],
      ).then(r => r.rows[0] ?? null).catch(() => null),
    ]);

    await reply.status(200).send({
      domain: domainData ?? { domain_name: domain },
      accounts,
      bans,
      content_analysis: contentAnalysis,
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'getDomainHandler', domain }, 'Failed to get domain');
    await reply.status(500).send({
      error: 'Failed to get domain details',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /domains/:domain/content-analysis — trigger content analysis for a single domain.
 */
export async function analyzeDomainContentHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { domain } = request.params as { domain: string };

  try {
    const domainRow = await domainsRepo.getDomainByName(pool, domain);
    if (!domainRow) {
      await reply.status(404).send({ error: 'Domain not found', code: 'NOT_FOUND' });
      return;
    }

    const result = await analyzeAndSave(pool, domainRow.id, `https://${domain}`);
    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'analyzeDomainContentHandler', domain }, 'Content analysis failed');
    await reply.status(500).send({
      error: 'Content analysis failed',
      code: 'ANALYSIS_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * POST /domains/content-analysis/scan — batch scan all domains (admin).
 */
export async function scanAllDomainsContentHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const result = await analyzeAllDomains(pool, 20);
    await reply.status(200).send(result);
  } catch (err: unknown) {
    _request.log.error({ err, handler: 'scanAllDomainsContentHandler' }, 'Batch content scan failed');
    await reply.status(500).send({
      error: 'Batch content scan failed',
      code: 'SCAN_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
