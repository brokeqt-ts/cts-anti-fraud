// ─── Extension ↔ Background Message Protocol ───────────────────────────────

export enum EXTENSION_MESSAGE_TYPE {
  INTERCEPTED_RESPONSE = 'intercepted_response',
  SEND_BATCH = 'send_batch',
  UPDATE_CONFIG = 'update_config',
  GET_STATUS = 'get_status',
  STATUS_CHANGE_DETECTED = 'status_change_detected',
}

export interface InterceptedResponse {
  type: EXTENSION_MESSAGE_TYPE.INTERCEPTED_RESPONSE;
  url: string;
  method: string;
  status: number;
  body: unknown;
  timestamp: string;
}

export interface SendBatchMessage {
  type: EXTENSION_MESSAGE_TYPE.SEND_BATCH;
}

export interface UpdateConfigMessage {
  type: EXTENSION_MESSAGE_TYPE.UPDATE_CONFIG;
  config: ExtensionConfig;
}

export interface GetStatusMessage {
  type: EXTENSION_MESSAGE_TYPE.GET_STATUS;
}

export interface StatusChangeDetectedMessage {
  type: EXTENSION_MESSAGE_TYPE.STATUS_CHANGE_DETECTED;
  changeType: string;
  data: unknown;
}

export type ExtensionMessage =
  | InterceptedResponse
  | SendBatchMessage
  | UpdateConfigMessage
  | GetStatusMessage
  | StatusChangeDetectedMessage;

// ─── Extension Config ───────────────────────────────────────────────────────

export interface ExtensionConfig {
  serverUrl: string;
  apiKey: string;
  profileId: string;
  batchIntervalMs: number;
  maxRetries: number;
}

// ─── Extension Status ───────────────────────────────────────────────────────

export interface ExtensionStatus {
  connected: boolean;
  lastSyncAt: string | null;
  totalIntercepted: number;
  queuedItems: number;
  errors: string[];
}

// ─── Content Script ↔ Page Message Protocol ─────────────────────────────────

export const PAGE_MESSAGE_SOURCE = 'cts-antifraud-injected' as const;
export const CONTENT_MESSAGE_SOURCE = 'cts-antifraud-content' as const;

export interface PageMessage {
  source: typeof PAGE_MESSAGE_SOURCE;
  payload: {
    url: string;
    method: string;
    status: number;
    body: string;
    timestamp: string;
  };
}
