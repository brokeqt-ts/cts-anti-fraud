import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { processRpcPayload } from '../parsers/rpc-router.js';
import { scanAllSuspendedAccounts } from '../services/auto-ban-detector.js';
import { DomainEnrichmentService } from '../services/domain-enrichment.service.js';
import { ensureAccountExists, isValidCid } from '../services/ensure-account.js';
import * as adminRepo from '../repositories/admin.repository.js';

export async function rawAnalysisHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await adminRepo.getRawAnalysis(pool);

  await reply.status(200).send({
    total_count: result.total_count,
    source_url_patterns: result.source_url_patterns,
    item_type_distribution: result.item_type_distribution,
  });
}

export async function rpcPayloadsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await adminRepo.getRpcPayloads(pool);

  await reply.status(200).send({
    count: result.count,
    payloads: result.payloads,
  });
}

export async function backfillParsersHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const rows = await adminRepo.getRpcPayloadsForBackfill(pool);

  let parsed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const debug: unknown[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const sourceUrl = row.source_url;
    const rawPayload = row.raw_payload;

    // Debug info for first 5 records
    if (i < 5) {
      const rpcPathMatch = sourceUrl.match(/\/rpc\/([^?]+)/);
      const body = rawPayload['body'];
      debug.push({
        id: row.id,
        source_url: sourceUrl,
        rpc_path: rpcPathMatch?.[1] ?? null,
        body_type: body === null ? 'null' : typeof body,
        body_keys: body && typeof body === 'object' ? Object.keys(body as Record<string, unknown>) : null,
        payload_keys: Object.keys(rawPayload),
      });
    }

    try {
      const success = await processRpcPayload(
        pool,
        row.id,
        sourceUrl,
        rawPayload,
        row.profile_id,
      );
      if (success) {
        parsed++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      if (errors.length < 10) {
        errors.push(`${row.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  await reply.status(200).send({
    total: rows.length,
    parsed,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
    debug,
  });
}

export async function resetParsedDataHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const client = await pool.connect();

  let truncatedTables: string[] = [];

  try {
    // 1. TRUNCATE inside a transaction — if re-parse crashes immediately after truncate,
    //    the transaction rolls back and parsed data is preserved.
    await client.query('BEGIN');
    truncatedTables = await adminRepo.truncateParsedTables(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    throw err;
  }

  client.release();

  // 2. Re-run backfill logic (outside transaction — too many rows for a single long tx)
  const rows = await adminRepo.getRpcPayloadsForBackfill(pool);

  let parsed = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const success = await processRpcPayload(
        pool,
        row.id,
        row.source_url,
        row.raw_payload,
        row.profile_id,
      );
      if (success) parsed++;
      else skipped++;
    } catch (err) {
      failed++;
      if (errors.length < 10) {
        errors.push(`${row.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  await reply.status(200).send({
    truncated: truncatedTables,
    total: rows.length,
    parsed,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}

export async function mergeAccountHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { old_id, new_id } = request.body as { old_id: string; new_id: string };

  if (!old_id || !new_id) {
    await reply.status(400).send({ error: 'Both old_id and new_id are required', code: 'VALIDATION_ERROR' });
    return;
  }

  if (old_id === new_id) {
    await reply.status(400).send({ error: 'old_id and new_id must be different', code: 'VALIDATION_ERROR' });
    return;
  }

  const updated: Record<string, number> = {};

  // Update all related tables
  const tables: adminRepo.MergeAccountTable[] = [
    { table: 'account_signals', column: 'account_google_id' },
    { table: 'account_notifications', column: 'account_google_id' },
    { table: 'risk_verdicts', column: 'account_google_id' },
    { table: 'campaigns', column: 'account_google_id' },
    { table: 'billing_info', column: 'account_google_id' },
    { table: 'ban_logs', column: 'account_google_id' },
    { table: 'notification_details', column: 'account_google_id' },
    { table: 'account_metrics', column: 'account_google_id' },
    { table: 'ads', column: 'account_google_id' },
    { table: 'ad_groups', column: 'account_google_id' },
    { table: 'transaction_details', column: 'account_google_id' },
    { table: 'keywords', column: 'account_google_id' },
    { table: 'keyword_daily_stats', column: 'account_google_id' },
    { table: 'change_history', column: 'account_google_id' },
  ];

  for (const { table, column } of tables) {
    updated[table] = await adminRepo.reassignAccountInTable(pool, table, column, new_id, old_id);
  }

  // Merge accounts: if new_id account exists, delete old; if not, rename old to new
  const newAccountId = await adminRepo.findAccountByGoogleId(pool, new_id);

  if (newAccountId) {
    // Both exist — delete the old one (new one is canonical)
    updated['accounts_deleted'] = await adminRepo.deleteAccountByGoogleId(pool, old_id);
  } else {
    // Only old exists — rename it
    updated['accounts_renamed'] = await adminRepo.renameAccountGoogleId(pool, new_id, old_id);
  }

  await reply.status(200).send({
    merged: { from: old_id, to: new_id },
    updated,
  });
}

export async function parsedDataHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await adminRepo.getParsedData(pool);

  await reply.status(200).send({
    accounts: result.accounts,
    account_signals: result.account_signals,
    account_notifications: result.account_notifications,
    risk_verdicts: result.risk_verdicts,
    campaigns: result.campaigns,
    billing_info: result.billing_info,
    ads: result.ads,
    ad_groups: result.ad_groups,
    transaction_details: result.transaction_details,
  });
}

export async function detectBansHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const result = await scanAllSuspendedAccounts(pool);

  await reply.status(200).send(result);
}

/**
 * POST /api/v1/admin/enrich-domains
 *
 * 1. Collects unique domains from ads/keywords final_urls → upserts into domains table
 * 2. Enriches each domain with DNS, IP, SSL, HTTP, and page analysis
 */
export async function enrichDomainsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const service = new DomainEnrichmentService(pool);

  // Step 1: Collect domains
  const domains = await service.collectDomains();

  // Step 2: Enrich
  const result = await service.enrichAll(true);

  await reply.status(200).send({
    collected_domains: domains.length,
    enriched: result.enriched,
    errors: result.errors,
    domains,
  });
}

/**
 * GET /api/v1/admin/raw-payloads
 * Browse raw_payloads with optional filters.
 * Query: cid, domain, limit (default 50, max 500)
 */
export async function rawPayloadsListHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;

  const cid = query['cid'] ?? null;
  const domain = query['domain'] ?? null;
  const limit = Math.min(Math.max(parseInt(query['limit'] ?? '50', 10) || 50, 1), 500);

  const result = await adminRepo.listRawPayloads(pool, { cid, domain, limit });

  await reply.status(200).send({
    count: result.count,
    filters: result.filters,
    payloads: result.payloads,
  });
}

/**
 * GET /api/v1/admin/raw-payloads/:id
 * Full raw_payload body for a specific record.
 */
export async function rawPayloadsDetailHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };

  const payload = await adminRepo.getRawPayloadById(pool, id);

  if (!payload) {
    await reply.status(404).send({ error: 'Raw payload not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send(payload);
}

/**
 * Diagnostic endpoint: explore raw_payloads to find RPC services
 * containing campaign-level metrics, keywords, bidding strategy, change history.
 *
 * GET /api/v1/admin/gap-diagnostics
 */
export async function gapDiagnosticsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const handledPatterns = [
    'SettingsSummaryService/GetSummary', 'PaymentsSignupInfoService/Get',
    'TransactionsDetailsService/GetDetails', 'EducationFeatureService/GetSignals',
    'NotificationService/List', 'HagridRiskVerdictService/GetHagridRiskVerdict',
    'CampaignService/List', 'CampaignTrialService/List',
    'BillingSummaryInfoService/Get', 'SettingsDetailsService/GetDetails',
    'BillingSetupService/List', 'OverviewService/Get', 'BatchService/Batch',
    'CustomerService/List', 'CtCustomerService/List', 'MultiLoginUserService/Get',
    'AccountSuspensionAppealService/List', 'CustomerVerificationEligibilityService/List',
    'CustomerBillingService/List', 'AdGroupService/List',
    'InsightService/GetDiagnostics', 'CriterionDiagnosisService/Diagnose',
    'LocalizedPolicyTopicService/GetAllLocalizedPolicyTopics',
    'BotGuardCreationService/Get', 'CustomerUserAppDataService/Mutate',
    'IdentityAuthTokenService/Get', 'PaymentsFixFlowTokenService/Get',
    'UiCustomizationService/List', 'EducationFeatureService/Get',
    'CallRegionService/GetAllRegions', 'ClipboardService',
    'UserGuidedFlowExecutionInfoService', 'AwnCatalogService',
    'ManagerBillingSetupService/List',
    'ChangeEvent', 'ChangeHistory', 'MutateLog', 'ChangeStatus',
    'BillingActivityService/List',
    'AdGroupAdService/List',
    'AuctionInsight', 'CompetitorDomain',
  ];

  const diagnostics = await adminRepo.getGapDiagnostics(pool);

  // Classify RPC paths as handled vs unhandled
  const unhandled = diagnostics.allRpcPaths
    .filter(row => {
      const rpcFull = (row.rpc_full ?? '').split('?')[0] ?? '';
      return !handledPatterns.some(p => rpcFull.includes(p));
    })
    .map(row => ({
      rpc_path: (row.rpc_full ?? '').split('?')[0],
      count: row.count,
    }));

  await reply.status(200).send({
    summary: {
      total_distinct_rpc_paths: diagnostics.allRpcPaths.length,
      unhandled_rpc_count: unhandled.length,
      note: 'Unhandled = not matched by any existing parser in rpc-router.ts',
    },
    unhandled_rpc_services: unhandled,
    gap1_campaign_metrics: {
      description: 'CampaignService/List samples — look for performance fields beyond 1,2,11,12,14,17,18,50,109,142,143',
      samples: diagnostics.campaignServiceSamples,
      overview_samples: diagnostics.overviewServiceSamples,
      candidate_metric_services: diagnostics.possibleMetricServices,
    },
    gap2_keywords: {
      description: 'Search for keyword/criterion RPC services',
      candidate_services: diagnostics.possibleKeywordServices,
      batch_service_samples: diagnostics.batchServiceSamples,
    },
    gap4_change_history: {
      description: 'Search for change/history/audit RPC services',
      candidate_services: diagnostics.possibleChangeServices,
    },
  });
}

/**
 * POST /api/v1/admin/backfill-accounts
 *
 * Scan raw_payloads.profile_id + all child tables with account_google_id,
 * find valid CIDs (7-10 digits) that have NO row in accounts, and create them.
 *
 * Query params:
 *   ?dry_run=true  — preview what WOULD be created, no INSERT
 */
export async function backfillAccountsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const query = request.query as Record<string, string | undefined>;
  const dryRun = query['dry_run'] === 'true';

  // Tables that store account_google_id directly (same list as merge-account)
  const CHILD_TABLES = [
    'account_signals', 'account_notifications', 'risk_verdicts',
    'campaigns', 'billing_info', 'ban_logs', 'notification_details',
    'account_metrics', 'ads', 'ad_groups', 'transaction_details',
    'keywords', 'keyword_daily_stats', 'change_history',
  ] as const;

  // 1. Collect all distinct candidate CIDs from raw_payloads + child tables
  const cidSet = new Set<string>();

  // raw_payloads.profile_id
  const rawResult = await pool.query(
    `SELECT DISTINCT profile_id FROM raw_payloads WHERE profile_id IS NOT NULL`,
  );
  for (const row of rawResult.rows) {
    const v = row['profile_id'] as string;
    if (isValidCid(v)) cidSet.add(v);
  }

  // Child tables
  for (const table of CHILD_TABLES) {
    try {
      const result = await pool.query(
        `SELECT DISTINCT account_google_id FROM ${table} WHERE account_google_id IS NOT NULL`,
      );
      for (const row of result.rows) {
        const v = row['account_google_id'] as string;
        if (isValidCid(v)) cidSet.add(v);
      }
    } catch {
      // Table may not exist yet — skip
    }
  }

  // 2. Filter out CIDs that already have an accounts row
  const existingResult = await pool.query(
    `SELECT google_account_id FROM accounts`,
  );
  const existingCids = new Set(existingResult.rows.map(r => r['google_account_id'] as string));

  const missingCids = [...cidSet].filter(cid => !existingCids.has(cid));

  // 3. Resolve user_id for each missing CID from raw_payloads
  //    Strategy: pick the most frequent user_id for each profile_id.
  //    If a CID has data from multiple users, the majority owner wins.
  const cidUserMap = new Map<string, string | null>();

  if (missingCids.length > 0) {
    const userMapping = await pool.query(
      `SELECT profile_id, user_id, COUNT(*) as cnt
       FROM raw_payloads
       WHERE profile_id = ANY($1) AND user_id IS NOT NULL
       GROUP BY profile_id, user_id
       ORDER BY profile_id, cnt DESC`,
      [missingCids],
    );

    // First row per profile_id wins (highest count due to ORDER BY)
    const seen = new Set<string>();
    for (const row of userMapping.rows) {
      const pid = row['profile_id'] as string;
      if (!seen.has(pid)) {
        seen.add(pid);
        cidUserMap.set(pid, row['user_id'] as string);
      }
    }
  }

  // 4. Dry run: return preview without INSERT
  if (dryRun) {
    const preview = missingCids.map(cid => ({
      cid,
      user_id: cidUserMap.get(cid) ?? null,
      user_source: cidUserMap.has(cid) ? 'raw_payloads (most frequent)' : 'none — will be NULL',
    }));

    await reply.status(200).send({
      dry_run: true,
      scanned_sources: ['raw_payloads.profile_id', ...CHILD_TABLES],
      total_valid_cids: cidSet.size,
      already_existed: existingCids.size,
      missing: missingCids.length,
      would_create: preview,
    });
    return;
  }

  // 5. Create account rows
  let created = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const cid of missingCids) {
    try {
      const userId = cidUserMap.get(cid) ?? null;
      const accountId = await ensureAccountExists(pool, cid, userId);
      if (accountId) created++;
    } catch (err) {
      failed++;
      if (errors.length < 20) {
        errors.push(`${cid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  await reply.status(200).send({
    dry_run: false,
    scanned_sources: ['raw_payloads.profile_id', ...CHILD_TABLES],
    total_valid_cids: cidSet.size,
    already_existed: existingCids.size,
    missing: missingCids.length,
    created,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
