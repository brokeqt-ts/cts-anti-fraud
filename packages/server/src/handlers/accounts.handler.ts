import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import * as qsRepo from '../repositories/quality-score.repository.js';
import { getUserIdFilter } from '../utils/user-scope.js';

const VALID_ACCOUNT_TYPES = ['farm', 'bought', 'agency', 'unknown'];
const VALID_VERTICALS = ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other'];

export async function listAccountsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;

  try {
    const result = await accountsRepo.listAccounts(pool, {
      search: query['search'],
      status: query['status'],
      currency: query['currency'],
      tagId: query['tag_id'],
      limit: parseInt(query['limit'] ?? '50', 10),
      offset: parseInt(query['offset'] ?? '0', 10),
      userId: getUserIdFilter(request),
    });

    // Derive effective account_status from suspended_signal
    for (const row of result.accounts) {
      const sig = row['suspended_signal'] as Record<string, unknown> | null;
      if (sig && row['account_status'] !== 'suspended' && row['account_status'] !== 'banned') {
        const val = sig['value'];
        const isSuspended =
          val === true ||
          (val != null && typeof val === 'object' && ((val as Record<string, unknown>)['1'] === true));
        if (isSuspended) {
          row['account_status'] = 'suspended';
        }
      }
    }

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'listAccountsHandler' }, 'Failed to list accounts');
    await reply.status(500).send({
      error: 'Failed to list accounts',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };

  try {
    const detail = await accountsRepo.getAccountDetail(pool, google_id, getUserIdFilter(request));

    if (!detail) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }

    await reply.status(200).send({
      account: { ...detail.account, ...(detail.antidetectProfile ?? {}) },
      signals: detail.signals,
      notifications: detail.notifications,
      notification_details: detail.notificationDetails,
      bans: detail.bans,
      payload_stats: detail.payloadStats,
      campaigns: detail.campaigns,
      billing: detail.billing,
      metrics: detail.metrics,
      ads: detail.ads,
      ad_groups: detail.adGroups,
      keywords: detail.keywords,
      keyword_daily_stats: detail.keywordDailyStats,
      campaign_metrics: detail.campaignMetrics,
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'getAccountHandler', google_id }, 'Failed to get account');
    await reply.status(500).send({
      error: 'Failed to get account details',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function patchAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };
  const body = request.body as Record<string, unknown>;

  const patchParams: accountsRepo.PatchAccountParams = {};

  if ('account_type' in body) {
    const val = body['account_type'] as string | null;
    if (val !== null && !VALID_ACCOUNT_TYPES.includes(val)) {
      await reply.status(400).send({ error: `Invalid account_type. Must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' });
      return;
    }
    patchParams.accountType = val;
  }

  if ('offer_vertical' in body) {
    const val = body['offer_vertical'] as string | null;
    if (val !== null && !VALID_VERTICALS.includes(val)) {
      await reply.status(400).send({ error: `Invalid offer_vertical. Must be one of: ${VALID_VERTICALS.join(', ')}`, code: 'VALIDATION_ERROR' });
      return;
    }
    patchParams.offerVertical = val;
  }

  if (patchParams.accountType === undefined && patchParams.offerVertical === undefined) {
    await reply.status(400).send({ error: 'No valid fields to update', code: 'VALIDATION_ERROR' });
    return;
  }

  try {
    const account = await accountsRepo.patchAccount(pool, google_id, patchParams, getUserIdFilter(request));

    if (!account) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }

    await reply.status(200).send({ account });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'patchAccountHandler', google_id }, 'Failed to update account');
    await reply.status(500).send({
      error: 'Failed to update account',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function addConsumableHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };
  const body = request.body as Record<string, unknown>;
  const type = body['type'] as string;

  const accountId = await accountsRepo.getAccountIdByGoogleId(pool, google_id, getUserIdFilter(request));
  if (!accountId) {
    await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }

  try {
    if (type === 'proxy') {
      const proxyId = await accountsRepo.insertProxy(
        pool,
        (body['proxy_type'] as string) ?? 'datacenter',
        (body['provider'] as string | null) ?? null,
        (body['geo'] as string | null) ?? null,
        (body['ip_address'] as string | null) ?? null,
      );
      await accountsRepo.linkConsumable(pool, accountId, 'proxy_id', proxyId);
      await reply.status(201).send({ id: proxyId, type: 'proxy' });
    } else if (type === 'antidetect_profile') {
      const profileId = await accountsRepo.insertAntidetectProfile(
        pool,
        (body['browser_type'] as string) ?? 'other',
        (body['profile_external_id'] as string | null) ?? null,
        (body['fingerprint_hash'] as string | null) ?? null,
      );
      await accountsRepo.linkConsumable(pool, accountId, 'antidetect_profile_id', profileId);
      await reply.status(201).send({ id: profileId, type: 'antidetect_profile' });
    } else if (type === 'payment_method') {
      const pmId = await accountsRepo.insertPaymentMethod(
        pool,
        (body['bin'] as string | null) ?? null,
        (body['card_type'] as string | null) ?? null,
        (body['provider_bank'] as string | null) ?? null,
        (body['country'] as string | null) ?? null,
      );
      await accountsRepo.linkConsumable(pool, accountId, 'payment_method_id', pmId);
      await reply.status(201).send({ id: pmId, type: 'payment_method' });
    } else {
      await reply.status(400).send({ error: 'Invalid type. Must be proxy, antidetect_profile, or payment_method', code: 'VALIDATION_ERROR' });
    }
  } catch (err: unknown) {
    request.log.error({ err, handler: 'addConsumableHandler', google_id }, 'Failed to add consumable');
    await reply.status(500).send({
      error: 'Failed to add consumable',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function qualityScoreDistributionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };

  // Verify ownership for non-admin users
  const userId = getUserIdFilter(request);
  if (userId) {
    const accountId = await accountsRepo.getAccountIdByGoogleId(pool, google_id, userId);
    if (!accountId) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const distribution = await qsRepo.getAccountQualityDistribution(pool, google_id);
    const lowQs = await qsRepo.getLowQualityKeywords(pool, google_id, 100);

    // Compute aggregates
    let totalKeywords = 0;
    let qsSum = 0;
    const ctrCounts: Record<number, number> = {};
    const relCounts: Record<number, number> = {};
    const landCounts: Record<number, number> = {};

    for (const kw of lowQs) {
      if (kw.qs_expected_ctr != null) ctrCounts[kw.qs_expected_ctr] = (ctrCounts[kw.qs_expected_ctr] ?? 0) + 1;
      if (kw.qs_ad_relevance != null) relCounts[kw.qs_ad_relevance] = (relCounts[kw.qs_ad_relevance] ?? 0) + 1;
      if (kw.qs_landing_page != null) landCounts[kw.qs_landing_page] = (landCounts[kw.qs_landing_page] ?? 0) + 1;
    }

    for (const d of distribution) { totalKeywords += d.keyword_count; qsSum += d.quality_score * d.keyword_count; }

    const mostCommon = (counts: Record<number, number>) => {
      let max = 0; let val: number | null = null;
      for (const [k, c] of Object.entries(counts)) { if (c > max) { max = c; val = Number(k); } }
      return val;
    };

    await reply.status(200).send({
      distribution,
      aggregates: {
        avg_qs: totalKeywords > 0 ? Math.round((qsSum / totalKeywords) * 10) / 10 : null,
        total_keywords: totalKeywords,
        common_ctr: mostCommon(ctrCounts),
        common_relevance: mostCommon(relCounts),
        common_landing: mostCommon(landCounts),
      },
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'qualityScoreDistributionHandler', google_id }, 'Failed to get QS distribution');
    await reply.status(500).send({ error: 'Failed to get quality score distribution', code: 'INTERNAL_ERROR' });
  }
}

export async function lowQualityKeywordsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };
  const query = request.query as Record<string, string | undefined>;
  const threshold = parseInt(query['threshold'] ?? '4', 10);

  // Verify ownership for non-admin users
  const userId = getUserIdFilter(request);
  if (userId) {
    const accountId = await accountsRepo.getAccountIdByGoogleId(pool, google_id, userId);
    if (!accountId) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const allLow = await qsRepo.getLowQualityKeywords(pool, google_id, 50);
    const keywords = allLow.filter(k => k.quality_score != null && k.quality_score <= threshold);
    await reply.status(200).send({ keywords });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'lowQualityKeywordsHandler', google_id }, 'Failed to get low QS keywords');
    await reply.status(500).send({ error: 'Failed to get low quality keywords', code: 'INTERNAL_ERROR' });
  }
}

export async function qualityScoreHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };

  // Verify ownership for non-admin users
  const userId = getUserIdFilter(request);
  if (userId) {
    const accountId = await accountsRepo.getAccountIdByGoogleId(pool, google_id, userId);
    if (!accountId) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    // Get all keyword IDs for this account, then aggregate history by date
    const result = await pool.query(
      `SELECT date::text, AVG(quality_score)::numeric(3,1) AS avg_qs,
              AVG(expected_ctr)::numeric(3,1) AS avg_ctr,
              AVG(ad_relevance)::numeric(3,1) AS avg_rel,
              AVG(landing_page_experience)::numeric(3,1) AS avg_lp
       FROM keyword_quality_history
       WHERE account_google_id = $1 AND quality_score IS NOT NULL
       GROUP BY date ORDER BY date ASC
       LIMIT 90`,
      [google_id],
    );

    const history = result.rows.map(r => ({
      date: r['date'] as string,
      quality_score: r['avg_qs'] != null ? Number(r['avg_qs']) : null,
      expected_ctr: r['avg_ctr'] != null ? Number(r['avg_ctr']) : null,
      ad_relevance: r['avg_rel'] != null ? Number(r['avg_rel']) : null,
      landing_page_experience: r['avg_lp'] != null ? Number(r['avg_lp']) : null,
    }));

    await reply.status(200).send({ history });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'qualityScoreHistoryHandler', google_id }, 'Failed to get QS history');
    await reply.status(500).send({ error: 'Failed to get quality score history', code: 'INTERNAL_ERROR' });
  }
}

export async function deleteConsumableHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { google_id, id } = request.params as { google_id: string; id: string };

  try {
    const pool = getPool(env.DATABASE_URL);

    // Verify ownership for non-admin users
    const userId = getUserIdFilter(request);
    if (userId) {
      const accountId = await accountsRepo.getAccountIdByGoogleId(pool, google_id, userId);
      if (!accountId) {
        await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
        return;
      }
    }

    const unlinked = await accountsRepo.unlinkConsumable(pool, id);

    if (!unlinked) {
      await reply.status(404).send({ error: 'Consumable link not found', code: 'NOT_FOUND' });
      return;
    }

    await reply.status(200).send({ unlinked: true });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'deleteConsumableHandler' }, 'Failed to unlink consumable');
    await reply.status(500).send({
      error: 'Failed to unlink consumable',
      code: 'INTERNAL_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
