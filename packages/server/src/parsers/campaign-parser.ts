import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { trackCampaignChanges } from '../services/account-change-tracker.js';

/**
 * CampaignService/List
 *
 * body.1 = array of campaigns
 * Each campaign:
 *   [].1   = customer_id (account_google_id, e.g. "7923171594")
 *   [].2   = campaign_id
 *   [].11  = campaign_name
 *   [].12  = status integer (2=paused, 3=enabled)
 *   [].14  = campaign type integer (2=Search, 3=Display, 9=PMax, etc)
 *   [].17  = budget in micros string (divide by 1000000 for real value)
 *   [].18  = currency
 *   [].50  = target languages array
 *   [].109 = target countries array
 *   [].142 = start date string "YYYYMMDDHHmmss"
 *   [].143 = end date string
 *   [].32  = bidding strategy object
 *     [].32.1 = strategy type enum (2=MANUAL_CPC, 10=MAX_CONVERSIONS, 12=TARGET_CPA, 13=TARGET_ROAS, etc.)
 */
export async function parseCampaigns(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const campaignList = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(campaignList)) {
    console.log(`[campaign-parser] body.1 is not an array, type: ${typeof dig(body, '1')}`);
    return;
  }

  // Extract customer_id from first campaign for CID hint
  const firstCustomerId = campaignList.length > 0
    ? dig(campaignList[0], '1') as string | undefined
    : undefined;

  const cid = resolveCid(ctx, { bodyCustomerId: firstCustomerId });
  console.log(`[campaign-parser] CampaignService/List invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, body CID: ${firstCustomerId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  console.log(`[campaign-parser] Found ${campaignList.length} campaigns for CID ${cid}`);

  for (const campaign of campaignList) {
    if (!campaign || typeof campaign !== 'object') continue;

    try {
      const campaignId = dig(campaign, '2') as string | undefined;
      if (!campaignId) continue;

      const campaignName = dig(campaign, '11') as string | undefined;
      const status = dig(campaign, '12') as number | undefined;
      const campaignType = dig(campaign, '14') as number | undefined;
      const budgetMicrosRaw = dig(campaign, '17') as string | undefined;
      const currency = dig(campaign, '18') as string | undefined;
      const targetLanguages = dig(campaign, '50') as unknown;
      const targetCountries = dig(campaign, '109') as unknown;
      const startDate = dig(campaign, '142') as string | undefined;
      const endDate = dig(campaign, '143') as string | undefined;

      // Bidding strategy: field "32"
      const biddingObj = dig(campaign, '32') as Record<string, unknown> | undefined;
      const biddingStrategyType = biddingObj ? (dig(biddingObj, '1') as number | undefined) : undefined;

      const budgetMicros = budgetMicrosRaw ? parseInt(budgetMicrosRaw, 10) : null;

      // Track campaign changes (non-blocking)
      const incomingCampaign: Record<string, unknown> = {};
      if (status != null) incomingCampaign['status'] = status;
      if (budgetMicros != null) incomingCampaign['budget_micros'] = budgetMicros;
      trackCampaignChanges(pool, cid, String(campaignId), campaignName ?? null, incomingCampaign).catch(() => {});

      await pool.query(
        `INSERT INTO campaigns (
           account_google_id, campaign_id, campaign_name, campaign_type,
           status, budget_micros, currency, target_languages, target_countries,
           start_date, end_date, bidding_strategy_type, bidding_strategy_config,
           raw_payload_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (campaign_id, raw_payload_id) DO UPDATE SET
           campaign_name = COALESCE(EXCLUDED.campaign_name, campaigns.campaign_name),
           campaign_type = COALESCE(EXCLUDED.campaign_type, campaigns.campaign_type),
           status = COALESCE(EXCLUDED.status, campaigns.status),
           budget_micros = COALESCE(EXCLUDED.budget_micros, campaigns.budget_micros),
           currency = COALESCE(EXCLUDED.currency, campaigns.currency),
           target_languages = COALESCE(EXCLUDED.target_languages, campaigns.target_languages),
           target_countries = COALESCE(EXCLUDED.target_countries, campaigns.target_countries),
           start_date = COALESCE(EXCLUDED.start_date, campaigns.start_date),
           end_date = COALESCE(EXCLUDED.end_date, campaigns.end_date),
           bidding_strategy_type = COALESCE(EXCLUDED.bidding_strategy_type, campaigns.bidding_strategy_type),
           bidding_strategy_config = COALESCE(EXCLUDED.bidding_strategy_config, campaigns.bidding_strategy_config),
           updated_at = NOW()`,
        [
          cid,
          String(campaignId),
          campaignName ?? null,
          campaignType ?? null,
          status ?? null,
          Number.isFinite(budgetMicros) ? budgetMicros : null,
          currency ?? null,
          targetLanguages ? JSON.stringify(targetLanguages) : null,
          targetCountries ? JSON.stringify(targetCountries) : null,
          startDate ?? null,
          endDate ?? null,
          biddingStrategyType ?? null,
          biddingObj ? JSON.stringify(biddingObj) : null,
          rawPayloadId,
        ],
      );
    } catch (err) {
      console.error(`[campaign-parser] Failed to insert campaign:`, err instanceof Error ? err.message : err);
    }
  }
}
