import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { upsertDomainAndEnrich } from '../services/domain-enrichment.service.js';
import { trackAdChanges } from '../services/account-change-tracker.js';

/**
 * BatchService/Batch
 *
 * Contains nested ad data in body.2[] which are JSON strings.
 * Each parsed JSON entry contains an array at field "1" with ad objects:
 *
 *   [].1 = customer_id ("7973813934")
 *   [].2 = campaign_id ("23498870570")
 *   [].3 = ad_group_id ("191852253309")
 *   [].4 = ad_id ("794393771163")
 *   [].13.75.1 = display domain ("klimfawn.com")
 *   [].13.100.1 = final_urls array (["https://klimfawn.com/"])
 *   [].13.100.39.1[] = headlines array, each item: .1.3.1 = headline text
 *   [].13.100.39.2[] = descriptions array, each item: .1.3.1 = description text
 */
export async function parseBatch(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  // body.2 is an array of JSON strings (or already parsed objects)
  const batchItems = dig(body, '2') as unknown[] | undefined;
  if (!Array.isArray(batchItems) || batchItems.length === 0) {
    console.log(`[batch-parser] body.2 is not an array or empty`);
    return;
  }

  let totalAds = 0;
  let totalAdGroups = 0;

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

    // The parsed item may contain ad data at field "1" (array) or directly
    const adList = dig(parsed, '1') as unknown[] | undefined;
    if (!Array.isArray(adList)) continue;

    for (const ad of adList) {
      if (!ad || typeof ad !== 'object') continue;

      const customerId = dig(ad, '1') as string | undefined;
      const campaignId = dig(ad, '2') as string | undefined;
      const adGroupId = dig(ad, '3') as string | undefined;
      const adId = dig(ad, '4') as string | undefined;

      if (!adId) continue;

      const cid = resolveCid(ctx, { bodyCustomerId: customerId });
      if (!cid) continue;

      // Extract display URL
      const displayUrl = dig(ad, '13', '75', '1') as string | undefined;

      // Extract final URLs
      const finalUrls = dig(ad, '13', '100', '1') as string[] | undefined;

      // Extract headlines from field 13.100.39.1[]
      const headlineItems = dig(ad, '13', '100', '39', '1') as unknown[] | undefined;
      const headlines: string[] = [];
      if (Array.isArray(headlineItems)) {
        for (const h of headlineItems) {
          const text = dig(h, '1', '3', '1') as string | undefined;
          if (text) headlines.push(text);
        }
      }

      // Extract descriptions from field 13.100.39.2[]
      const descriptionItems = dig(ad, '13', '100', '39', '2') as unknown[] | undefined;
      const descriptions: string[] = [];
      if (Array.isArray(descriptionItems)) {
        for (const d of descriptionItems) {
          const text = dig(d, '1', '3', '1') as string | undefined;
          if (text) descriptions.push(text);
        }
      }

      // Determine ad type based on presence of headlines
      const adType = headlines.length > 0 ? 'responsive_search' : null;

      // Extract review status if available (field 13.3)
      const reviewStatusRaw = dig(ad, '13', '3') as number | undefined;
      const reviewStatus = reviewStatusRaw != null ? String(reviewStatusRaw) : null;

      // Track ad review status changes (non-blocking)
      if (reviewStatus && cid && adId) {
        trackAdChanges(pool, cid, String(adId), reviewStatus).catch(() => {});
      }

      try {
        await pool.query(
          `INSERT INTO ads (
             account_google_id, campaign_id, ad_group_id, ad_id,
             headlines, descriptions, final_urls, display_url,
             ad_type, review_status, raw_payload_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (ad_id, raw_payload_id) DO UPDATE SET
             headlines = COALESCE(EXCLUDED.headlines, ads.headlines),
             descriptions = COALESCE(EXCLUDED.descriptions, ads.descriptions),
             final_urls = COALESCE(EXCLUDED.final_urls, ads.final_urls),
             display_url = COALESCE(EXCLUDED.display_url, ads.display_url),
             ad_type = COALESCE(EXCLUDED.ad_type, ads.ad_type),
             review_status = COALESCE(EXCLUDED.review_status, ads.review_status),
             updated_at = NOW()`,
          [
            cid,
            campaignId ? String(campaignId) : null,
            adGroupId ? String(adGroupId) : null,
            String(adId),
            headlines.length > 0 ? JSON.stringify(headlines) : null,
            descriptions.length > 0 ? JSON.stringify(descriptions) : null,
            Array.isArray(finalUrls) && finalUrls.length > 0 ? JSON.stringify(finalUrls) : null,
            displayUrl ?? null,
            adType,
            reviewStatus,
            rawPayloadId,
          ],
        );
        totalAds++;

        // АВТОМАТИЗАЦИЯ 4: Discover new domains from final_urls
        if (Array.isArray(finalUrls)) {
          for (const url of finalUrls) {
            if (typeof url === 'string') upsertDomainAndEnrich(pool, url);
          }
        }
      } catch (err) {
        console.error(`[batch-parser] Failed to insert ad ${adId}:`, err instanceof Error ? err.message : err);
      }

      // Also insert into ad_groups if we have ad group data
      if (adGroupId) {
        try {
          await pool.query(
            `INSERT INTO ad_groups (account_google_id, campaign_id, ad_group_id, raw_payload_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (ad_group_id, raw_payload_id) DO NOTHING`,
            [cid, campaignId ? String(campaignId) : null, String(adGroupId), rawPayloadId],
          );
          totalAdGroups++;
        } catch {
          // Ignore duplicates
        }
      }
    }
  }

  if (totalAds > 0 || totalAdGroups > 0) {
    console.log(`[batch-parser] Inserted ${totalAds} ads, ${totalAdGroups} ad_groups from BatchService/Batch`);
  }
}
