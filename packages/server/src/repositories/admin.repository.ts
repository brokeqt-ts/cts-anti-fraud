import type pg from 'pg';

// ─── Result Interfaces ──────────────────────────────────────────────────────

export interface RawAnalysisResult {
  total_count: number;
  source_url_patterns: SourceUrlPatternRow[];
  item_type_distribution: ItemTypeRow[];
}

export interface SourceUrlPatternRow {
  source_url: string;
  count: number;
  sample_payload: string | null;
}

export interface ItemTypeRow {
  item_type: string | null;
  count: number;
}

export interface RpcPayloadRow {
  id: string;
  source_url: string;
  item_type: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RpcPayloadsResult {
  count: number;
  payloads: RpcPayloadRow[];
}

export interface RawPayloadForBackfillRow {
  id: string;
  profile_id: string | null;
  source_url: string;
  raw_payload: Record<string, unknown>;
}

export interface MergeAccountTable {
  table: string;
  column: string;
}

export interface ParsedDataResult {
  accounts: Record<string, unknown>[];
  account_signals: Record<string, unknown>[];
  account_notifications: Record<string, unknown>[];
  risk_verdicts: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
  billing_info: Record<string, unknown>[];
  ads: Record<string, unknown>[];
  ad_groups: Record<string, unknown>[];
  transaction_details: Record<string, unknown>[];
}

export interface RawPayloadListRow {
  id: string;
  profile_id: string | null;
  source_url: string | null;
  rpc_service: string | null;
  http_status: string | null;
  google_cid: string | null;
  created_at: string;
  body_preview: string | null;
}

export interface RawPayloadListFilters {
  cid: string | null;
  domain: string | null;
  limit: number;
}

export interface RawPayloadListResult {
  count: number;
  filters: RawPayloadListFilters;
  payloads: RawPayloadListRow[];
}

export interface RawPayloadDetailRow {
  id: string;
  profile_id: string | null;
  item_type: string | null;
  source_url: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RpcPathRow {
  clean_url: string;
  rpc_full: string;
  count: number;
}

export interface GapSampleRow {
  id: string;
  source_url: string;
  payload_sample: string;
}

export interface GapCandidateRow {
  rpc_path: string;
  count: number;
  sample: string;
}

export interface GapDiagnosticsResult {
  allRpcPaths: RpcPathRow[];
  campaignServiceSamples: GapSampleRow[];
  overviewServiceSamples: GapSampleRow[];
  possibleMetricServices: GapCandidateRow[];
  possibleKeywordServices: GapCandidateRow[];
  possibleChangeServices: GapCandidateRow[];
  batchServiceSamples: GapSampleRow[];
}

export interface AccountExistsRow {
  id: string;
}

// ─── Repository Functions ───────────────────────────────────────────────────

/**
 * Get raw payload analysis: total count, top source_url patterns, and item_type distribution.
 */
export async function getRawAnalysis(pool: pg.Pool): Promise<RawAnalysisResult> {
  const [totalResult, urlPatternsResult, itemTypeResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM raw_payloads`),

    pool.query(`
      SELECT
        COALESCE(source_url, '(null)') AS source_url,
        COUNT(*)::int AS count,
        LEFT(
          (ARRAY_AGG(raw_payload::text ORDER BY created_at DESC))[1],
          1000
        ) AS sample_payload
      FROM raw_payloads
      GROUP BY source_url
      ORDER BY count DESC
      LIMIT 20
    `),

    pool.query(`
      SELECT item_type, COUNT(*)::int AS count
      FROM raw_payloads
      GROUP BY item_type
      ORDER BY count DESC
    `),
  ]);

  return {
    total_count: (totalResult.rows[0]?.['total'] as number) ?? 0,
    source_url_patterns: urlPatternsResult.rows.map(r => ({
      source_url: r['source_url'] as string,
      count: r['count'] as number,
      sample_payload: r['sample_payload'] as string | null,
    })),
    item_type_distribution: itemTypeResult.rows.map(r => ({
      item_type: r['item_type'] as string | null,
      count: r['count'] as number,
    })),
  };
}

/**
 * Get all RPC payloads (source_url containing '/rpc/').
 */
export async function getRpcPayloads(pool: pg.Pool): Promise<RpcPayloadsResult> {
  const result = await pool.query(`
    SELECT id, source_url, item_type, raw_payload AS payload, created_at
    FROM raw_payloads
    WHERE source_url LIKE '%/rpc/%'
    ORDER BY created_at DESC
  `);

  return {
    count: result.rowCount ?? 0,
    payloads: result.rows.map(r => ({
      id: r['id'] as string,
      source_url: r['source_url'] as string,
      item_type: r['item_type'] as string | null,
      payload: r['payload'] as Record<string, unknown>,
      created_at: r['created_at'] as string,
    })),
  };
}

/**
 * Get raw payloads for backfill (RPC payloads ordered by created_at).
 */
export async function getRpcPayloadsForBackfill(pool: pg.Pool): Promise<RawPayloadForBackfillRow[]> {
  const result = await pool.query(
    `SELECT id, profile_id, source_url, raw_payload
     FROM raw_payloads
     WHERE source_url LIKE '%/rpc/%'
     ORDER BY created_at`,
  );

  return result.rows.map(r => ({
    id: r['id'] as string,
    profile_id: r['profile_id'] as string | null,
    source_url: r['source_url'] as string,
    raw_payload: r['raw_payload'] as Record<string, unknown>,
  }));
}

/**
 * Truncate all parsed data tables (Phase 2-4).
 */
export async function truncateParsedTables(pool: pg.Pool | pg.PoolClient): Promise<string[]> {
  const tables = [
    'campaigns', 'billing_info', 'notification_details', 'account_metrics',
    'ads', 'ad_groups', 'transaction_details', 'keywords',
    'keyword_daily_stats', 'change_history',
  ];
  await pool.query(
    `TRUNCATE ${tables.join(', ')}`,
  );
  return tables;
}

/**
 * Update a column across a table, reassigning one account_google_id to another.
 * Returns the number of rows updated.
 */
export async function reassignAccountInTable(
  pool: pg.Pool,
  table: string,
  column: string,
  newId: string,
  oldId: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
    [newId, oldId],
  );
  return result.rowCount ?? 0;
}

/**
 * Check if an account exists by google_account_id.
 * Returns the internal id if found, null otherwise.
 */
export async function findAccountByGoogleId(
  pool: pg.Pool,
  googleAccountId: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT id FROM accounts WHERE google_account_id = $1`,
    [googleAccountId],
  );
  return (result.rows[0]?.['id'] as string) ?? null;
}

/**
 * Delete an account by google_account_id.
 * Returns the number of rows deleted.
 */
export async function deleteAccountByGoogleId(
  pool: pg.Pool,
  googleAccountId: string,
): Promise<number> {
  const result = await pool.query(
    `DELETE FROM accounts WHERE google_account_id = $1`,
    [googleAccountId],
  );
  return result.rowCount ?? 0;
}

/**
 * Rename an account's google_account_id.
 * Returns the number of rows updated.
 */
export async function renameAccountGoogleId(
  pool: pg.Pool,
  newId: string,
  oldId: string,
): Promise<number> {
  const result = await pool.query(
    `UPDATE accounts SET google_account_id = $1, updated_at = NOW() WHERE google_account_id = $2`,
    [newId, oldId],
  );
  return result.rowCount ?? 0;
}

/**
 * Get recent samples of all parsed data tables for debugging.
 */
export async function getParsedData(pool: pg.Pool): Promise<ParsedDataResult> {
  const [accounts, signals, notifications, verdicts, campaigns, billingInfo, ads, adGroups, transactionDetails] = await Promise.all([
    pool.query(`SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 10`),
    pool.query(`SELECT * FROM account_signals ORDER BY captured_at DESC LIMIT 20`),
    pool.query(`SELECT * FROM account_notifications ORDER BY captured_at DESC LIMIT 10`),
    pool.query(`SELECT * FROM risk_verdicts ORDER BY created_at DESC LIMIT 10`),
    pool.query(`SELECT * FROM campaigns ORDER BY captured_at DESC LIMIT 20`),
    pool.query(`SELECT * FROM billing_info ORDER BY captured_at DESC LIMIT 10`),
    pool.query(`SELECT * FROM ads ORDER BY captured_at DESC LIMIT 20`),
    pool.query(`SELECT * FROM ad_groups ORDER BY captured_at DESC LIMIT 20`),
    pool.query(`SELECT * FROM transaction_details ORDER BY captured_at DESC LIMIT 10`),
  ]);

  return {
    accounts: accounts.rows as Record<string, unknown>[],
    account_signals: signals.rows as Record<string, unknown>[],
    account_notifications: notifications.rows as Record<string, unknown>[],
    risk_verdicts: verdicts.rows as Record<string, unknown>[],
    campaigns: campaigns.rows as Record<string, unknown>[],
    billing_info: billingInfo.rows as Record<string, unknown>[],
    ads: ads.rows as Record<string, unknown>[],
    ad_groups: adGroups.rows as Record<string, unknown>[],
    transaction_details: transactionDetails.rows as Record<string, unknown>[],
  };
}

/**
 * Browse raw_payloads with optional CID and domain filters.
 */
/** Escape special LIKE/ILIKE wildcard characters so user input is treated as literal. */
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

export async function listRawPayloads(
  pool: pg.Pool,
  filters: RawPayloadListFilters,
): Promise<RawPayloadListResult> {
  const domainPattern = filters.domain ? `%${escapeLike(filters.domain)}%` : null;
  const result = await pool.query(
    `SELECT
       id,
       profile_id,
       source_url,
       CASE
         WHEN source_url LIKE '%/rpc/%'
         THEN SPLIT_PART(REGEXP_REPLACE(source_url, '\\?.*', ''), '/rpc/', 2)
         ELSE NULL
       END AS rpc_service,
       raw_payload->>'httpStatus' AS http_status,
       raw_payload->>'googleCid' AS google_cid,
       created_at,
       LEFT(raw_payload::text, 500) AS body_preview
     FROM raw_payloads
     WHERE ($1::text IS NULL OR raw_payload->>'googleCid' = $1)
       AND ($2::text IS NULL OR source_url ILIKE $2 ESCAPE '\\')
     ORDER BY created_at DESC
     LIMIT $3`,
    [filters.cid, domainPattern, filters.limit],
  );

  return {
    count: result.rowCount ?? 0,
    filters,
    payloads: result.rows.map(r => ({
      id: r['id'] as string,
      profile_id: r['profile_id'] as string | null,
      source_url: r['source_url'] as string | null,
      rpc_service: r['rpc_service'] as string | null,
      http_status: r['http_status'] as string | null,
      google_cid: r['google_cid'] as string | null,
      created_at: r['created_at'] as string,
      body_preview: r['body_preview'] as string | null,
    })),
  };
}

/**
 * Get full raw_payload detail by ID. Returns null if not found.
 */
export async function getRawPayloadById(
  pool: pg.Pool,
  id: string,
): Promise<RawPayloadDetailRow | null> {
  const result = await pool.query(
    `SELECT id, profile_id, item_type, source_url, raw_payload, created_at, updated_at
     FROM raw_payloads
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) {
    return null;
  }

  const r = result.rows[0]!;
  return {
    id: r['id'] as string,
    profile_id: r['profile_id'] as string | null,
    item_type: r['item_type'] as string | null,
    source_url: r['source_url'] as string | null,
    raw_payload: r['raw_payload'] as Record<string, unknown>,
    created_at: r['created_at'] as string,
    updated_at: r['updated_at'] as string,
  };
}

/**
 * Gap diagnostics: explore raw_payloads to find RPC services
 * containing campaign-level metrics, keywords, bidding strategy, change history.
 */
export async function getGapDiagnostics(pool: pg.Pool): Promise<GapDiagnosticsResult> {
  const [
    allRpcPaths,
    campaignServiceSample,
    overviewServiceSample,
    possibleMetricServices,
    possibleKeywordServices,
    possibleChangeServices,
    batchServiceSample,
  ] = await Promise.all([
    // 1. All distinct RPC paths with counts
    pool.query(`
      SELECT
        REGEXP_REPLACE(source_url, '\\?.*', '') AS clean_url,
        REGEXP_REPLACE(source_url, '.*\\/rpc\\/', '') AS rpc_full,
        COUNT(*)::int AS count
      FROM raw_payloads
      WHERE source_url LIKE '%/rpc/%'
      GROUP BY clean_url, rpc_full
      ORDER BY count DESC
    `),

    // 2. CampaignService/List — full payload to find bidding strategy + all keys
    pool.query(`
      SELECT id, source_url,
        LEFT(raw_payload::text, 8000) AS payload_sample
      FROM raw_payloads
      WHERE source_url LIKE '%CampaignService/List%'
      ORDER BY created_at DESC
      LIMIT 3
    `),

    // 3. OverviewService/Get — check for per-campaign breakdown
    pool.query(`
      SELECT id, source_url,
        LEFT(raw_payload::text, 5000) AS payload_sample
      FROM raw_payloads
      WHERE source_url LIKE '%OverviewService/Get%'
      ORDER BY created_at DESC
      LIMIT 2
    `),

    // 4. Candidate services for campaign-level metrics
    pool.query(`
      SELECT
        REGEXP_REPLACE(source_url, '.*\\/rpc\\/', '') AS rpc_path,
        COUNT(*)::int AS count,
        LEFT((ARRAY_AGG(raw_payload::text ORDER BY created_at DESC))[1], 4000) AS sample
      FROM raw_payloads
      WHERE source_url LIKE '%/rpc/%'
        AND (
          source_url ILIKE '%Stats%'
          OR source_url ILIKE '%Report%'
          OR source_url ILIKE '%Performance%'
          OR source_url ILIKE '%Metric%'
          OR source_url ILIKE '%SearchStream%'
          OR source_url ILIKE '%GoogleAdsService%'
          OR source_url ILIKE '%Chart%'
          OR source_url ILIKE '%CampaignOverview%'
          OR source_url ILIKE '%Budget%'
          OR source_url ILIKE '%Table%'
        )
      GROUP BY rpc_path
      ORDER BY count DESC
      LIMIT 20
    `),

    // 5. Keyword / criterion services
    pool.query(`
      SELECT
        REGEXP_REPLACE(source_url, '.*\\/rpc\\/', '') AS rpc_path,
        COUNT(*)::int AS count,
        LEFT((ARRAY_AGG(raw_payload::text ORDER BY created_at DESC))[1], 4000) AS sample
      FROM raw_payloads
      WHERE source_url LIKE '%/rpc/%'
        AND (
          source_url ILIKE '%Keyword%'
          OR source_url ILIKE '%Criterion%'
          OR source_url ILIKE '%SearchTerm%'
          OR source_url ILIKE '%QualityScore%'
          OR source_url ILIKE '%AdGroupCriterion%'
        )
      GROUP BY rpc_path
      ORDER BY count DESC
      LIMIT 20
    `),

    // 6. Change history services
    pool.query(`
      SELECT
        REGEXP_REPLACE(source_url, '.*\\/rpc\\/', '') AS rpc_path,
        COUNT(*)::int AS count,
        LEFT((ARRAY_AGG(raw_payload::text ORDER BY created_at DESC))[1], 2000) AS sample
      FROM raw_payloads
      WHERE source_url LIKE '%/rpc/%'
        AND (
          source_url ILIKE '%Change%'
          OR source_url ILIKE '%History%'
          OR source_url ILIKE '%Audit%'
        )
      GROUP BY rpc_path
      ORDER BY count DESC
      LIMIT 20
    `),

    // 7. BatchService/Batch — check for keywords in batch items
    pool.query(`
      SELECT id, source_url,
        LEFT(raw_payload::text, 10000) AS payload_sample
      FROM raw_payloads
      WHERE source_url LIKE '%BatchService/Batch%'
      ORDER BY created_at DESC
      LIMIT 3
    `),
  ]);

  return {
    allRpcPaths: allRpcPaths.rows.map(r => ({
      clean_url: r['clean_url'] as string,
      rpc_full: r['rpc_full'] as string,
      count: r['count'] as number,
    })),
    campaignServiceSamples: campaignServiceSample.rows.map(r => ({
      id: r['id'] as string,
      source_url: r['source_url'] as string,
      payload_sample: r['payload_sample'] as string,
    })),
    overviewServiceSamples: overviewServiceSample.rows.map(r => ({
      id: r['id'] as string,
      source_url: r['source_url'] as string,
      payload_sample: r['payload_sample'] as string,
    })),
    possibleMetricServices: possibleMetricServices.rows.map(r => ({
      rpc_path: r['rpc_path'] as string,
      count: r['count'] as number,
      sample: r['sample'] as string,
    })),
    possibleKeywordServices: possibleKeywordServices.rows.map(r => ({
      rpc_path: r['rpc_path'] as string,
      count: r['count'] as number,
      sample: r['sample'] as string,
    })),
    possibleChangeServices: possibleChangeServices.rows.map(r => ({
      rpc_path: r['rpc_path'] as string,
      count: r['count'] as number,
      sample: r['sample'] as string,
    })),
    batchServiceSamples: batchServiceSample.rows.map(r => ({
      id: r['id'] as string,
      source_url: r['source_url'] as string,
      payload_sample: r['payload_sample'] as string,
    })),
  };
}
