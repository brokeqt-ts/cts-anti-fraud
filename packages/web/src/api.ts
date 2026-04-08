import { getStoredAccessToken, getStoredRefreshToken } from './contexts/auth-context.js';

const API_PREFIX = '/api/v1';
const LS_KEY_URL = 'cts_api_url';
const LS_KEY_API = 'cts_api_key';

export function getApiUrl(): string {
  return localStorage.getItem(LS_KEY_URL) || import.meta.env.VITE_API_URL || '';
}

export function getApiKey(): string {
  return localStorage.getItem(LS_KEY_API) || import.meta.env.VITE_API_KEY || '';
}

export function setApiUrl(url: string): void {
  localStorage.setItem(LS_KEY_URL, url);
}

export function setApiKey(key: string): void {
  localStorage.setItem(LS_KEY_API, key);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** In-flight refresh promise to prevent concurrent refreshes. */
let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  const rt = getStoredRefreshToken();
  if (!rt) return null;

  const res = await fetch(`${getApiUrl()}${API_PREFIX}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rt }),
  });

  if (!res.ok) {
    // Refresh failed — clear tokens and redirect to login
    localStorage.removeItem('cts_access_token');
    localStorage.removeItem('cts_refresh_token');
    localStorage.removeItem('cts_user');
    window.location.href = '/login';
    return null;
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string };
  localStorage.setItem('cts_access_token', data.access_token);
  localStorage.setItem('cts_refresh_token', data.refresh_token);
  return data.access_token;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};

  // Prefer JWT Bearer token, fall back to X-API-Key
  const accessToken = getStoredAccessToken();
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else {
    const apiKey = getApiKey();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }
  }

  if (init?.body != null) {
    headers['Content-Type'] = 'application/json';
  }

  let res = await fetch(`${getApiUrl()}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  // Auto-refresh on 401 if we have a refresh token
  if (res.status === 401 && getStoredRefreshToken()) {
    // Deduplicate concurrent refreshes
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken().finally(() => { refreshPromise = null; });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      // Retry original request with new token
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      res = await fetch(`${getApiUrl()}${API_PREFIX}${path}`, {
        ...init,
        headers: {
          ...retryHeaders,
          ...(init?.headers as Record<string, string> | undefined),
        },
      });
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  // 204 No Content has no body — don't try to parse JSON
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Admin: User management ---

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'buyer';
  api_key_scope: 'full' | 'collect_only';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  api_key?: string;
}

export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  role?: 'admin' | 'buyer';
}

export interface UpdateUserRequest {
  name?: string;
  email?: string;
  role?: 'admin' | 'buyer';
  is_active?: boolean;
  api_key_scope?: 'full' | 'collect_only';
}

export const fetchUsers = async (): Promise<AdminUser[]> => {
  const data = await apiFetch<{ users: AdminUser[] }>('/admin/users');
  return data.users;
};

export const fetchUser = (id: string): Promise<AdminUser> =>
  apiFetch(`/admin/users/${id}`);

export const createUser = (data: CreateUserRequest): Promise<{ user: AdminUser }> =>
  apiFetch('/admin/users', { method: 'POST', body: JSON.stringify(data) });

export const updateUser = (id: string, data: UpdateUserRequest): Promise<{ user: AdminUser }> =>
  apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteUser = (id: string): Promise<{ deleted: boolean }> =>
  apiFetch(`/admin/users/${id}`, { method: 'DELETE' });

export const resetUserApiKey = (id: string): Promise<{ id: string; name: string; api_key: string }> =>
  apiFetch(`/admin/users/${id}/reset-api-key`, { method: 'POST' });

export const changeUserPassword = (id: string, password: string): Promise<{ status: string }> =>
  apiFetch(`/admin/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });

// --- Extension download ---

/** Fetch a binary endpoint with auth + auto-refresh, then trigger browser download. */
async function downloadBlob(path: string, filename: string): Promise<void> {
  const doFetch = async () => {
    const headers: Record<string, string> = {};
    const token = getStoredAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      const apiKey = getApiKey();
      if (apiKey) headers['X-API-Key'] = apiKey;
    }
    return fetch(`${getApiUrl()}${API_PREFIX}${path}`, { headers });
  };

  let res = await doFetch();

  if (res.status === 401 && getStoredRefreshToken()) {
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken().finally(() => { refreshPromise = null; });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger browser download of the extension zip (current user's key baked in). */
export async function downloadExtension(): Promise<void> {
  await downloadBlob('/extension/download', 'cts-extension.zip');
}

/** Admin: download extension zip with a specific user's key baked in. */
export async function downloadExtensionForUser(userId: string): Promise<void> {
  await downloadBlob(`/extension/download/${userId}`, 'cts-extension.zip');
}

// --- Types ---

export interface ActivityEvent {
  id: string;
  type: 'ban' | 'signal' | 'notification' | 'account';
  account_google_id: string;
  display_name: string;
  message: string;
  timestamp: string;
}

export interface OverviewStats {
  total_accounts: number;
  total_bans: number;
  active_accounts: number;
  suspended_accounts?: number;
  at_risk_accounts?: number;
  avg_lifetime_hours: number | null;
  bans_by_vertical: Record<string, number>;
  bans_by_target: Record<string, number>;
  recent_bans: BanSummary[];
  signals_summary: Record<string, number>;
  lifetime_distribution?: Record<string, number>;
  weekly_ban_trend?: Array<{ week: string; count: number }>;
}

export interface BanSummary {
  id: string;
  account_google_id: string;
  banned_at: string;
  ban_target: string;
  ban_reason: string | null;
  ban_reason_internal: string | null;
  offer_vertical: string | null;
  domain: string | null;
  campaign_type: string | null;
  lifetime_hours: number | null;
  source?: string; // 'auto' | 'manual'
  resolved_at?: string | null;
  post_mortem?: PostMortemData | null;
  post_mortem_generated_at?: string | null;
  created_at: string;
}

export interface BanDetail extends BanSummary {
  snapshot: unknown;
  is_banned: boolean;
  appeal_status: string;
  appeal_result: string | null;
  lifetime_spend: number | null;
  raw_payload: unknown;
}

export interface AccountSummary {
  id: string;
  google_account_id: string;
  display_name: string | null;
  account_status: string | null;
  payer_name: string | null;
  currency: string | null;
  updated_at: string;
  ban_count: string;
  suspended_signal: unknown;
  last_seen: string | null;
  country?: string;
  payment_method?: string;
  notifications_count?: number;
  domain?: string | null;
  profile_name?: string | null;
  browser_type?: string | null;
  card_info?: string | null;
  first_seen?: string | null;
  account_type?: string | null;
  account_type_source?: string | null;
  tags?: Array<{ id: string; name: string; color: string }>;
}

export interface CampaignRow {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  campaign_type: number | string | null;
  status: number | string | null;
  budget_micros: string | null;
  currency: string | null;
  target_languages: unknown;
  target_countries: unknown;
  start_date: string | null;
  end_date: string | null;
  bidding_strategy_type?: number | null;
  bidding_strategy_config?: unknown;
  captured_at: string;
}

export interface KeywordRow {
  id: string;
  keyword_id: string;
  campaign_id: string;
  ad_group_id: string;
  keyword_text: string;
  match_type: number | null;
  is_negative: boolean;
  status: number | null;
  quality_score: number | null;
  qs_expected_ctr: number | null;
  qs_ad_relevance: number | null;
  qs_landing_page: number | null;
  impressions: string | null;
  clicks: string | null;
  cost_micros: string | null;
  ctr: string | null;
  avg_cpc_micros: string | null;
  conversions: string | null;
  conversion_rate: string | null;
  cost_per_conversion_micros: string | null;
  currency: string | null;
  max_cpc_micros: string | null;
  captured_at: string;
}

export interface KeywordDailyStat {
  date: string;
  metric_name: string;
  metric_value: string | null;
}

export interface CampaignMetric {
  campaign_id: string;
  impressions: string | null;
  clicks: string | null;
  ctr: string | null;
  cost_micros: string | null;
  avg_cpc_micros: string | null;
}

export interface BillingRow {
  id: string;
  payment_method: string | null;
  payment_method_icon_url: string | null;
  balance_formatted: string | null;
  threshold_micros: string | null;
  billing_cycle_end: unknown;
  captured_at: string;
}

export interface NotificationDetail {
  id: string;
  notification_id: string | null;
  title: string | null;
  description: string | null;
  category: string; // CRITICAL, WARNING, INFO
  notification_type: string | null;
  label: string | null;
  priority: string | null;
  captured_at: string;
}

export interface MetricRow {
  id: string;
  metric_type: string;
  date_range: string | null;
  data_points: unknown;
  total_value: string | null;
  captured_at: string;
}

export interface AdRow {
  id: string;
  ad_id: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  headlines: string[] | null;
  descriptions: string[] | null;
  final_urls: string[] | null;
  display_url: string | null;
  ad_type: string | null;
  review_status: string | null;
  captured_at: string;
}

export interface AdGroupRow {
  id: string;
  ad_group_id: string;
  ad_group_name: string | null;
  campaign_id: string | null;
  status: number | null;
  captured_at: string;
}

export interface AccountDetail {
  account: Record<string, unknown>;
  signals: Array<{ id: string; signal_name: string; signal_value: unknown; captured_at: string }>;
  notifications: Array<{ id: string; notifications: unknown; captured_at: string }>;
  notification_details?: NotificationDetail[];
  bans: BanSummary[];
  payload_stats: { total_payloads: string; first_seen: string | null; last_seen: string | null };
  campaigns?: CampaignRow[];
  billing?: BillingRow | null;
  metrics?: MetricRow[];
  ads?: AdRow[];
  ad_groups?: AdGroupRow[];
  keywords?: KeywordRow[];
  keyword_daily_stats?: KeywordDailyStat[];
  campaign_metrics?: CampaignMetric[];
}

export interface ParsedData {
  campaigns: CampaignRow[];
  billing_info: BillingRow[];
  ads?: AdRow[];
  ad_groups?: AdGroupRow[];
}

export interface HealthCheck {
  status: string;
  database: { connected: boolean; latency_ms: number | null };
}

// --- API calls ---

export const fetchOverview = (): Promise<OverviewStats> =>
  apiFetch('/stats/overview');

export const fetchActivity = (): Promise<ActivityEvent[]> =>
  apiFetch('/activity');

export const fetchBans = (params?: Record<string, string>): Promise<{ total: number; bans: BanSummary[] }> => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch(`/bans${qs}`);
};

export const fetchBan = (id: string): Promise<BanDetail> =>
  apiFetch(`/bans/${id}`);

export const fetchSimilarBans = (_ban: BanDetail): Promise<BanSummary[]> =>
  Promise.resolve([]);

export const createBan = (data: Record<string, string>): Promise<BanDetail> =>
  apiFetch('/bans', { method: 'POST', body: JSON.stringify(data) });

export const fetchAccounts = (params?: Record<string, string>): Promise<{ total: number; accounts: AccountSummary[] }> => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch(`/accounts${qs}`);
};

export const fetchAccount = (googleId: string): Promise<AccountDetail> =>
  apiFetch(`/accounts/${googleId}`);

export const patchAccount = (googleId: string, data: Record<string, unknown>): Promise<{ account: Record<string, unknown> }> =>
  apiFetch(`/accounts/${googleId}`, { method: 'PATCH', body: JSON.stringify(data) });

// ── Tags API ────────────────────────────────────────────────────────────────

export interface TagSummary {
  id: string;
  name: string;
  color: string;
  account_count: number;
}

export const fetchTags = (): Promise<{ tags: TagSummary[] }> =>
  apiFetch('/tags');

export const createTag = (name: string, color: string): Promise<{ tag: TagSummary }> =>
  apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name, color }) });

export const updateTag = (id: string, name: string, color: string): Promise<{ tag: TagSummary }> =>
  apiFetch(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ name, color }) });

export const deleteTag = (id: string): Promise<void> =>
  apiFetch(`/tags/${id}`, { method: 'DELETE' });

export const assignTag = (googleId: string, tagId: string): Promise<void> =>
  apiFetch(`/accounts/${googleId}/tags/${tagId}`, { method: 'POST' });

export const unassignTag = (googleId: string, tagId: string): Promise<void> =>
  apiFetch(`/accounts/${googleId}/tags/${tagId}`, { method: 'DELETE' });

export const bulkAssignTag = (googleAccountIds: string[], tagId: string): Promise<{ assigned: number }> =>
  apiFetch('/tags/bulk-assign', { method: 'POST', body: JSON.stringify({ google_account_ids: googleAccountIds, tag_id: tagId }) });

export interface DomainSummary {
  domain: string;
  account_count: string;
  account_ids: string[];
  ban_count: string;
  domain_id: string | null;
  domain_age_days: number | null;
  registrar: string | null;
  created_date: string | null;
  expires_date: string | null;
  ssl_type_enum: string | null;
  hosting_ip: string | null;
  hosting_asn: string | null;
  hosting_provider: string | null;
  hosting_country: string | null;
  dns_provider_enum: string | null;
  has_cloudflare: boolean | null;
  has_google_analytics: boolean | null;
  has_gtm: boolean | null;
  has_facebook_pixel: boolean | null;
  has_privacy_page: boolean | null;
  has_terms_page: boolean | null;
  has_contact_page: boolean | null;
  has_blog: boolean | null;
  meta_title: string | null;
  page_word_count: number | null;
  http_status: number | null;
  site_status: string | null;
  safe_page_quality_score: number | null;
  content_quality_score: string | null;
  pagespeed_score: string | null;
  last_checked_at: string | null;
  cloaking_detected: boolean | null;
  cloaking_type: string | null;
  cloaking_checked_at: string | null;
  safe_page_type: string | null;
}

export const fetchDomains = (): Promise<{ total: number; domains: DomainSummary[] }> =>
  apiFetch('/domains');

export interface DomainContentAnalysis {
  id: string;
  domain_id: string;
  url: string;
  content_risk_score: number;
  keyword_risk_score: number;
  compliance_score: number;
  structure_risk_score: number;
  redirect_risk_score: number;
  keyword_matches: Array<{ keyword: string; vertical: string; severity: string; context: string }>;
  detected_vertical: string | null;
  has_privacy_policy: boolean;
  has_terms_of_service: boolean;
  has_contact_info: boolean;
  has_disclaimer: boolean;
  has_about_page: boolean;
  has_cookie_consent: boolean;
  has_age_verification: boolean;
  red_flags: Array<{ type: string; severity: string; detail: string }>;
  has_countdown_timer: boolean;
  has_fake_reviews: boolean;
  has_before_after: boolean;
  has_hidden_text: boolean;
  has_aggressive_cta: boolean;
  has_popup_overlay: boolean;
  has_auto_play_video: boolean;
  has_external_redirect: boolean;
  redirect_count: number;
  redirect_chain: string[];
  final_url: string;
  url_mismatch: boolean;
  page_language: string | null;
  word_count: number;
  total_links: number;
  external_links: number;
  form_count: number;
  script_count: number;
  iframe_count: number;
  security_headers?: {
    securityScore: number;
    hasHsts: boolean;
    hasCsp: boolean;
    hasXFrameOptions: boolean;
    hasXContentType: boolean;
    serverHeader: string | null;
    poweredBy: string | null;
    details: Array<{ header: string; status: string; value?: string }>;
  };
  tld_risk?: { tld: string; risk: string; score: number };
  robots_txt?: {
    exists: boolean;
    blocksGooglebot: boolean;
    blocksAll: boolean;
    hasSitemap: boolean;
    sitemapUrls: string[];
  };
  form_analysis?: {
    forms: Array<{ action: string; method: string; isExternal: boolean; inputNames: string[] }>;
    collectsPersonalData: boolean;
    collectsPaymentData: boolean;
    externalFormTargets: string[];
  };
  third_party_scripts?: {
    analytics: string[];
    advertising: string[];
    suspicious: string[];
    cdn: string[];
    allDomains: string[];
  };
  link_reputation?: {
    shortenerLinks: string[];
    affiliateLinks: string[];
    trackerLinks: string[];
    score: number;
  };
  structured_data?: {
    hasJsonLd: boolean;
    schemaTypes: string[];
    legitimacyBonus: number;
  };
  safe_browsing?: {
    safe: boolean;
    threats: Array<{ type: string; platform: string }>;
    checked: boolean;
  };
  page_speed?: {
    performanceScore: number | null;
    firstContentfulPaint: number | null;
    largestContentfulPaint: number | null;
    cumulativeLayoutShift: number | null;
    totalBlockingTime: number | null;
    checked: boolean;
  };
  virus_total?: {
    malicious: number;
    suspicious: number;
    harmless: number;
    reputation: number;
    categories: string[];
    checked: boolean;
  };
  wayback?: {
    hasHistory: boolean;
    firstSnapshot: string | null;
    lastSnapshot: string | null;
    totalSnapshots: number;
    domainAgeFromArchive: number | null;
    checked: boolean;
  };
  analysis_summary: string;
  analyzed_at: string | null;
}

export interface DomainDetail {
  domain: DomainSummary & { id?: string };
  accounts: Array<Record<string, unknown>>;
  bans: Array<Record<string, unknown>>;
  content_analysis: DomainContentAnalysis | null;
}

export const fetchDomainDetail = (domain: string): Promise<DomainDetail> =>
  apiFetch(`/domains/${encodeURIComponent(domain)}`);

export const scanDomainContent = (domain: string): Promise<DomainContentAnalysis> =>
  apiFetch(`/domains/${encodeURIComponent(domain)}/content-analysis`, { method: 'POST' });

export const scanAllDomainsContent = (): Promise<{ analyzed: number; errors: number }> =>
  apiFetch('/domains/content-analysis/scan', { method: 'POST' });

// --- Best Practices (Методички) ---

export interface BestPractice {
  id: string;
  category: string;
  campaign_type: string | null;
  offer_vertical: string | null;
  title: string;
  content: string;
  priority: number;
  is_active: boolean;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchBestPractices = (params?: { category?: string; vertical?: string; campaign_type?: string }): Promise<BestPractice[]> => {
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.vertical) qs.set('vertical', params.vertical);
  if (params?.campaign_type) qs.set('campaign_type', params.campaign_type);
  const query = qs.toString();
  return apiFetch(`/best-practices${query ? `?${query}` : ''}`);
};

export const createBestPractice = (data: { category: string; campaign_type?: string; offer_vertical?: string; title: string; content: string; priority?: number }): Promise<BestPractice> =>
  apiFetch('/best-practices', { method: 'POST', body: JSON.stringify(data) });

export const updateBestPractice = (id: string, data: Partial<BestPractice>): Promise<BestPractice> =>
  apiFetch(`/best-practices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteBestPractice = (id: string): Promise<{ status: string }> =>
  apiFetch(`/best-practices/${id}`, { method: 'DELETE' });

// --- CTS Sites ---

export interface CtsSite {
  id: string;
  domain: string;
  external_cts_id: string | null;
  site_status: string | null;
  safe_page_quality_score: number | null;
  ssl_type: string | null;
  created_at: string;
  updated_at: string;
}

export const fetchCtsSites = (): Promise<{ total: number; sites: CtsSite[] }> =>
  apiFetch('/cts/sites');

export const createCtsSite = (data: { domain: string; external_cts_id?: string }): Promise<CtsSite> =>
  apiFetch('/cts/sites', { method: 'POST', body: JSON.stringify(data) });

export const updateCtsSite = (id: string, data: { domain?: string; external_cts_id?: string }): Promise<CtsSite> =>
  apiFetch(`/cts/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteCtsSite = (id: string): Promise<{ deleted: string }> =>
  apiFetch(`/cts/sites/${id}`, { method: 'DELETE' });

// --- Analytics ---

export interface BanTimingData {
  heatmap: number[][];           // 7 rows (Mon-Sun) × 24 cols (hours)
  day_labels: string[];          // ['Пн', 'Вт', ...]
  total_bans: number;
  peak_day: string;
  peak_day_index: number;
  peak_hour: number;
  avg_bans_per_day: number;
  day_totals: number[];
  hour_totals: number[];
}

export interface AnalyticsOverview {
  lifetime: {
    avg_hours: number;
    min_hours: number;
    max_hours: number;
    total_bans: number;
  };
  ban_rate: {
    total_accounts: number;
    banned_accounts: number;
    active_accounts: number;
    suspended_accounts: number;
    rate_pct: number;
  };
  spend: {
    avg_lifetime_spend: number;
    total_lifetime_spend: number;
    bans_with_spend: number;
  };
  by_vertical: Array<{
    vertical: string;
    avg_lifetime_hours: number;
    avg_spend: number;
    ban_count: number;
  }>;
}

export const fetchBanTiming = (): Promise<BanTimingData> =>
  apiFetch('/analytics/ban-timing');

export const fetchAnalyticsOverview = (): Promise<AnalyticsOverview> =>
  apiFetch('/analytics/overview');

// --- KF-3: Spend Velocity ---

export interface SpendVelocityAccount {
  account_google_id: string;
  display_name: string | null;
  latest_spend: number;
  change_pct: number | null;
  threshold: number;
  account_age_days: number;
  currency: string;
  status: string; // 'normal' | 'elevated' | 'critical'
}

export const fetchSpendVelocityAll = (): Promise<{ accounts: SpendVelocityAccount[] }> =>
  apiFetch('/analytics/spend-velocity-all');

// --- KF-4: Ban Chain ---

export interface BanChainDomain {
  domain: string;
  accounts: string[];
  account_count: number;
  banned_count: number;
}

export const fetchBanChainAll = (): Promise<{ shared_domains: BanChainDomain[] }> =>
  apiFetch('/analytics/ban-chain-all');

export interface BanChainConnection {
  connected_account: string;
  display_name: string | null;
  link_type: string;
  link_value: string;
  weight: number;
  is_banned: boolean;
  banned_at: string | null;
}

export interface BanChainData {
  account_google_id: string;
  connections: BanChainConnection[];
  chain_risk_score: number;
  risk_level: string;
}

export const fetchBanChain = (accountGoogleId: string): Promise<BanChainData> =>
  apiFetch(`/analytics/ban-chain?account_google_id=${encodeURIComponent(accountGoogleId)}`);

// --- KF-7: Consumable Scoring ---

export interface ScoredItem {
  bin?: string;
  domain?: string;
  proxy?: string;
  total: number;
  banned: number;
  ban_rate: number;
  avg_lifetime_hours: number;
  safe_page_score?: number | null;
  score: string; // 'good' | 'medium' | 'bad' | 'unknown'
}

export interface ConsumableScoring {
  bins: ScoredItem[];
  domains: ScoredItem[];
  proxies: ScoredItem[];
}

export const fetchConsumableScoring = (): Promise<ConsumableScoring> =>
  apiFetch('/analytics/consumable-scoring');

// --- KF-2: Creative Decay ---

export interface CampaignDecay {
  campaign_id: string;
  campaign_name: string;
  account_google_id: string;
  baseline_ctr: number | null;
  baseline_cpc: number | null;
  current_ctr: number | null;
  current_cpc: number | null;
  ctr_change_pct: number | null;
  decay_detected: boolean;
  decay_started_at: string | null;
  days_in_decay: number;
}

export const fetchCreativeDecay = (): Promise<{ campaigns: CampaignDecay[] }> =>
  apiFetch('/analytics/creative-decay');

export interface DecayScanResult {
  snapshotted: number;
  scanned: number;
  decayed: number;
  critical: number;
  results: Array<{
    campaign_id: string;
    campaign_name: string;
    account_google_id: string;
    ctr_previous: number;
    ctr_current: number;
    decline_percent: number;
    severity: 'warning' | 'critical';
  }>;
}

export const scanCreativeDecay = (): Promise<DecayScanResult> =>
  apiFetch('/analytics/creative-decay/scan', { method: 'POST' });

export interface DecayTrend {
  campaign_id: string;
  campaign_name: string;
  data: Array<{ date: string; ctr: number | null; impressions: number }>;
}

export const fetchDecayTrends = (accountGoogleId: string, days?: number): Promise<{ trends: DecayTrend[] }> =>
  apiFetch(`/analytics/creative-decay/trends?account_google_id=${accountGoogleId}${days ? `&days=${days}` : ''}`);

// --- KF-8: Post-Mortem ---

export interface PostMortemFactor {
  severity: 'critical' | 'warning' | 'info';
  text: string;
}

export interface PostMortemData {
  generated_at: string;
  lifetime_hours: number | null;
  total_spend: number | null;
  total_spend_formatted: string | null;
  domain: string | null;
  domain_age_days: number | null;
  domain_safe_score: number | null;
  spend_velocity_status: string;
  keywords_count: number;
  top_keyword: string | null;
  top_keyword_clicks: number | null;
  campaigns_count: number;
  bidding_strategy: string | null;
  notifications_count_before_ban: number;
  had_warnings: boolean;
  connected_banned_accounts: number;
  connected_accounts: Array<{
    google_id: string;
    domain: string | null;
    is_banned: boolean;
    link_type: string;
  }>;
  ban_reason: string | null;
  ban_target: string | null;
  offer_vertical: string | null;
  similar_bans_count: number;
  factors: PostMortemFactor[];
  recommendations: string[];
}

export const generatePostMortem = (banId: string): Promise<PostMortemData> =>
  apiFetch(`/analytics/post-mortem/${banId}`, { method: 'POST' });

export const generatePostMortemAll = (): Promise<{ total_pending: number; generated: number; failed: number }> =>
  apiFetch('/analytics/post-mortem-all', { method: 'POST' });

// --- KF-1: Competitive Intelligence ---

export interface CompetitorRow {
  domain: string;
  accounts_seen_in: number;
  avg_impression_share: number;
  avg_overlap_rate: number;
  avg_position_above_rate: number;
  first_seen: string;
  last_seen: string;
  longevity_days: number;
  is_long_lived: boolean;
}

export interface CompetitiveIntelligence {
  total_competitors: number;
  competitors: CompetitorRow[];
  insights: {
    most_aggressive: string | null;
    highest_impression_share: string | null;
    longest_lived: string | null;
  };
}

export const fetchCompetitiveIntelligence = (): Promise<CompetitiveIntelligence> =>
  apiFetch('/analytics/competitive-intelligence');

export interface AccountCompetitorRow {
  domain: string;
  avg_impression_share: number;
  avg_overlap_rate: number;
  avg_position_above_rate: number;
  avg_top_of_page_rate: number;
  avg_outranking_share: number;
  data_points: number;
}

export const fetchAccountCompetitiveIntelligence = (googleId: string): Promise<{ competitors: AccountCompetitorRow[] }> =>
  apiFetch(`/accounts/${googleId}/competitive-intelligence`);

// --- Assessment ---

export interface AssessmentRequest {
  domain?: string;
  account_google_id?: string;
  bin?: string;
  vertical?: string;
  geo?: string;
}

export interface AssessmentFactor {
  category: string;
  score: number;
  weight: number;
  detail: string;
}

export interface AssessmentResult {
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: AssessmentFactor[];
  recommendations: string[];
  comparable_accounts: {
    total: number;
    banned: number;
    ban_rate: number;
    avg_lifetime_days: number;
  };
  budget_recommendation: number | null;
}

export const assessRisk = (params: AssessmentRequest): Promise<AssessmentResult> =>
  apiFetch('/assess', { method: 'POST', body: JSON.stringify(params) });

// --- Quality Score ---

export interface QualityDistributionEntry {
  quality_score: number;
  keyword_count: number;
}

export interface KeywordQualityRow {
  keyword_id: string;
  keyword_text: string;
  quality_score: number | null;
  qs_expected_ctr: number | null;
  qs_ad_relevance: number | null;
  qs_landing_page: number | null;
}

export interface QualityScoreSnapshot {
  date: string;
  quality_score: number | null;
  expected_ctr: number | null;
  ad_relevance: number | null;
  landing_page_experience: number | null;
}

export const fetchQualityDistribution = (googleId: string): Promise<{ distribution: QualityDistributionEntry[]; aggregates: { avg_qs: number | null; total_keywords: number; common_ctr: number | null; common_relevance: number | null; common_landing: number | null } }> =>
  apiFetch(`/accounts/${googleId}/quality-score`);

export const fetchLowQualityKeywords = (googleId: string, threshold = 4): Promise<{ keywords: KeywordQualityRow[] }> =>
  apiFetch(`/accounts/${googleId}/keywords/low-quality?threshold=${threshold}`);

export const fetchQualityHistory = (googleId: string): Promise<{ history: QualityScoreSnapshot[] }> =>
  apiFetch(`/accounts/${googleId}/quality-score/history`);

// --- CTS Extended ---

export interface CTSTrafficDay {
  date: string;
  visits: number;
  unique_visitors: number;
  source?: string;
}

export const syncCTS = (): Promise<{ synced: number }> =>
  apiFetch('/cts/sync', { method: 'POST' });

export const fetchCTSTraffic = (siteId: string, range?: string): Promise<{ traffic: CTSTrafficDay[] }> =>
  apiFetch(`/cts/sites/${siteId}/traffic${range ? `?range=${range}` : ''}`);

export const linkCTSSite = (siteId: string, accountGoogleId: string): Promise<{ linked: boolean }> =>
  apiFetch(`/cts/sites/${siteId}/link`, { method: 'POST', body: JSON.stringify({ account_google_id: accountGoogleId }) });

// --- Analytics Extended ---

export interface AccountRiskSummary {
  account_id: string;
  account_google_id: string;
  display_name: string | null;
  days_active: number;
  total_spend: number;
  daily_velocity: number;
  policy_violations: number;
  ban_count: number;
  campaign_count: number;
  risk_score: number;
}

export const fetchAccountRiskSummary = (): Promise<{ accounts: AccountRiskSummary[] }> =>
  apiFetch('/analytics/account-risk-summary');

export const fetchMVFreshness = (): Promise<{ last_refreshed_at: string | null }> =>
  apiFetch('/analytics/freshness');

export const checkHealth = (): Promise<HealthCheck> =>
  apiFetch('/health');

export const fetchParsedData = (): Promise<ParsedData> =>
  apiFetch('/admin/parsed-data');

// --- Helpers ---

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins}м назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}ч назад`;
  const days = Math.floor(hours / 24);
  return `${days}д назад`;
}

export function formatDateRu(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Format a Google Ads CID (e.g. "7973813934") as "797-381-3934". */
export function formatCid(cid: string): string {
  const digits = cid.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return cid;
}

export function formatDateShortRu(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Human-readable ban reason mapping for known Google policy codes. */
const BAN_REASON_LABELS: Record<string, string> = {
  UNACCEPTABLE_BUSINESS_PRACTICES: 'Недопустимая бизнес-практика',
  CIRCUMVENTING_SYSTEMS: 'Обход систем',
  MISLEADING_CONTENT: 'Вводящий в заблуждение контент',
  COUNTERFEIT_GOODS: 'Контрафактные товары',
  MALICIOUS_SOFTWARE: 'Вредоносное ПО',
  CLOAKING: 'Клоакинг',
  COORDINATED_DECEPTIVE_PRACTICES: 'Скоординированные обманные действия',
  UNAPPROVED_SUBSTANCES: 'Неутверждённые вещества',
  TRADEMARK_INFRINGEMENT: 'Нарушение товарного знака',
  SENSITIVE_EVENTS: 'Чувствительные события',
};

/**
 * Clean raw ban reason: strip numeric ID prefix and humanize.
 * "7923171594:UNACCEPTABLE_BUSINESS_PRACTICES" → "Недопустимая бизнес-практика"
 * "CIRCUMVENTING_SYSTEMS" → "Обход систем"
 */
export function formatBanReason(raw: string | null): string {
  if (!raw) return '-';
  // Strip leading numeric ID + colon (e.g. "7923171594:")
  const cleaned = raw.replace(/^\d+:/, '');
  // Try Russian label
  if (BAN_REASON_LABELS[cleaned]) return BAN_REASON_LABELS[cleaned];
  // Fallback: SCREAMING_SNAKE → Title Case
  return cleaned.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Check if a suspended_signal value indicates the account is suspended.
 * The signal_value is stored as JSONB: { code: 87, value: { "1": true } }
 * May also be a plain boolean (true) or { value: true }.
 */
export function isSuspendedFromSignal(signal: unknown): boolean {
  if (signal === true) return true;
  if (signal == null || typeof signal !== 'object') return false;
  const obj = signal as Record<string, unknown>;
  // { value: { "1": true } }
  const val = obj['value'];
  if (val === true) return true;
  if (val != null && typeof val === 'object') {
    const inner = val as Record<string, unknown>;
    if (inner['1'] === true || inner[1 as unknown as string] === true) return true;
  }
  // { "1": true } (direct)
  if (obj['1'] === true || obj[1 as unknown as string] === true) return true;
  return false;
}

export function riskLevel(acc: AccountSummary): 'high' | 'medium' | 'low' | 'unknown' {
  if (acc.account_status === 'suspended' || acc.account_status === 'banned') return 'high';
  if (isSuspendedFromSignal(acc.suspended_signal)) return 'high';
  if (parseInt(acc.ban_count, 10) > 0) return 'medium';
  if ((acc.notifications_count ?? 0) > 0 && acc.suspended_signal != null) return 'medium';
  // New account with no signals, no bans, no notifications — unknown risk
  if (!acc.suspended_signal && parseInt(acc.ban_count, 10) === 0 && !(acc.notifications_count ?? 0)) return 'unknown';
  return 'low';
}

/**
 * Derive effective account status from the account_status field and the suspended_signal.
 * When the DB status column is 'active' but suspended_signal shows true, return 'suspended'.
 */
export function effectiveStatus(acc: { account_status?: string | null; suspended_signal?: unknown }): string {
  if (acc.account_status === 'suspended' || acc.account_status === 'banned') return acc.account_status;
  if (isSuspendedFromSignal(acc.suspended_signal)) return 'suspended';
  return acc.account_status ?? 'active';
}

// --- AI Analysis ---

export interface AiAnalysisAction {
  priority: 'critical' | 'high' | 'medium' | 'low';
  action_ru: string;
  reasoning_ru: string;
  estimated_impact: string;
}

export interface AiAnalysisResult {
  summary_ru: string;
  risk_assessment: string;
  immediate_actions: AiAnalysisAction[];
  strategic_recommendations: AiAnalysisAction[];
  similar_patterns: string[];
  confidence: 'low' | 'medium' | 'high';
  model: string;
  tokens_used: number;
  latency_ms: number;
}

export interface AiIndividualResult {
  model_id: string;
  model_display: string;
  result: AiAnalysisResult | null;
  error: string | null;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  prediction_id: string | null;
}

export interface AiComparisonData {
  strategy: string;
  individual_results: AiIndividualResult[];
  consensus: {
    agreement_level: number;
    divergence_points: string[];
    all_agree_on_confidence: boolean;
  };
  models_used: string[];
  models_failed: Array<{ model_id: string; error: string }>;
  total_cost_usd: number;
  generated_at: string;
}

/** Response from POST /ai/analyze/:accountId — backward-compatible shape */
export interface AiAnalyzeResponse extends AiAnalysisResult {
  _comparison?: AiComparisonData;
}

/** Response from POST /ai/compare-models/:accountId */
export interface AiComparisonResult {
  account_google_id: string;
  strategy: string;
  final_result: AiAnalysisResult;
  individual_results: AiIndividualResult[];
  consensus: {
    agreement_level: number;
    divergence_points: string[];
    all_agree_on_confidence: boolean;
  };
  models_used: string[];
  models_failed: Array<{ model_id: string; error: string }>;
  total_cost_usd: number;
  generated_at: string;
}

export interface AiLeaderboardEntry {
  model: string;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  avg_lifetime_error_days: number | null;
  avg_latency_ms: number;
  avg_cost_usd: number;
  total_analyses: number;
  scored_count: number;
  composite_score: number;
}

export interface AiLeaderboardSummary {
  period: string;
  period_days: number | null;
  entries: AiLeaderboardEntry[];
  has_outcomes: boolean;
}

export interface AiModel {
  model: string;
  display_name: string;
  status: 'active' | 'not_configured';
}

export async function analyzeAccount(accountId: string): Promise<AiAnalyzeResponse> {
  return apiFetch<AiAnalyzeResponse>(`/ai/analyze/${accountId}`, { method: 'POST' });
}

export async function analyzeBan(banLogId: string): Promise<AiAnalysisResult> {
  return apiFetch<AiAnalysisResult>(`/ai/analyze-ban/${banLogId}`, { method: 'POST' });
}

export async function compareAccountsAI(accountIds: string[]): Promise<AiAnalysisResult> {
  return apiFetch<AiAnalysisResult>('/ai/compare', {
    method: 'POST',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

export async function compareModelsAI(accountId: string, strategy?: string): Promise<AiComparisonResult> {
  const qs = strategy ? `?strategy=${strategy}` : '';
  return apiFetch<AiComparisonResult>(`/ai/compare-models/${accountId}${qs}`, { method: 'POST' });
}

export async function mockCompareModelsAI(accountId: string): Promise<AiComparisonResult> {
  return apiFetch<AiComparisonResult>(`/ai/mock-compare/${accountId}`, { method: 'POST' });
}

export async function fetchAiHistory(accountId: string): Promise<{ analyses: AiAnalysisResult[] }> {
  return apiFetch<{ analyses: AiAnalysisResult[] }>(`/ai/history/${accountId}`);
}

export async function fetchAiLeaderboard(period?: string): Promise<AiLeaderboardSummary> {
  const qs = period ? `?period=${period}` : '';
  return apiFetch<AiLeaderboardSummary>(`/ai/leaderboard${qs}`);
}

export async function fetchConfiguredModels(): Promise<{ models: AiModel[]; total: number; configured: number }> {
  return apiFetch<{ models: AiModel[]; total: number; configured: number }>('/ai/models');
}

// --- AI Feedback ---

export interface AiFeedbackStats {
  likes: number;
  dislikes: number;
  corrections: number;
}

export interface AiFeedbackResponse {
  feedbacks: Array<{
    id: string;
    prediction_id: string;
    user_id: string;
    rating: number;
    feedback_type: string;
    comment: string | null;
    correct_outcome: string | null;
    created_at: string;
  }>;
  stats: AiFeedbackStats;
  my_vote: number | null;
}

export async function submitAiFeedback(
  predictionId: string,
  rating: number,
  comment?: string,
  correctOutcome?: string,
): Promise<{ id: string; created_at: string; updated_outcome: boolean }> {
  return apiFetch(`/ai/predictions/${predictionId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment, correct_outcome: correctOutcome }),
  });
}

export async function getAiFeedback(predictionId: string): Promise<AiFeedbackResponse> {
  return apiFetch<AiFeedbackResponse>(`/ai/predictions/${predictionId}/feedback`);
}

export interface AiModelFeedbackStats {
  model_id: string;
  total: number;
  likes: number;
  dislikes: number;
  avg_rating: number;
  corrections_count: number;
}

export async function getAiFeedbackStats(
  model?: string,
  period?: string,
): Promise<{ stats: AiModelFeedbackStats[] }> {
  const params = new URLSearchParams();
  if (model) params.set('model', model);
  if (period) params.set('period', period);
  const qs = params.toString();
  return apiFetch(`/ai/feedback/stats${qs ? `?${qs}` : ''}`);
}

// --- ML Predictions ---

export async function trainModel(): Promise<unknown> {
  return apiFetch('/ml/train', { method: 'POST' });
}

export async function predictAccount(accountId: string): Promise<unknown> {
  return apiFetch(`/ml/predict/${accountId}`);
}

export async function predictAll(): Promise<unknown> {
  return apiFetch('/ml/predict-all', { method: 'POST' });
}

export async function fetchPredictionSummary(): Promise<{ total: number; by_risk_level: Record<string, number> }> {
  return apiFetch<{ total: number; by_risk_level: Record<string, number> }>('/ml/summary');
}

// --- Notifications ---

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  severity: 'critical' | 'warning' | 'info' | 'success';
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
  total: number;
}

export const fetchNotifications = (params?: {
  limit?: number;
  offset?: number;
  unread_only?: boolean;
  from_date?: string;
  to_date?: string;
}): Promise<NotificationsResponse> => {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  if (params?.unread_only) q.set('unread_only', 'true');
  if (params?.from_date) q.set('from_date', params.from_date);
  if (params?.to_date) q.set('to_date', params.to_date);
  const qs = q.toString();
  return apiFetch(`/notifications${qs ? `?${qs}` : ''}`);
};

export const fetchUnreadCount = (): Promise<{ count: number }> =>
  apiFetch('/notifications/unread-count');

export const markNotificationRead = (id: string): Promise<{ success: boolean }> =>
  apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });

export const markAllNotificationsRead = (): Promise<{ updated: number }> =>
  apiFetch('/notifications/read-all', { method: 'POST' });

// --- Admin: Notification Settings ---

export interface NotificationSettingRow {
  id: string;
  key: string;
  enabled: boolean;
  label: string;
  description: string | null;
  severity: string;
  notify_owner: boolean;
  notify_admins: boolean;
  cooldown_minutes: number;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateNotificationSettingRequest {
  enabled?: boolean;
  severity?: string;
  notify_owner?: boolean;
  notify_admins?: boolean;
  cooldown_minutes?: number;
  telegram_enabled?: boolean;
  telegram_chat_id?: string | null;
}

export const fetchNotificationSettings = (): Promise<{ settings: NotificationSettingRow[] }> =>
  apiFetch('/admin/notification-settings');

export const updateNotificationSetting = (
  key: string,
  data: UpdateNotificationSettingRequest,
): Promise<{ setting: NotificationSettingRow }> =>
  apiFetch(`/admin/notification-settings/${key}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// --- Admin: Send Notification ---

export interface SendNotificationRequest {
  target: 'all' | 'buyers' | 'admins' | 'user_id';
  user_id?: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
}

export const sendAdminNotification = (data: SendNotificationRequest): Promise<{ sent_to: number }> =>
  apiFetch('/admin/notifications/send', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const sendTelegramTest = (key: string): Promise<{ ok: boolean; chat_id: string }> =>
  apiFetch(`/admin/notification-settings/${key}/test-telegram`, { method: 'POST' });

// --- Admin: Notification History ---

export interface NotificationHistoryEntry {
  title: string;
  message: string;
  severity: string;
  target_count: number;
  sent_at: string;
}

export const fetchNotificationHistory = (limit?: number): Promise<{ history: NotificationHistoryEntry[] }> =>
  apiFetch(`/admin/notifications/history${limit ? `?limit=${limit}` : ''}`);

// --- Audit Log ---

export interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// --- Buyer Performance ---

export interface BuyerPerformance {
  user_id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  total_accounts: number;
  active_accounts: number;
  suspended_accounts: number;
  total_bans: number;
  ban_rate: string;
  avg_lifetime_hours: string;
  total_spend: string;
  last_ban_at: string | null;
  last_activity: string | null;
}

export const fetchBuyerPerformance = (): Promise<{ buyers: BuyerPerformance[] }> =>
  apiFetch('/stats/buyer-performance');

export interface BuyerDetail {
  buyer: BuyerPerformance & { created_at: string };
  accounts: Array<{ google_account_id: string; display_name: string | null; status: string; currency: string | null; account_type: string | null; updated_at: string; ban_count: number }>;
  audit: { total: number; entries: AuditEntry[] };
  bans_by_vertical: Array<{ offer_vertical: string; count: number }>;
}

export const fetchBuyerDetail = (id: string, auditOffset = 0): Promise<BuyerDetail> =>
  apiFetch(`/stats/buyer-performance/${id}?audit_offset=${auditOffset}`);

// --- Audit Log ---

export const fetchAuditLog = (params?: Record<string, string>): Promise<{ total: number; entries: AuditEntry[] }> => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return apiFetch(`/admin/audit${qs}`);
};

// --- Telegram Connect ---

export interface TelegramBotInfo {
  configured: boolean;
  bot_username: string | null;
}

export interface TelegramConnectResponse {
  code: string;
  bot_username: string | null;
  expires_in_seconds: number;
}

export interface TelegramConnectStatus {
  connected: boolean;
  telegram_chat_id: string | null;
  pending: boolean;
}

export const fetchTelegramBotInfo = (): Promise<TelegramBotInfo> =>
  apiFetch('/telegram/bot-info');

export const startTelegramConnect = (): Promise<TelegramConnectResponse> =>
  apiFetch('/telegram/connect', { method: 'POST' });

export const fetchTelegramConnectStatus = (): Promise<TelegramConnectStatus> =>
  apiFetch('/telegram/connect/status');

export const disconnectTelegram = (): Promise<{ status: string }> =>
  apiFetch('/telegram/disconnect', { method: 'DELETE' });

// --- Auth: Self password change ---

export const changeMyPassword = (
  current_password: string,
  new_password: string,
): Promise<{ message: string }> =>
  apiFetch('/auth/me/password', {
    method: 'PATCH',
    body: JSON.stringify({ current_password, new_password }),
  });

// --- Auth: Antidetect browser preference ---

export const updateAntidetectBrowser = (browser: string): Promise<{ status: string }> =>
  apiFetch('/auth/antidetect-browser', {
    method: 'PATCH',
    body: JSON.stringify({ antidetect_browser: browser }),
  });

// --- Global Search ---

export interface SearchResult {
  type: 'account' | 'domain' | 'ban' | 'practice' | 'notification';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  matchField: string | null;
}

export const globalSearch = (q: string): Promise<{ results: SearchResult[] }> =>
  apiFetch(`/search?q=${encodeURIComponent(q)}`);

// --- Expert Rules ---

export interface ExpertRule {
  id: string;
  name: string;
  description: string | null;
  category: 'bin' | 'domain' | 'account' | 'geo' | 'vertical' | 'spend';
  condition: unknown;
  severity: 'block' | 'warning' | 'info';
  message_template: string;
  is_active: boolean;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRuleRequest {
  name: string;
  description?: string | null;
  category: ExpertRule['category'];
  condition: unknown;
  message_template: string;
  is_active?: boolean;
  priority?: number;
}

export type UpdateRuleRequest = Partial<Omit<CreateRuleRequest, 'name'>> & { name?: string };

export const fetchRules = (): Promise<{ rules: ExpertRule[] }> =>
  apiFetch('/admin/rules');

export const createRule = (data: CreateRuleRequest): Promise<{ rule: ExpertRule }> =>
  apiFetch('/admin/rules', { method: 'POST', body: JSON.stringify(data) });

export const updateRule = (id: string, data: UpdateRuleRequest): Promise<{ rule: ExpertRule }> =>
  apiFetch(`/admin/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deleteRule = (id: string): Promise<void> =>
  apiFetch(`/admin/rules/${id}`, { method: 'DELETE' });

export const toggleRule = (id: string, is_active: boolean): Promise<{ rule: ExpertRule }> =>
  apiFetch(`/admin/rules/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ is_active }) });

export const reorderRules = (updates: { id: string; priority: number }[]): Promise<{ ok: boolean }> =>
  apiFetch('/admin/rules/reorder', { method: 'POST', body: JSON.stringify({ updates }) });
