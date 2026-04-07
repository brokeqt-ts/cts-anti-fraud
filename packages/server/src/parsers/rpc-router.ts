import type pg from 'pg';
import { ensureAccountExists } from '../services/ensure-account.js';
import { parseBillingSettings, parsePaymentsSignupInfo, parseTransactionsDetails } from './billing-parser.js';
import { parseBillingSummaryInfo, parseSettingsDetails } from './billing-info-parser.js';
import { parseCampaigns } from './campaign-parser.js';
import { parseSignals } from './signals-parser.js';
import { parseNotifications } from './notifications-parser.js';
import { parseRiskVerdict } from './risk-parser.js';
import { parseOverview } from './overview-parser.js';
import { parseBatch } from './batch-parser.js';
import { parseCustomerList } from './customer-parser.js';
import { parseMultiLoginUser } from './multilogin-parser.js';
import { parseAppealStatus } from './appeal-parser.js';
import { parseAdGroups } from './adgroup-parser.js';
import { parseTransactionDetails } from './transaction-detail-parser.js';
import { parseVerificationEligibility } from './verification-parser.js';
import { parseCustomerBilling } from './customer-billing-parser.js';
import { parseInsightDiagnostics, parseCriterionDiagnosis } from './insight-parser.js';
import { parsePolicyTopics } from './policy-parser.js';
import { parseKeywordCriteria } from './keyword-criterion-parser.js';
import { parseChangeHistory } from './change-history-parser.js';
import { parseAuctionInsights } from './auction-insights-parser.js';
import { parseBillingRequestBody } from './billing-payment-parser.js';
import { parseQualityScores } from './quality-score-parser.js';

export interface RpcContext {
  pool: pg.Pool;
  rawPayloadId: string;
  sourceUrl: string;
  accountGoogleId: string | null;
  profileId: string | null;
  body: unknown;
}

/** Safe deep access for protobuf-style JSON with numeric string keys. */
export function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Extract Google Ads CID from URL param ocid only.
 *  __c is an internal Google customer ID, NOT the Ads account CID. */
function extractCid(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('ocid') ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse CID from an account nickname like "Google Ads 385-165-5493".
 * Returns "3851655493" (dashes removed).
 */
export function parseCidFromNickname(nickname: string): string | null {
  const match = nickname.match(/Google Ads\s+([\d-]+)/);
  if (!match?.[1]) return null;
  return match[1].replace(/-/g, '');
}

/** Check if a value looks like a Google Ads customer ID (7-13 digits). */
function looksLikeCid(value: unknown): string | null {
  if (typeof value === 'string' && /^\d{7,13}$/.test(value)) return value;
  if (typeof value === 'number' && value >= 1_000_000 && value <= 9_999_999_999_999) return String(value);
  return null;
}

/** Validate that a string is a plausible Google Ads CID (7-13 digits only). */
export function isValidGoogleCid(id: string): boolean {
  return /^\d{7,13}$/.test(id);
}

export interface CidHints {
  /** Account nickname like "Google Ads 385-165-5493" */
  nickname?: string | null;
  /** Direct customer_id extracted from body (e.g. CampaignService body.1[0].1) */
  bodyCustomerId?: string | null;
}

/**
 * Shared CID resolution used by ALL parsers.
 *
 * Priority:
 * 1. URL param ocid (via ctx.accountGoogleId)
 * 2. URL param __c (via ctx.accountGoogleId)
 * 3. Direct customer_id hint from body (hints.bodyCustomerId — parser must extract explicitly)
 * 4. Account nickname hint parsed as "Google Ads XXX-XXX-XXXX"
 * 5. Fallback: profileId (may be googleCid from page URL or antidetect profile name)
 *
 * NOTE: body["1"] was removed as a fallback — field "1" in protobuf varies by service
 * and frequently contains non-CID numeric IDs (tracking IDs, timestamps, etc.).
 */
export function resolveCid(ctx: RpcContext, hints?: CidHints): string | null {
  // 1-2. URL params (ocid, __c) — already extracted into ctx.accountGoogleId
  if (ctx.accountGoogleId) return ctx.accountGoogleId;

  // 3. Direct customer_id from body (explicitly passed by parser)
  if (hints?.bodyCustomerId) {
    const cid = looksLikeCid(hints.bodyCustomerId);
    if (cid) return cid;
  }

  // 4. Parse from nickname ("Google Ads 385-165-5493")
  if (hints?.nickname) {
    const fromNickname = parseCidFromNickname(hints.nickname);
    if (fromNickname) return fromNickname;
  }

  // 5. Fallback: profileId — only if it looks like a valid CID (not an antidetect profile name)
  if (ctx.profileId && isValidGoogleCid(ctx.profileId)) return ctx.profileId;
  return null;
}

/** Extract RPC service path from URL (e.g. "SettingsSummaryService/GetSummary"). */
function extractRpcPath(url: string): string | null {
  const match = url.match(/\/rpc\/([^?]+)/);
  return match?.[1] ?? null;
}

/**
 * Process a raw_payload record through the appropriate RPC parser.
 * Returns true if a parser handled it, false if skipped.
 */
export async function processRpcPayload(
  pool: pg.Pool,
  rawPayloadId: string,
  sourceUrl: string,
  rawData: Record<string, unknown>,
  profileId?: string | null,
  userId?: string,
): Promise<boolean> {
  // batchexecute from payment domains — may contain payment method data in request body
  if (sourceUrl.includes('batchexecute') && (sourceUrl.includes('payments.google.com') || sourceUrl.includes('pay.google.com'))) {
    const requestBody = rawData['requestBody'] as string | undefined;
    if (requestBody) {
      const parsed = parseBillingRequestBody(requestBody);
      if (parsed) {
        console.log(`[rpc-router] Billing batchexecute parsed: ${parsed.cardNetwork} •••• ${parsed.last4}`);
      }
      // Data is already handled by CollectService.processBillingRequest — log only here
    }
    return true;
  }

  // Non-RPC URLs from additional domains (pay, payments, myaccount, accounts)
  // are stored as raw_payloads but have no RPC parser — skip gracefully.
  if (!sourceUrl.includes('/rpc/')) {
    try {
      const host = new URL(sourceUrl, 'https://ads.google.com').hostname;
      const EXTRA_DOMAINS = ['pay.google.com', 'payments.google.com', 'myaccount.google.com', 'accounts.google.com'];
      if (EXTRA_DOMAINS.includes(host)) {
        // Data is preserved in raw_payloads — just log for future parser development
        console.log(`[rpc-router] Non-RPC data from ${host} stored as raw (${rawPayloadId})`);
      }
    } catch {
      // Malformed URL — skip
    }
    return false;
  }

  const rpcPath = extractRpcPath(sourceUrl);
  if (!rpcPath) return false;

  // body may be a string (from extension via collect) or already parsed object (from JSONB in backfill)
  const rawBody = rawData['body'];
  if (rawBody == null) return false;

  let body: unknown;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return false;
    }
  } else {
    body = rawBody;
  }

  const accountGoogleId = extractCid(sourceUrl);
  const ctx: RpcContext = { pool, rawPayloadId, sourceUrl, accountGoogleId, profileId: profileId ?? null, body };

  // Ensure account exists before any parser runs.
  // Only use CID from URL params (ocid/__c) — profileId fallback may be a non-CID
  // Google internal ID (GAIA, conversion tracking ID, etc.) that passes digit validation
  // but is not a real Google Ads customer ID.
  if (ctx.accountGoogleId) {
    await ensureAccountExists(pool, ctx.accountGoogleId, userId);
  }

  if (rpcPath.includes('SettingsSummaryService/GetSummary')) {
    await parseBillingSettings(ctx);
    return true;
  }
  if (rpcPath.includes('PaymentsSignupInfoService/Get')) {
    await parsePaymentsSignupInfo(ctx);
    return true;
  }
  if (rpcPath.includes('TransactionsDetailsService/GetDetails')) {
    await parseTransactionsDetails(ctx);
    await parseTransactionDetails(ctx);
    return true;
  }
  if (rpcPath.includes('EducationFeatureService/GetSignals')) {
    await parseSignals(ctx);
    return true;
  }
  if (rpcPath.includes('NotificationService/List')) {
    await parseNotifications(ctx);
    return true;
  }
  if (rpcPath.includes('HagridRiskVerdictService/GetHagridRiskVerdict')) {
    await parseRiskVerdict(ctx);
    return true;
  }

  // Phase 2 parsers: campaigns & billing
  if (rpcPath.includes('CampaignService/List')) {
    await parseCampaigns(ctx);
    return true;
  }
  if (rpcPath.includes('CampaignTrialService/List')) {
    // Skip — contains no campaign data, just metadata
    return true;
  }
  if (rpcPath.includes('BillingSummaryInfoService/Get')) {
    await parseBillingSummaryInfo(ctx);
    return true;
  }
  if (rpcPath.includes('SettingsDetailsService/GetDetails')) {
    await parseSettingsDetails(ctx);
    return true;
  }
  if (rpcPath.includes('BillingSetupService/List')) {
    // Skip — empty body in our data
    return true;
  }

  // Phase 3: overview metrics
  if (rpcPath.includes('OverviewService/Get')) {
    await parseOverview(ctx);
    return true;
  }

  // Phase 3b: additional RPC parsers

  // BatchService/Batch — route by rpcTrackingId subtype
  if (rpcPath.includes('BatchService/Batch')) {
    if (sourceUrl.includes('AdGroupCriterionService.List')) {
      await parseKeywordCriteria(ctx);
      await parseQualityScores(ctx); // Also save QS history snapshots
    } else {
      await parseBatch(ctx);
    }
    return true;
  }

  // QualityScore-related RPC endpoints
  if (
    rpcPath.includes('QualityScore') ||
    rpcPath.includes('KeywordPlanService') ||
    rpcPath.includes('AdGroupCriterionService')
  ) {
    await parseQualityScores(ctx);
    return true;
  }

  // Direct AdGroupAdService/List (not via BatchService) — reuse batch parser
  if (rpcPath.includes('AdGroupAdService/List')) {
    await parseBatch(ctx);
    return true;
  }
  if (rpcPath.includes('CustomerService/List') || rpcPath.includes('CtCustomerService/List')) {
    await parseCustomerList(ctx);
    return true;
  }
  if (rpcPath.includes('MultiLoginUserService/Get')) {
    await parseMultiLoginUser(ctx);
    return true;
  }
  if (rpcPath.includes('AccountSuspensionAppealService/List')) {
    await parseAppealStatus(ctx);
    return true;
  }
  if (rpcPath.includes('CustomerVerificationEligibilityService/List')) {
    await parseVerificationEligibility(ctx);
    return true;
  }
  if (rpcPath.includes('CustomerBillingService/List')) {
    await parseCustomerBilling(ctx);
    return true;
  }
  if (rpcPath.includes('AdGroupService/List')) {
    await parseAdGroups(ctx);
    return true;
  }
  if (rpcPath.includes('InsightService/GetDiagnostics')) {
    await parseInsightDiagnostics(ctx);
    return true;
  }
  if (rpcPath.includes('CriterionDiagnosisService/Diagnose')) {
    await parseCriterionDiagnosis(ctx);
    return true;
  }
  if (rpcPath.includes('LocalizedPolicyTopicService/GetAllLocalizedPolicyTopics')) {
    await parsePolicyTopics(ctx);
    return true;
  }

  // GAP 4 — Change history: capture ChangeEvent, ChangeHistory, MutateLog services
  if (
    rpcPath.includes('ChangeEvent') ||
    rpcPath.includes('ChangeHistory') ||
    rpcPath.includes('MutateLog') ||
    rpcPath.includes('ChangeStatus')
  ) {
    await parseChangeHistory(ctx);
    return true;
  }

  // BillingActivityService — may contain detailed billing activity; capture in change history
  if (rpcPath.includes('BillingActivityService/List')) {
    await parseChangeHistory(ctx);
    return true;
  }

  // KF-1: Auction Insights — competitive intelligence
  if (
    rpcPath.includes('AuctionInsight') ||
    rpcPath.includes('CompetitorDomain') ||
    rpcPath.includes('auction_insight') ||
    rpcPath.includes('InsightService/GetAuctionInsights') ||
    rpcPath.includes('ImpressionShare')
  ) {
    console.log(`[rpc-router] Auction Insights RPC detected: ${rpcPath}`);
    await parseAuctionInsights(ctx);
    await parseChangeHistory(ctx); // Also store in change_history for inspection
    return true;
  }

  // AggregateNotificationService — may contain aggregated ban/policy warnings
  if (rpcPath.includes('AggregateNotificationService/List')) {
    await parseNotifications(ctx);
    return true;
  }

  // ConversionTypeService — conversion tracking setup
  if (rpcPath.includes('ConversionTypeService/List')) {
    await parseChangeHistory(ctx);
    return true;
  }

  // EU compliance verification eligibility
  if (rpcPath.includes('EuParSelfDeclarationEligibilityService')) {
    await parseChangeHistory(ctx);
    return true;
  }

  // User access list — which accounts the user can access
  if (rpcPath.includes('UserCustomerAccessService/List')) {
    await parseCustomerList(ctx);
    return true;
  }

  // Suggestion/recommendation signals from Google
  if (rpcPath.includes('SuggestionService/Get')) {
    await parseChangeHistory(ctx);
    return true;
  }

  // Gaia (Google account) info
  if (rpcPath.includes('GaiaInfoService/Get') || rpcPath.includes('UserByGaiaService/Get')) {
    await parseMultiLoginUser(ctx);
    return true;
  }

  // Known endpoints with no useful anti-fraud data — skip silently
  if (
    rpcPath.includes('BotGuardCreationService/Get') ||
    rpcPath.includes('CustomerUserAppDataService/Mutate') ||
    rpcPath.includes('IdentityAuthTokenService/Get') ||
    rpcPath.includes('PaymentsFixFlowTokenService/Get') ||
    rpcPath.includes('UiCustomizationService/List') ||
    rpcPath.includes('EducationFeatureService/Get') ||
    rpcPath.includes('CallRegionService/GetAllRegions') ||
    rpcPath.includes('ClipboardService') ||
    rpcPath.includes('UserGuidedFlowExecutionInfoService') ||
    rpcPath.includes('AwnCatalogService') ||
    rpcPath.includes('ManagerBillingSetupService/List') ||
    // Base64-encoded internal service (Nikhil Agarwal) — no useful data
    rpcPath.includes('TmlraGlsIEFnYXJ3YWw/Get') ||
    // Onboarding — profile name, coupons, session data (low anti-fraud value)
    rpcPath.includes('OnboardingService/GetGaiaProfileUserName') ||
    rpcPath.includes('CodelessIncentiveService/GetIncentiveGroup') ||
    rpcPath.includes('RedeemedCouponService/List') ||
    rpcPath.includes('ConstructionSessionDataService/Mutate') ||
    rpcPath.includes('CustomerAppDataService/Mutate')
  ) {
    return true;
  }

  // Unmatched RPC — log for future parser development (data is preserved in raw_payloads)
  console.log(`[rpc-router] Unmatched RPC: ${rpcPath} (${rawPayloadId})`);
  return false;
}
