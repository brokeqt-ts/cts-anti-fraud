import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as domainsRepo from '../repositories/domains.repository.js';

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
    const [domainData, accounts, bans] = await Promise.all([
      domainsRepo.getDomainByName(pool, domain),
      domainsRepo.getAccountsByDomain(pool, domain),
      domainsRepo.getBansByDomain(pool, domain),
    ]);

    await reply.status(200).send({
      domain: domainData ?? { domain_name: domain },
      accounts,
      bans,
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
