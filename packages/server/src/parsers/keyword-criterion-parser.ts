import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { upsertDomainAndEnrich } from '../services/domain-enrichment.service.js';
import { trackKeywordChanges } from '../services/account-change-tracker.js';

/**
 * Keyword Criterion Parser with daily stats — extends spec with granular data.
 *
 * Parses BatchService/Batch [AdGroupCriterionService.List] responses to
 * extract keywords, quality scores, match types, and daily performance
 * metrics. The daily stats breakdown (Type B entries → keyword_daily_stats
 * table, migration 026) is not in the original spec but provides essential
 * time-series data for ban pattern analysis and spend anomaly detection.
 *
 * Detected via rpcTrackingId containing "AdGroupCriterionService.List".
 *
 * body.2[] = array of JSON strings (or objects). Each parsed item has:
 *   parsed["1"][]  = array of criterion entries
 *   parsed["2"]["2"][] = column definitions for metrics in "200"."1"[]
 *
 * Three entry types:
 *   Type A — keyword with metrics: has field "13" (keyword_text)
 *   Type B — daily breakdown: has field "201" (date info)
 *   Type C — aggregate metrics: has "200" but no "13" or "201"
 */
export async function parseKeywordCriteria(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const batchItems = dig(body, '2') as unknown[] | undefined;
  if (!Array.isArray(batchItems) || batchItems.length === 0) {
    console.log(`[keyword-criterion-parser] body.2 is not an array or empty`);
    return;
  }

  let totalKeywords = 0;
  let totalDaily = 0;
  let totalAggregates = 0;

  for (const rawItem of batchItems) {
    let parsed: unknown;

    if (typeof rawItem === 'string') {
      try {
        parsed = JSON.parse(rawItem);
      } catch {
        continue;
      }
    } else {
      parsed = rawItem;
    }

    if (!parsed || typeof parsed !== 'object') continue;

    // Build column map from parsed["2"]["2"][]
    const columnDefs = dig(parsed, '2', '2') as unknown[] | undefined;
    const columnMap: Record<number, string> = {};
    if (Array.isArray(columnDefs)) {
      for (let i = 0; i < columnDefs.length; i++) {
        const name = dig(columnDefs[i], '3') as string | undefined;
        if (name) columnMap[i] = name;
      }
    }

    const items = dig(parsed, '1') as unknown[] | undefined;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const customerId = dig(item, '1') as string | undefined;
      const cid = resolveCid(ctx, { bodyCustomerId: customerId });
      if (!cid) continue;

      const keywordText = dig(item, '13') as string | undefined;
      const dateInfo = dig(item, '201') as Record<string, unknown> | undefined;
      const metricsRaw = dig(item, '200', '1') as string[] | undefined;

      if (keywordText) {
        // Type A — keyword with metrics
        const count = await upsertKeyword(pool, cid, item, keywordText, metricsRaw, columnMap, rawPayloadId);
        totalKeywords += count;
      } else if (dateInfo) {
        // Type B — daily breakdown
        const count = await upsertDailyStats(pool, cid, item, dateInfo, metricsRaw, columnMap, rawPayloadId);
        totalDaily += count;
      } else if (metricsRaw) {
        // Type C — aggregate (no keyword, no date)
        const count = await upsertAggregate(pool, cid, item, metricsRaw, columnMap, rawPayloadId);
        totalAggregates += count;
      }
    }
  }

  if (totalKeywords > 0 || totalDaily > 0 || totalAggregates > 0) {
    console.log(
      `[keyword-criterion-parser] Inserted ${totalKeywords} keywords, ${totalDaily} daily stats, ${totalAggregates} aggregates`,
    );
  }
}

/** Parse a metric value string. Returns null for "--" or unparseable values. */
function parseMetricValue(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (s === '--' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Build a metrics object from raw values array + column map. */
function buildMetrics(
  metricsRaw: string[] | undefined,
  columnMap: Record<number, string>,
): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  if (!Array.isArray(metricsRaw)) return metrics;

  for (let i = 0; i < metricsRaw.length; i++) {
    const name = columnMap[i];
    if (name) {
      metrics[name] = parseMetricValue(metricsRaw[i]);
    }
  }
  return metrics;
}

/** Type A: upsert keyword with performance snapshot. */
async function upsertKeyword(
  pool: import('pg').Pool,
  cid: string,
  item: unknown,
  keywordText: string,
  metricsRaw: string[] | undefined,
  columnMap: Record<number, string>,
  rawPayloadId: string,
): Promise<number> {
  const keywordId = dig(item, '4') as string | undefined;
  if (!keywordId) return 0;

  const campaignId = dig(item, '2') as string | undefined;
  const adGroupId = dig(item, '3') as string | undefined;
  const matchType = dig(item, '17') as number | undefined;
  const isNegative = dig(item, '15') as boolean | undefined;
  const status = dig(item, '21') as number | undefined;
  const maxCpcRaw = dig(item, '22', '5') as string | undefined;
  const finalUrls = dig(item, '24') as string[] | undefined;
  const currency = dig(item, '27') as string | undefined;
  const qualityScore = dig(item, '105') as number | undefined;
  const qsExpectedCtr = dig(item, '28') as number | undefined;
  const qsAdRelevance = dig(item, '29') as number | undefined;
  const qsLandingPage = dig(item, '30') as number | undefined;

  const maxCpcMicros = maxCpcRaw != null ? parseMetricValue(maxCpcRaw) : null;

  const metrics = buildMetrics(metricsRaw, columnMap);

  // Track keyword changes (non-blocking)
  const incomingKw: Record<string, unknown> = {};
  if (status != null) incomingKw['status'] = status;
  if (qualityScore != null) incomingKw['quality_score'] = qualityScore;
  trackKeywordChanges(pool, cid, String(keywordId), keywordText, incomingKw).catch(() => {});

  try {
    await pool.query(
      `INSERT INTO keywords (
         account_google_id, campaign_id, ad_group_id, keyword_id, keyword_text,
         match_type, is_negative, status, max_cpc_micros, final_urls, currency,
         quality_score, qs_expected_ctr, qs_ad_relevance, qs_landing_page,
         impressions, clicks, cost_micros, ctr, avg_cpc_micros,
         conversions, conversion_rate, cost_per_conversion_micros,
         raw_payload_id
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15,
         $16, $17, $18, $19, $20,
         $21, $22, $23,
         $24
       )
       ON CONFLICT (account_google_id, keyword_id) DO UPDATE SET
         keyword_text = EXCLUDED.keyword_text,
         campaign_id = EXCLUDED.campaign_id,
         ad_group_id = EXCLUDED.ad_group_id,
         match_type = COALESCE(EXCLUDED.match_type, keywords.match_type),
         is_negative = COALESCE(EXCLUDED.is_negative, keywords.is_negative),
         status = COALESCE(EXCLUDED.status, keywords.status),
         max_cpc_micros = COALESCE(EXCLUDED.max_cpc_micros, keywords.max_cpc_micros),
         final_urls = COALESCE(EXCLUDED.final_urls, keywords.final_urls),
         currency = COALESCE(EXCLUDED.currency, keywords.currency),
         quality_score = COALESCE(EXCLUDED.quality_score, keywords.quality_score),
         qs_expected_ctr = COALESCE(EXCLUDED.qs_expected_ctr, keywords.qs_expected_ctr),
         qs_ad_relevance = COALESCE(EXCLUDED.qs_ad_relevance, keywords.qs_ad_relevance),
         qs_landing_page = COALESCE(EXCLUDED.qs_landing_page, keywords.qs_landing_page),
         impressions = COALESCE(EXCLUDED.impressions, keywords.impressions),
         clicks = COALESCE(EXCLUDED.clicks, keywords.clicks),
         cost_micros = COALESCE(EXCLUDED.cost_micros, keywords.cost_micros),
         ctr = COALESCE(EXCLUDED.ctr, keywords.ctr),
         avg_cpc_micros = COALESCE(EXCLUDED.avg_cpc_micros, keywords.avg_cpc_micros),
         conversions = COALESCE(EXCLUDED.conversions, keywords.conversions),
         conversion_rate = COALESCE(EXCLUDED.conversion_rate, keywords.conversion_rate),
         cost_per_conversion_micros = COALESCE(EXCLUDED.cost_per_conversion_micros, keywords.cost_per_conversion_micros),
         raw_payload_id = EXCLUDED.raw_payload_id,
         updated_at = NOW()`,
      [
        cid,
        campaignId ? String(campaignId) : null,
        adGroupId ? String(adGroupId) : null,
        String(keywordId),
        keywordText,
        matchType ?? null,
        isNegative ?? false,
        status ?? null,
        maxCpcMicros != null ? Math.round(maxCpcMicros) : null,
        finalUrls && finalUrls.length > 0 ? JSON.stringify(finalUrls) : null,
        currency ?? null,
        qualityScore ?? null,
        qsExpectedCtr ?? null,
        qsAdRelevance ?? null,
        qsLandingPage ?? null,
        metrics['stats.impressions'] != null ? Math.round(metrics['stats.impressions']) : null,
        metrics['stats.clicks'] != null ? Math.round(metrics['stats.clicks']) : null,
        metrics['stats.cost'] != null ? Math.round(metrics['stats.cost']) : null,
        metrics['stats.click_through_rate'] ?? null,
        metrics['stats.cost_per_click'] != null ? Math.round(metrics['stats.cost_per_click']) : null,
        metrics['stats.conversions'] ?? null,
        metrics['stats.conversion_rate'] ?? null,
        metrics['stats.cost_per_conversion'] != null ? Math.round(metrics['stats.cost_per_conversion']) : null,
        rawPayloadId,
      ],
    );

    // АВТОМАТИЗАЦИЯ 4: Discover new domains from final_urls
    if (finalUrls && finalUrls.length > 0) {
      for (const url of finalUrls) {
        if (typeof url === 'string') upsertDomainAndEnrich(pool, url);
      }
    }

    return 1;
  } catch (err) {
    console.error(
      `[keyword-criterion-parser] Failed to upsert keyword ${keywordId}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/** Type B: upsert daily breakdown stats. */
async function upsertDailyStats(
  pool: import('pg').Pool,
  cid: string,
  item: unknown,
  dateInfo: Record<string, unknown>,
  metricsRaw: string[] | undefined,
  columnMap: Record<number, string>,
  rawPayloadId: string,
): Promise<number> {
  const dateStr = dig(dateInfo, '3') as string | undefined; // "2026-01-25"
  if (!dateStr) return 0;

  const keywordId = dig(item, '4') as string | undefined;
  const campaignId = dig(item, '2') as string | undefined;
  const metrics = buildMetrics(metricsRaw, columnMap);

  let count = 0;
  for (const [metricName, value] of Object.entries(metrics)) {
    if (value == null) continue;
    // Skip non-stat columns like ad_group.ad_group_id
    if (!metricName.startsWith('stats.')) continue;

    try {
      await pool.query(
        `INSERT INTO keyword_daily_stats (
           account_google_id, keyword_id, campaign_id, date, metric_name, metric_value, raw_payload_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (account_google_id, COALESCE(keyword_id, ''), date, metric_name) DO UPDATE SET
           metric_value = EXCLUDED.metric_value,
           campaign_id = COALESCE(EXCLUDED.campaign_id, keyword_daily_stats.campaign_id),
           raw_payload_id = EXCLUDED.raw_payload_id,
           updated_at = NOW()`,
        [
          cid,
          keywordId ? String(keywordId) : null,
          campaignId ? String(campaignId) : null,
          dateStr,
          metricName,
          value,
          rawPayloadId,
        ],
      );
      count++;
    } catch (err) {
      console.error(
        `[keyword-criterion-parser] Failed to upsert daily stat ${metricName} for ${dateStr}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return count;
}

/** Type C: upsert aggregate metrics (no keyword, no date — use current date). */
async function upsertAggregate(
  pool: import('pg').Pool,
  cid: string,
  item: unknown,
  metricsRaw: string[] | undefined,
  columnMap: Record<number, string>,
  rawPayloadId: string,
): Promise<number> {
  const campaignId = dig(item, '2') as string | undefined;
  const currency = dig(item, '27') as string | undefined;
  const metrics = buildMetrics(metricsRaw, columnMap);

  // Use today's date for aggregates (snapshot date)
  const today = new Date().toISOString().slice(0, 10);

  let count = 0;
  for (const [metricName, value] of Object.entries(metrics)) {
    if (value == null) continue;
    if (!metricName.startsWith('stats.')) continue;

    try {
      await pool.query(
        `INSERT INTO keyword_daily_stats (
           account_google_id, keyword_id, campaign_id, date, metric_name, metric_value, raw_payload_id
         ) VALUES ($1, NULL, $2, $3, $4, $5, $6)
         ON CONFLICT (account_google_id, COALESCE(keyword_id, ''), date, metric_name) DO UPDATE SET
           metric_value = EXCLUDED.metric_value,
           campaign_id = COALESCE(EXCLUDED.campaign_id, keyword_daily_stats.campaign_id),
           raw_payload_id = EXCLUDED.raw_payload_id,
           updated_at = NOW()`,
        [
          cid,
          campaignId ? String(campaignId) : null,
          today,
          metricName,
          value,
          rawPayloadId,
        ],
      );
      count++;
    } catch (err) {
      // Ignore — aggregate duplicates are expected
    }
  }

  // Also store currency in a separate pseudo-metric for reference
  if (currency && count > 0) {
    try {
      await pool.query(
        `INSERT INTO keyword_daily_stats (
           account_google_id, keyword_id, campaign_id, date, metric_name, metric_value, raw_payload_id
         ) VALUES ($1, NULL, $2, $3, '_currency', 0, $4)
         ON CONFLICT (account_google_id, COALESCE(keyword_id, ''), date, metric_name) DO NOTHING`,
        [cid, campaignId ? String(campaignId) : null, today, rawPayloadId],
      );
    } catch {
      // Ignore
    }
  }

  return count;
}
