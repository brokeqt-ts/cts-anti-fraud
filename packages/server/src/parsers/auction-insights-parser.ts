import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Auction Insights parser (KF-1: Competitive Intelligence).
 *
 * Google Ads Auction Insights RPC provides competitor domain data:
 * impression share, overlap rate, position above rate, etc.
 *
 * Since the exact protobuf structure is not yet confirmed from real payloads,
 * this parser:
 * 1. Attempts to extract competitor rows from known candidate paths
 * 2. Falls back to storing the full body as raw_data for later analysis
 *
 * Expected structure (hypothetical, to be confirmed with real data):
 * body.1 = customer_id
 * body.2[] = array of competitor entries, each containing:
 *   entry.1 = competitor domain
 *   entry.2 = impression_share (float 0-1)
 *   entry.3 = overlap_rate
 *   entry.4 = position_above_rate
 *   entry.5 = top_of_page_rate
 *   entry.6 = outranking_share
 */
export async function parseAuctionInsights(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const accountGoogleId = resolveCid(ctx);

  if (!accountGoogleId) {
    console.log(`[auction-insights-parser] No CID resolved, storing raw data only`);
  }

  // Attempt to extract competitor rows from body
  const entries = dig(body, '2') as unknown[] | undefined;
  let parsed = 0;

  if (Array.isArray(entries) && entries.length > 0) {
    for (const entry of entries) {
      if (entry == null || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;

      const competitorDomain = rec['1'] as string | undefined;
      if (!competitorDomain || typeof competitorDomain !== 'string') continue;
      // Skip "you" row (the account itself is often included)
      if (competitorDomain === 'You' || competitorDomain === 'Вы') continue;

      const impressionShare = parseFloat(String(rec['2'] ?? ''));
      const overlapRate = parseFloat(String(rec['3'] ?? ''));
      const positionAboveRate = parseFloat(String(rec['4'] ?? ''));
      const topOfPageRate = parseFloat(String(rec['5'] ?? ''));
      const outrankingShare = parseFloat(String(rec['6'] ?? ''));

      await pool.query(
        `INSERT INTO auction_insights
          (account_google_id, competitor_domain, impression_share, overlap_rate,
           position_above_rate, top_of_page_rate, outranking_share, raw_payload_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (account_google_id, COALESCE(campaign_id, ''), competitor_domain, COALESCE(date_range_start, '1970-01-01'))
         DO UPDATE SET
           impression_share = COALESCE(EXCLUDED.impression_share, auction_insights.impression_share),
           overlap_rate = COALESCE(EXCLUDED.overlap_rate, auction_insights.overlap_rate),
           position_above_rate = COALESCE(EXCLUDED.position_above_rate, auction_insights.position_above_rate),
           top_of_page_rate = COALESCE(EXCLUDED.top_of_page_rate, auction_insights.top_of_page_rate),
           outranking_share = COALESCE(EXCLUDED.outranking_share, auction_insights.outranking_share)`,
        [
          accountGoogleId,
          competitorDomain.toLowerCase(),
          isNaN(impressionShare) ? null : impressionShare,
          isNaN(overlapRate) ? null : overlapRate,
          isNaN(positionAboveRate) ? null : positionAboveRate,
          isNaN(topOfPageRate) ? null : topOfPageRate,
          isNaN(outrankingShare) ? null : outrankingShare,
          rawPayloadId,
        ],
      );
      parsed++;
    }
  }

  // Always store raw data for future re-parsing if structure changes
  if (parsed === 0) {
    // Store a single row with raw_data for manual inspection
    await pool.query(
      `INSERT INTO auction_insights
        (account_google_id, competitor_domain, raw_payload_id, raw_data)
       VALUES ($1, '__raw__', $2, $3)
       ON CONFLICT DO NOTHING`,
      [accountGoogleId ?? '__unknown__', rawPayloadId, JSON.stringify(body)],
    );
    console.log(`[auction-insights-parser] No structured data found, stored raw body for CID ${accountGoogleId}`);
  } else {
    console.log(`[auction-insights-parser] Parsed ${parsed} competitors for CID ${accountGoogleId}`);
  }
}
