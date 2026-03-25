import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Quality Score parser.
 *
 * Extracts Quality Score components from Google Ads RPC responses that
 * include keyword criterion data with QS fields. Works as a complementary
 * parser to keyword-criterion-parser — this one focuses specifically on
 * QS extraction and historical tracking.
 *
 * Quality Score fields in Google Ads protobuf-style JSON:
 *   item["105"]  = quality_score (1-10 overall)
 *   item["28"]   = expected_ctr component (enum: 1=BELOW_AVERAGE, 2=AVERAGE, 3=ABOVE_AVERAGE)
 *   item["29"]   = ad_relevance component (same enum)
 *   item["30"]   = landing_page_experience component (same enum)
 *
 * Also handles BatchService/Batch payloads where QualityScore data may arrive
 * nested inside body.2[] as JSON strings.
 */

interface QualityScoreData {
  accountGoogleId: string;
  keywordId: string;
  qualityScore: number | null;
  expectedCtr: number | null;
  adRelevance: number | null;
  landingPageExperience: number | null;
}

/**
 * Parse quality score data from a batch/criterion response.
 * Returns extracted QS entries (may be empty if no QS data found).
 */
export function extractQualityScores(body: unknown, ctx: RpcContext): QualityScoreData[] {
  const results: QualityScoreData[] = [];

  // Strategy 1: body.2[] — BatchService responses (JSON strings or objects)
  const batchItems = dig(body, '2') as unknown[] | undefined;
  if (Array.isArray(batchItems)) {
    for (const rawItem of batchItems) {
      let parsed: unknown;
      if (typeof rawItem === 'string') {
        try { parsed = JSON.parse(rawItem); } catch { continue; }
      } else {
        parsed = rawItem;
      }
      if (!parsed || typeof parsed !== 'object') continue;

      const items = dig(parsed, '1') as unknown[] | undefined;
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        const entry = extractSingleQS(item, ctx);
        if (entry) results.push(entry);
      }
    }
    return results;
  }

  // Strategy 2: body.1[] — direct list response
  const directItems = dig(body, '1') as unknown[] | undefined;
  if (Array.isArray(directItems)) {
    for (const item of directItems) {
      const entry = extractSingleQS(item, ctx);
      if (entry) results.push(entry);
    }
  }

  return results;
}

function extractSingleQS(item: unknown, ctx: RpcContext): QualityScoreData | null {
  if (!item || typeof item !== 'object') return null;

  const keywordId = dig(item, '4') as string | undefined;
  if (!keywordId) return null;

  const qualityScore = dig(item, '105') as number | undefined;
  const expectedCtr = dig(item, '28') as number | undefined;
  const adRelevance = dig(item, '29') as number | undefined;
  const landingPageExperience = dig(item, '30') as number | undefined;

  // Only return if at least one QS component exists
  if (qualityScore == null && expectedCtr == null && adRelevance == null && landingPageExperience == null) {
    return null;
  }

  const customerId = dig(item, '1') as string | undefined;
  const cid = resolveCid(ctx, { bodyCustomerId: customerId });
  if (!cid) return null;

  return {
    accountGoogleId: cid,
    keywordId: String(keywordId),
    qualityScore: qualityScore != null && qualityScore >= 1 && qualityScore <= 10 ? qualityScore : null,
    expectedCtr: expectedCtr ?? null,
    adRelevance: adRelevance ?? null,
    landingPageExperience: landingPageExperience ?? null,
  };
}

/**
 * Parse and store Quality Score data + history snapshots.
 *
 * Called from rpc-router for QualityScore-related RPC endpoints.
 * Updates the keywords table (current QS) and inserts into
 * keyword_quality_history (daily snapshots for trend tracking).
 */
export async function parseQualityScores(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const entries = extractQualityScores(body, ctx);
  if (entries.length === 0) return;

  let updated = 0;
  let historySaved = 0;

  for (const entry of entries) {
    try {
      // 1. Update keywords table with latest QS
      const result = await pool.query(
        `UPDATE keywords SET
           quality_score = COALESCE($1, quality_score),
           qs_expected_ctr = COALESCE($2, qs_expected_ctr),
           qs_ad_relevance = COALESCE($3, qs_ad_relevance),
           qs_landing_page = COALESCE($4, qs_landing_page),
           raw_payload_id = $5,
           updated_at = NOW()
         WHERE account_google_id = $6 AND keyword_id = $7`,
        [
          entry.qualityScore,
          entry.expectedCtr,
          entry.adRelevance,
          entry.landingPageExperience,
          rawPayloadId,
          entry.accountGoogleId,
          entry.keywordId,
        ],
      );

      if ((result.rowCount ?? 0) > 0) updated++;

      // 2. Insert history snapshot (daily dedup)
      await pool.query(
        `INSERT INTO keyword_quality_history (
           account_google_id, keyword_id, date,
           quality_score, expected_ctr, ad_relevance, landing_page_experience,
           raw_payload_id
         ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)
         ON CONFLICT (account_google_id, keyword_id, date) DO UPDATE SET
           quality_score = COALESCE(EXCLUDED.quality_score, keyword_quality_history.quality_score),
           expected_ctr = COALESCE(EXCLUDED.expected_ctr, keyword_quality_history.expected_ctr),
           ad_relevance = COALESCE(EXCLUDED.ad_relevance, keyword_quality_history.ad_relevance),
           landing_page_experience = COALESCE(EXCLUDED.landing_page_experience, keyword_quality_history.landing_page_experience),
           raw_payload_id = EXCLUDED.raw_payload_id,
           updated_at = NOW()`,
        [
          entry.accountGoogleId,
          entry.keywordId,
          entry.qualityScore,
          entry.expectedCtr,
          entry.adRelevance,
          entry.landingPageExperience,
          rawPayloadId,
        ],
      );
      historySaved++;
    } catch (err) {
      console.error(
        `[quality-score-parser] Failed to save QS for keyword ${entry.keywordId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (updated > 0 || historySaved > 0) {
    console.log(`[quality-score-parser] Updated ${updated} keywords, saved ${historySaved} history snapshots`);
  }
}
