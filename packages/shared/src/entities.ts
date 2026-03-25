import type {
  DomainId,
  AccountId,
  CampaignId,
  BanLogId,
  CtsSiteId,
  ProxyId,
  AntidetectProfileId,
  PaymentMethodId,
  PredictionId,
  LeaderboardId,
  AccountConsumableId,
  GoogleAccountId,
} from './branded-types.js';

import type {
  OFFER_VERTICAL,
  CAMPAIGN_TYPE,
  BAN_TARGET,
  APPEAL_STATUS,
  BROWSER_TYPE,
  PROXY_TYPE,
  PROXY_ROTATION,
  PAYMENT_CARD_TYPE,
  AI_PREDICTION_MODEL,
  PREDICTION_TYPE,
  VERIFICATION_STATUS,
  ACCOUNT_STATUS,
  CAMPAIGN_STATUS,
  SSL_TYPE,
  DNS_PROVIDER,
} from './enums.js';

// ─── Level 1: Domain / Site ─────────────────────────────────────────────────

export interface Domain {
  id: DomainId;
  domain_name: string;
  registrar: string | null;
  domain_age_days: number | null;
  whois_privacy: boolean | null;
  ssl_type: SSL_TYPE | null;
  hosting_ip: string | null;
  asn: string | null;
  dns_provider: DNS_PROVIDER | null;
  safe_page_type: string | null;
  content_quality_score: number | null;
  pagespeed_score: number | null;
  has_google_analytics: boolean | null;
  has_gtm: boolean | null;
  has_pixels: boolean | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Level 2: Account (Google Ads) ──────────────────────────────────────────

export interface Account {
  id: AccountId;
  google_account_id: GoogleAccountId;
  display_name: string | null;
  country: string | null;
  account_age_days: number | null;
  status: ACCOUNT_STATUS;
  verification_type: string | null;
  verification_status: VERIFICATION_STATUS;
  total_spend: number;
  payment_bin: string | null;
  payment_bank: string | null;
  payment_card_country: string | null;
  campaign_count: number;
  domain_count: number;
  pre_ban_warnings: string[] | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Level 3: Campaign / Ad ────────────────────────────────────────────────

export interface TargetGeo {
  country_code: string;
  region?: string;
  city?: string;
}

export interface AdText {
  headlines: string[];
  descriptions: string[];
}

export interface Campaign {
  id: CampaignId;
  account_id: AccountId;
  domain_id: DomainId | null;
  cts_site_id: CtsSiteId | null;
  google_campaign_id: string;
  campaign_name: string | null;
  offer_vertical: OFFER_VERTICAL;
  campaign_type: CAMPAIGN_TYPE;
  status: CAMPAIGN_STATUS;
  ad_texts: AdText | null;
  keywords: string[] | null;
  target_geos: TargetGeo[] | null;
  daily_budget: number | null;
  total_budget: number | null;
  bidding_strategy: string | null;
  targeting_settings: Record<string, unknown> | null;
  landing_page_url: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  cost: number;
  time_alive_hours: number | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Level 4: CTS Sites (reference for traffic integration) ────────────────

export interface CtsSite {
  id: CtsSiteId;
  domain: string;
  external_cts_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Level 5: Ban Log ──────────────────────────────────────────────────────

export interface BanLog {
  id: BanLogId;
  account_id: AccountId;
  campaign_id: CampaignId | null;
  domain_id: DomainId | null;
  is_banned: boolean;
  banned_at: string | null;
  ban_reason: string | null;
  ban_target: BAN_TARGET;
  appeal_status: APPEAL_STATUS;
  appeal_result: string | null;
  lifetime_hours: number | null;
  lifetime_spend: number | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Consumables ───────────────────────────────────────────────────────────

export interface Proxy {
  id: ProxyId;
  proxy_type: PROXY_TYPE;
  provider: string | null;
  geo: string | null;
  rotation_type: PROXY_ROTATION | null;
  ip_address: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AntidetectProfile {
  id: AntidetectProfileId;
  browser_type: BROWSER_TYPE;
  profile_external_id: string | null;
  fingerprint_hash: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethod {
  id: PaymentMethodId;
  bin: string | null;
  card_type: PAYMENT_CARD_TYPE | null;
  provider_bank: string | null;
  country: string | null;
  spend_limit: number | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ─── Linking / Graph ───────────────────────────────────────────────────────

export interface AccountConsumable {
  id: AccountConsumableId;
  account_id: AccountId;
  proxy_id: ProxyId | null;
  antidetect_profile_id: AntidetectProfileId | null;
  payment_method_id: PaymentMethodId | null;
  linked_at: string;
  unlinked_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── AI Predictions ────────────────────────────────────────────────────────

export interface Prediction {
  id: PredictionId;
  account_id: AccountId | null;
  campaign_id: CampaignId | null;
  model: AI_PREDICTION_MODEL;
  prediction_type: PREDICTION_TYPE;
  input_hash: string;
  ban_probability: number | null;
  predicted_lifetime_days: number | null;
  actual_result: Record<string, unknown> | null;
  created_at: string;
}

export interface AiLeaderboard {
  id: LeaderboardId;
  model: AI_PREDICTION_MODEL;
  metric_type: string;
  score: number;
  period: string;
  calculated_at: string;
}
