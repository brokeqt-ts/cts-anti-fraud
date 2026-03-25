// ─── Collect Endpoint Types ─────────────────────────────────────────────────

export interface CollectPayloadItem {
  type: 'account' | 'campaign' | 'performance' | 'billing' | 'ad_review' | 'status_change' | 'billing_request' | 'raw' | 'raw_text';
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ProxyInfo {
  ip: string;
  geo: string | null;
  org: string | null;
  asn: string | null;
}

export interface ProfileConfig {
  proxy_provider: string;
  account_type: string;
  payment_service: string;
}

export interface CollectRequest {
  profile_id: string;
  /** Detected antidetect browser type (octium, multilogin, dolphin, adspower, gologin, octo, unknown). */
  antidetect_browser?: string;
  /** Google Ads CID extracted from page URL by the extension. */
  google_cid?: string;
  /** Proxy IP info auto-detected by the extension via ipify + ipinfo.io. */
  proxy_info?: ProxyInfo;
  /** SHA-256 hash of browser fingerprint data (screen, WebGL, canvas, fonts, etc.) */
  fingerprint_hash?: string;
  /** Manual profile config from extension popup (proxy provider, account type, payment service). */
  profile_config?: ProfileConfig;
  extension_version: string;
  batch: CollectPayloadItem[];
}

export interface CollectResponse {
  status: 'ok' | 'error';
  processed: number;
  errors?: string[];
}

// ─── Health Endpoint Types ──────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;
  database: {
    connected: boolean;
    latency_ms: number | null;
  };
  last_data_received: string | null;
}

// ─── Common API Types ───────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
