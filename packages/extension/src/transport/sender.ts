// Sends batched payloads to the backend server with retry logic.

import type { ExtensionConfig, ProfileConfig } from '../types/messages.js';
import type { QueueItem } from './queue.js';
import { getQueue, dequeue, incrementRetries } from './queue.js';

const EXTENSION_VERSION = '0.1.0';
const MAX_ITEMS_PER_BATCH = 5;
const MAX_BATCH_BYTES = 10 * 1024 * 1024; // 10 MB
const OVERSIZED_ITEM_BYTES = 5 * 1024 * 1024; // 5 MB — send alone

interface ProxyInfo {
  ip: string;
  geo: string | null;
  org: string | null;
  asn: string | null;
}

interface CollectPayload {
  profile_id: string;
  antidetect_browser: string;
  extension_version: string;
  proxy_info?: ProxyInfo;
  fingerprint_hash?: string;
  profile_config?: ProfileConfig;
  batch: Array<{
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }>;
}

function estimateItemSize(item: QueueItem): number {
  // Fast rough estimate — JSON.stringify the data payload only (dominates size)
  return JSON.stringify(item.data).length;
}

/** Split queue items into size-aware chunks. */
function buildChunks(items: QueueItem[]): QueueItem[][] {
  const chunks: QueueItem[][] = [];
  let current: QueueItem[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const size = estimateItemSize(item);

    // Oversized item → send it solo in its own request
    if (size >= OVERSIZED_ITEM_BYTES) {
      // Flush current chunk first
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }
      chunks.push([item]);
      continue;
    }

    // Would exceed limits → start a new chunk
    if (
      current.length >= MAX_ITEMS_PER_BATCH ||
      (current.length > 0 && currentBytes + size > MAX_BATCH_BYTES)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += size;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

async function sendChunk(
  chunk: QueueItem[],
  config: ExtensionConfig,
  antidetectBrowser: string,
  proxyInfo: ProxyInfo | null,
  fingerprintHash: string | null,
  profileConfig: ProfileConfig | null,
): Promise<{ success: boolean; processed: number; error?: string }> {
  const payload: CollectPayload = {
    profile_id: config.profileId,
    antidetect_browser: antidetectBrowser,
    extension_version: EXTENSION_VERSION,
    ...(proxyInfo ? { proxy_info: proxyInfo } : {}),
    ...(fingerprintHash ? { fingerprint_hash: fingerprintHash } : {}),
    ...(profileConfig ? { profile_config: profileConfig } : {}),
    batch: chunk.map((item) => ({
      type: item.type,
      timestamp: item.timestamp,
      data: item.data,
    })),
  };

  const url = `${config.serverUrl.replace(/\/$/, '')}/api/v1/collect`;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
          'X-Profile-Id': config.profileId,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = (await response.json()) as { processed: number };
        await dequeue(chunk.map((i) => i.id));
        return { success: true, processed: result.processed };
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Unknown error';
    }

    // Exponential backoff
    if (attempt < config.maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // All retries exhausted — keep items in queue, increment retry count
  await incrementRetries(chunk.map((i) => i.id));

  return {
    success: false,
    processed: 0,
    error: lastError ?? 'Max retries exceeded',
  };
}

export async function sendBatch(config: ExtensionConfig): Promise<{
  success: boolean;
  processed: number;
  error?: string;
}> {
  if (!config.serverUrl) {
    return { success: false, processed: 0, error: 'Server URL не настроен' };
  }
  if (!config.apiKey) {
    return { success: false, processed: 0, error: 'API Key не настроен — пересоберите расширение с EXT_API_KEY' };
  }

  const items = await getQueue();
  if (items.length === 0) {
    return { success: true, processed: 0 };
  }

  // Read detected browser + proxy + fingerprint + profile config from storage
  const storageResult = await chrome.storage.local.get(['cts_status', 'cts_detected_proxy', 'cts_fingerprint', 'profileConfig']);
  const savedStatus = storageResult['cts_status'] as { antidetectBrowser?: string } | undefined;
  const antidetectBrowser = savedStatus?.antidetectBrowser ?? 'unknown';
  const proxyInfo = (storageResult['cts_detected_proxy'] as ProxyInfo | undefined) ?? null;
  const fpEntry = storageResult['cts_fingerprint'] as { hash?: string; expires_at?: string } | undefined;
  const fingerprintHash = fpEntry?.hash && (!fpEntry.expires_at || new Date(fpEntry.expires_at) > new Date())
    ? fpEntry.hash : null;
  const profileConfig = (storageResult['profileConfig'] as ProfileConfig | undefined) ?? null;

  let totalProcessed = 0;
  let lastError: string | undefined;
  let anySuccess = false;

  const chunks = buildChunks(items);

  for (const chunk of chunks) {
    const result = await sendChunk(chunk, config, antidetectBrowser, proxyInfo, fingerprintHash, profileConfig);

    totalProcessed += result.processed;

    if (result.success) {
      anySuccess = true;
    } else {
      lastError = result.error;
    }
  }

  return {
    success: anySuccess,
    processed: totalProcessed,
    error: lastError,
  };
}

/**
 * Send only urgent items (status changes) immediately, bypassing the normal batch timer.
 * If send fails, items remain in queue for normal batch retry.
 */
export async function sendUrgentItems(config: ExtensionConfig): Promise<{
  success: boolean;
  processed: number;
  error?: string;
}> {
  if (!config.serverUrl || !config.apiKey) {
    return { success: false, processed: 0, error: 'Server URL или API Key не настроены' };
  }

  const allItems = await getQueue();
  const urgentItems = allItems.filter(item => item.priority === 'urgent');

  if (urgentItems.length === 0) {
    return { success: true, processed: 0 };
  }

  console.log(`[CTS sender] Sending ${urgentItems.length} urgent item(s) immediately`);

  // Read detected browser + proxy + fingerprint + profile config from storage
  const storageResult = await chrome.storage.local.get(['cts_status', 'cts_detected_proxy', 'cts_fingerprint', 'profileConfig']);
  const savedStatus = storageResult['cts_status'] as { antidetectBrowser?: string } | undefined;
  const antidetectBrowser = savedStatus?.antidetectBrowser ?? 'unknown';
  const proxyInfo = (storageResult['cts_detected_proxy'] as ProxyInfo | undefined) ?? null;
  const fpEntry = storageResult['cts_fingerprint'] as { hash?: string; expires_at?: string } | undefined;
  const fingerprintHash = fpEntry?.hash && (!fpEntry.expires_at || new Date(fpEntry.expires_at) > new Date())
    ? fpEntry.hash : null;
  const profileConfig = (storageResult['profileConfig'] as ProfileConfig | undefined) ?? null;

  const chunks = buildChunks(urgentItems);
  let totalProcessed = 0;
  let lastError: string | undefined;
  let anySuccess = false;

  for (const chunk of chunks) {
    const result = await sendChunk(chunk, config, antidetectBrowser, proxyInfo, fingerprintHash, profileConfig);
    totalProcessed += result.processed;
    if (result.success) {
      anySuccess = true;
    } else {
      lastError = result.error;
    }
  }

  return {
    success: anySuccess,
    processed: totalProcessed,
    error: lastError,
  };
}

export async function testConnection(config: ExtensionConfig): Promise<boolean> {
  const result = await testConnectionDetailed(config);
  return result.ok;
}

export interface ConnectionTestResult {
  ok: boolean;
  error: string | null;
}

export async function testConnectionDetailed(config: ExtensionConfig): Promise<ConnectionTestResult> {
  try {
    const url = `${config.serverUrl.replace(/\/$/, '')}/api/v1/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': config.apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return { ok: true, error: null };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Ошибка авторизации (${response.status})` };
    }
    if (response.status >= 500) {
      return { ok: false, error: `Ошибка сервера (${response.status})` };
    }
    return { ok: false, error: `Неизвестная ошибка: ${response.status}` };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Сервер недоступен (timeout)' };
    }
    if (err instanceof TypeError) {
      return { ok: false, error: 'Нет подключения к интернету' };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Неизвестная ошибка' };
  }
}
