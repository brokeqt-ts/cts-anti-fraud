import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as bansRepo from '../repositories/bans.repository.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { getUserIdFilter } from '../utils/user-scope.js';

export async function createBanHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const body = request.body as {
    account_google_id: string;
    ban_date: string;
    ban_target: string;
    ban_reason_google?: string;
    ban_reason_internal?: string;
    offer_vertical?: string;
    domain?: string;
    campaign_type?: string;
  };

  const {
    account_google_id,
    ban_date,
    ban_target,
    ban_reason_google,
    ban_reason_internal,
    offer_vertical,
    campaign_type,
  } = body;
  let { domain } = body;

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, account_google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  // Auto-resolve domain from account's ads if not provided
  if (!domain) {
    domain = await bansRepo.resolveAccountDomain(pool, account_google_id) ?? undefined;
  }

  // Calculate lifetime_hours: hours from earliest campaign start_date to ban_date
  // Fallback to first raw_payload created_at if no campaigns exist
  const lifetimeHours = await bansRepo.calculateLifetimeHours(pool, account_google_id, ban_date);

  // Build snapshot: current account state + latest signals + latest notifications
  const snapshot = await bansRepo.buildAccountSnapshot(pool, account_google_id);

  // Insert ban
  const ban = await bansRepo.insertBan(pool, {
    account_google_id,
    ban_date,
    ban_reason_google: ban_reason_google ?? null,
    ban_target,
    lifetime_hours: lifetimeHours,
    snapshot: JSON.stringify(snapshot),
    offer_vertical: offer_vertical ?? null,
    campaign_type: campaign_type ?? null,
    domain: domain ?? null,
    ban_reason_internal: ban_reason_internal ?? null,
  });

  await reply.status(201).send(ban);
}

export async function updateBanHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const body = request.body as {
    offer_vertical?: string | null;
    domain?: string | null;
    campaign_type?: string | null;
    ban_reason_internal?: string | null;
    ban_reason_google?: string | null;
  };

  // Verify buyer owns the ban's account
  const userId = getUserIdFilter(request);
  if (userId) {
    const banOwned = await bansRepo.getBanById(pool, id, userId);
    if (!banOwned) {
      await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
      return;
    }
  }

  // Build SET clause dynamically from provided fields
  const allowedFields: Array<{ key: string; column: string }> = [
    { key: 'offer_vertical', column: 'offer_vertical' },
    { key: 'domain', column: 'domain' },
    { key: 'campaign_type', column: 'campaign_type' },
    { key: 'ban_reason_internal', column: 'ban_reason_internal' },
    { key: 'ban_reason_google', column: 'ban_reason' },
  ];

  const fields: Array<{ column: string; value: unknown }> = [];

  for (const { key, column } of allowedFields) {
    if (key in body) {
      fields.push({ column, value: (body as Record<string, unknown>)[key] ?? null });
    }
  }

  if (fields.length === 0) {
    await reply.status(400).send({ error: 'No fields to update', code: 'VALIDATION_ERROR' });
    return;
  }

  const ban = await bansRepo.updateBan(pool, id, fields);

  if (!ban) {
    await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send(ban);
}

export async function listBansHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;
  const account_google_id = query['account_google_id'];
  const offer_vertical = query['offer_vertical'];
  const ban_target = query['ban_target'];
  const from_date = query['from_date'];
  const to_date = query['to_date'];
  const limit = query['limit'] ?? '50';
  const offset = query['offset'] ?? '0';

  const result = await bansRepo.listBans(pool, {
    account_google_id,
    offer_vertical,
    ban_target,
    from_date,
    to_date,
    limit: parseInt(limit, 10),
    offset: parseInt(offset, 10),
    userId: getUserIdFilter(request),
  });

  await reply.status(200).send(result);
}

export async function getBanHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };

  const ban = await bansRepo.getBanById(pool, id, getUserIdFilter(request));

  if (!ban) {
    await reply.status(404).send({ error: 'Ban not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send(ban);
}
