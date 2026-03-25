// Extracts structured data from intercepted Google Ads API responses.
// Maps raw JSON to our schema types.

export interface ExtractedAccountInfo {
  accountId: string;
  displayName?: string;
  status?: string;
  verificationStatus?: string;
  policyViolations?: string[];
}

export interface ExtractedCampaignInfo {
  accountId: string;
  campaignId: string;
  campaignName?: string;
  campaignType?: string;
  status?: string;
  budget?: number;
  targetGeos?: string[];
}

export interface ExtractedPerformanceInfo {
  campaignId: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  conversions?: number;
  cost?: number;
}

export interface ExtractedBillingInfo {
  accountId: string;
  totalSpend?: number;
  paymentBin?: string;
  paymentBank?: string;
  dailySpend?: number;
}

export interface ExtractedAdReview {
  campaignId: string;
  reviewStatus?: string;
  disapprovalReasons?: string[];
}

export type ExtractedData =
  | { type: 'account'; data: ExtractedAccountInfo }
  | { type: 'campaign'; data: ExtractedCampaignInfo }
  | { type: 'performance'; data: ExtractedPerformanceInfo }
  | { type: 'billing'; data: ExtractedBillingInfo }
  | { type: 'ad_review'; data: ExtractedAdReview };

export function extractData(url: string, body: unknown): ExtractedData | null {
  if (!body || typeof body !== 'object') return null;

  const data = body as Record<string, unknown>;
  const urlLower = url.toLowerCase();

  // URL-based routing for classic /aw/ endpoints
  if (urlLower.includes('/aw/account') || urlLower.includes('/aw/customer')) {
    return extractAccountInfo(data);
  }
  if (urlLower.includes('/aw/campaign') || urlLower.includes('/aw/adgroup')) {
    return extractCampaignInfo(data);
  }
  if (urlLower.includes('/aw/reporting') || urlLower.includes('/aw/stats')) {
    return extractPerformanceInfo(data);
  }
  if (urlLower.includes('/aw/billing') || urlLower.includes('/aw/payment')) {
    return extractBillingInfo(data);
  }
  if (urlLower.includes('/aw/review') || urlLower.includes('/aw/policy')) {
    return extractAdReviewInfo(data);
  }

  // Content-based routing for batch RPC / gRPC endpoints (/_/AdsKs, /$rpc/, etc.)
  // These carry all types of data — detect by looking at the response shape.
  return extractByContent(data);
}

function extractByContent(data: Record<string, unknown>): ExtractedData | null {
  // Try each extractor in priority order — return the first match
  const accountResult = extractAccountInfo(data);
  if (accountResult) return accountResult;

  const campaignResult = extractCampaignInfo(data);
  if (campaignResult) return campaignResult;

  const performanceResult = extractPerformanceInfo(data);
  if (performanceResult) return performanceResult;

  const billingResult = extractBillingInfo(data);
  if (billingResult) return billingResult;

  const adReviewResult = extractAdReviewInfo(data);
  if (adReviewResult) return adReviewResult;

  return null;
}

function extractAccountInfo(data: Record<string, unknown>): ExtractedData | null {
  // Google Ads internal API structures vary — extract what we can find
  const accountId = findValue(data, ['customerId', 'customer_id', 'accountId', 'id']);
  if (!accountId) return null;

  return {
    type: 'account',
    data: {
      accountId: String(accountId),
      displayName: findStringValue(data, ['descriptiveName', 'name', 'displayName']),
      status: findStringValue(data, ['status', 'accountStatus']),
      verificationStatus: findStringValue(data, ['verificationStatus', 'verification']),
      policyViolations: findArrayValue(data, ['policyViolations', 'violations']),
    },
  };
}

function extractCampaignInfo(data: Record<string, unknown>): ExtractedData | null {
  const accountId = findValue(data, ['customerId', 'customer_id', 'accountId']);
  const campaignId = findValue(data, ['campaignId', 'campaign_id', 'id']);
  if (!accountId || !campaignId) return null;

  return {
    type: 'campaign',
    data: {
      accountId: String(accountId),
      campaignId: String(campaignId),
      campaignName: findStringValue(data, ['name', 'campaignName']),
      campaignType: findStringValue(data, ['type', 'campaignType', 'advertisingChannelType']),
      status: findStringValue(data, ['status', 'campaignStatus']),
      budget: findNumberValue(data, ['budget', 'dailyBudget', 'budgetAmountMicros']),
      targetGeos: findArrayValue(data, ['geoTargets', 'targetGeos', 'locations']),
    },
  };
}

function extractPerformanceInfo(data: Record<string, unknown>): ExtractedData | null {
  const campaignId = findValue(data, ['campaignId', 'campaign_id', 'id']);
  if (!campaignId) return null;

  return {
    type: 'performance',
    data: {
      campaignId: String(campaignId),
      impressions: findNumberValue(data, ['impressions']),
      clicks: findNumberValue(data, ['clicks']),
      ctr: findNumberValue(data, ['ctr', 'clickThroughRate']),
      cpc: findNumberValue(data, ['cpc', 'averageCpc', 'avgCpc']),
      conversions: findNumberValue(data, ['conversions', 'allConversions']),
      cost: findNumberValue(data, ['cost', 'costMicros', 'totalCost']),
    },
  };
}

function extractBillingInfo(data: Record<string, unknown>): ExtractedData | null {
  const accountId = findValue(data, ['customerId', 'customer_id', 'accountId']);
  if (!accountId) return null;

  return {
    type: 'billing',
    data: {
      accountId: String(accountId),
      totalSpend: findNumberValue(data, ['totalSpend', 'totalAmount', 'spend']),
      paymentBin: findStringValue(data, ['bin', 'cardPrefix', 'last4']),
      paymentBank: findStringValue(data, ['bank', 'issuer', 'bankName']),
      dailySpend: findNumberValue(data, ['dailySpend', 'todaySpend']),
    },
  };
}

function extractAdReviewInfo(data: Record<string, unknown>): ExtractedData | null {
  const campaignId = findValue(data, ['campaignId', 'campaign_id', 'id']);
  if (!campaignId) return null;

  return {
    type: 'ad_review',
    data: {
      campaignId: String(campaignId),
      reviewStatus: findStringValue(data, ['reviewStatus', 'approvalStatus', 'status']),
      disapprovalReasons: findArrayValue(data, [
        'disapprovalReasons',
        'policyTopics',
        'violations',
      ]),
    },
  };
}

// ─── Helper functions for flexible data extraction ──────────────────────────

function findValue(
  obj: Record<string, unknown>,
  keys: string[],
): string | number | undefined {
  for (const key of keys) {
    if (key in obj && obj[key] != null) {
      return obj[key] as string | number;
    }
  }
  // Search one level deep
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = findValue(val as Record<string, unknown>, keys);
      if (nested != null) return nested;
    }
  }
  return undefined;
}

function findStringValue(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  const val = findValue(obj, keys);
  return val != null ? String(val) : undefined;
}

function findNumberValue(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  const val = findValue(obj, keys);
  if (val == null) return undefined;
  const num = Number(val);
  return isNaN(num) ? undefined : num;
}

function findArrayValue(
  obj: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  for (const key of keys) {
    if (key in obj && Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).map(String);
    }
  }
  return undefined;
}
