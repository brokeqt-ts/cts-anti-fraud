import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * AdGroupService/List
 *
 * body.1[] = array of ad groups
 * Each ad group:
 *   [].1 = customer_id
 *   [].2 = ad_group_id
 *   [].3 = campaign_id
 *   [].4 = ad_group_name
 *   [].5 = status integer
 */
export async function parseAdGroups(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const adGroupList = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(adGroupList) || adGroupList.length === 0) {
    console.log(`[adgroup-parser] body.1 is not an array or empty`);
    return;
  }

  const firstCustomerId = adGroupList.length > 0
    ? dig(adGroupList[0], '1') as string | undefined
    : undefined;

  const cid = resolveCid(ctx, { bodyCustomerId: firstCustomerId });
  console.log(`[adgroup-parser] AdGroupService/List invoked — CID: ${cid ?? '(none)'}, found ${adGroupList.length} ad groups`);
  if (!cid) return;

  let inserted = 0;

  for (const adGroup of adGroupList) {
    if (!adGroup || typeof adGroup !== 'object') continue;

    const adGroupId = dig(adGroup, '2') as string | undefined;
    if (!adGroupId) continue;

    const campaignId = dig(adGroup, '3') as string | undefined;
    const adGroupName = dig(adGroup, '4') as string | undefined;
    const status = dig(adGroup, '5') as number | undefined;

    try {
      await pool.query(
        `INSERT INTO ad_groups (
           account_google_id, campaign_id, ad_group_id, ad_group_name, status, raw_payload_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (ad_group_id, raw_payload_id) DO UPDATE SET
           ad_group_name = COALESCE(EXCLUDED.ad_group_name, ad_groups.ad_group_name),
           status = COALESCE(EXCLUDED.status, ad_groups.status),
           campaign_id = COALESCE(EXCLUDED.campaign_id, ad_groups.campaign_id),
           updated_at = NOW()`,
        [
          cid,
          campaignId ? String(campaignId) : null,
          String(adGroupId),
          adGroupName ?? null,
          status ?? null,
          rawPayloadId,
        ],
      );
      inserted++;
    } catch (err) {
      console.error(`[adgroup-parser] Failed to insert ad group ${adGroupId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[adgroup-parser] Inserted ${inserted} ad groups for CID ${cid}`);
}
