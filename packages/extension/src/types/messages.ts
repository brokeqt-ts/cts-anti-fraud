export const PAGE_MESSAGE_SOURCE = 'cts-antifraud-injected' as const;
export const CONTENT_MESSAGE_SOURCE = 'cts-antifraud-content' as const;

export interface InterceptedPayload {
  url: string;
  method: string;
  status: number;
  body: string;
  timestamp: string;
  /** Google Ads CID extracted from page URL (ocid or __c param). */
  googleCid?: string;
  /** POST request body for batchexecute URLs (payment submissions). */
  requestBody?: string | null;
  /** Antidetect browser profile name extracted from document.title. */
  browserProfileName?: string;
  /** Detected antidetect browser type (octium, multilogin, dolphin, adspower, gologin, octo). */
  antidetectBrowser?: string;
}

export interface PageMessage {
  source: typeof PAGE_MESSAGE_SOURCE;
  payload: InterceptedPayload;
}

export enum MessageType {
  INTERCEPTED_RESPONSE = 'intercepted_response',
  SEND_BATCH = 'send_batch',
  UPDATE_CONFIG = 'update_config',
  SET_PROFILE = 'set_profile',
  SET_PROFILE_CONFIG = 'set_profile_config',
  GET_STATUS = 'get_status',
  STATUS_CHANGE = 'status_change_detected',
  RETRY_CONNECTION = 'retry_connection',
  FETCH_PROFILE_DEFAULTS = 'fetch_profile_defaults',
}

export interface ProfileConfig {
  proxy_provider: string;
  account_type: string;
  payment_service: string;
}

export interface InterceptedMessage {
  type: MessageType.INTERCEPTED_RESPONSE;
  payload: InterceptedPayload;
}

export interface SendBatchMessage {
  type: MessageType.SEND_BATCH;
}

export interface UpdateConfigMessage {
  type: MessageType.UPDATE_CONFIG;
  config: ExtensionConfig;
}

export interface SetProfileMessage {
  type: MessageType.SET_PROFILE;
  profileName: string;
  browser: string;
}

export interface GetStatusMessage {
  type: MessageType.GET_STATUS;
}

export interface SetProfileConfigMessage {
  type: MessageType.SET_PROFILE_CONFIG;
  profileConfig: ProfileConfig;
}

export interface StatusChangeMessage {
  type: MessageType.STATUS_CHANGE;
  changeType: string;
  data: unknown;
}

export interface RetryConnectionMessage {
  type: MessageType.RETRY_CONNECTION;
}

export interface FetchProfileDefaultsMessage {
  type: MessageType.FETCH_PROFILE_DEFAULTS;
}

export type RuntimeMessage =
  | InterceptedMessage
  | SendBatchMessage
  | UpdateConfigMessage
  | SetProfileMessage
  | SetProfileConfigMessage
  | GetStatusMessage
  | StatusChangeMessage
  | RetryConnectionMessage
  | FetchProfileDefaultsMessage;

export interface ExtensionConfig {
  serverUrl: string;
  apiKey: string;
  profileId: string;
  batchIntervalMs: number;
  maxRetries: number;
}

export interface ExtensionStatus {
  connected: boolean;
  lastSyncAt: string | null;
  totalIntercepted: number;
  queuedItems: number;
  totalEventsSent: number;
  profileName: string | null;
  antidetectBrowser: string | null;
  currentCid: string | null;
  errors: string[];
  lastError: string | null;
  lastSuccessAt: string | null;
  serverUrl: string | null;
  apiKeyLast4: string | null;
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  serverUrl: 'https://strong-dedication-production.up.railway.app',
  apiKey: '',
  profileId: '',
  batchIntervalMs: 30000,
  maxRetries: 5,
};
