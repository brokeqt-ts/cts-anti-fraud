// Background service worker — manages the data pipeline:
// 1. Receives intercepted responses from content scripts
// 2. Extracts structured data
// 3. Queues data for batched sending
// 4. Sends batches on timer and on tab close

import { extractData } from '../collectors/data-extractor.js';
import { extractAccountStatus, checkForStatusChange } from '../detectors/status-change-detector.js';
import { enqueue, enqueueUrgent, getQueueSize } from '../transport/queue.js';
import { sendBatch, sendUrgentItems, testConnectionDetailed } from '../transport/sender.js';
import { BUILD_CONFIG } from '../config.js';
import { MessageType, DEFAULT_CONFIG } from '../types/messages.js';
import type { ExtensionConfig, ExtensionStatus, RuntimeMessage } from '../types/messages.js';

const CONFIG_STORAGE_KEY = 'cts_config';
const STATS_STORAGE_KEY = 'cts_stats';
const STATUS_STORAGE_KEY = 'cts_status';
const FALLBACK_UUID_KEY = 'cts_fallback_uuid';
const PROFILE_CACHE_KEY = 'cts_detected_profile';
const PROXY_CACHE_KEY = 'cts_detected_proxy';
const BATCH_ALARM_NAME = 'cts_batch_send';
const POLL_ALARM_NAME = 'cts_poll';

// ─── State ──────────────────────────────────────────────────────────────────

const status: ExtensionStatus = {
  connected: false,
  lastSyncAt: null,
  totalIntercepted: 0,
  queuedItems: 0,
  totalEventsSent: 0,
  profileName: null,
  antidetectBrowser: null,
  currentCid: null,
  errors: [],
  lastError: null,
  lastSuccessAt: null,
  serverUrl: null,
  apiKeyLast4: null,
};

/** Whether we already detected the profile for this service worker lifetime. */
let profileDetected = false;

/** Whether we already detected proxy IP for this service worker lifetime. */
let proxyDetected = false;

/**
 * Per-tab CID cache. Stores CID provided by page-injector (from URL params only).
 * Cleared when the tab navigates away from ads.google.com or when a new CID
 * is received from page-injector (account switch).
 */
const tabCidCache = new Map<number, string>();

/** Valid Google Ads CID: 7-10 digits. */
const VALID_CID_RE = /^\d{7,10}$/;

// ─── Dynamic badge (task 3) ──────────────────────────────────────────────────

const BADGE_ALARM_NAME = 'cts_badge_update';

async function updateBadge(): Promise<void> {
  try {
    const STALE_THRESHOLD_MS = 60 * 1000; // 60s for "connected" threshold
    const ERROR_THRESHOLD_MS = 5 * 60 * 1000; // 5 min for error

    const lastSuccessMs = status.lastSuccessAt
      ? Date.now() - new Date(status.lastSuccessAt).getTime()
      : Infinity;
    const queueSize = await getQueueSize();

    if (status.connected && lastSuccessMs < STALE_THRESHOLD_MS) {
      // Connected — green
      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      await chrome.action.setBadgeText({ text: '' });
    } else if (queueSize > 0 && lastSuccessMs < ERROR_THRESHOLD_MS) {
      // Pending — yellow with queue count
      await chrome.action.setBadgeBackgroundColor({ color: '#eab308' });
      await chrome.action.setBadgeText({ text: String(queueSize) });
    } else if (!status.connected || lastSuccessMs >= ERROR_THRESHOLD_MS) {
      // Error — red
      await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      await chrome.action.setBadgeText({ text: '!' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Badge API may not be available in all contexts
  }
}

// ─── Antidetect browser detection via chrome.tabs API ───────────────────────

interface DetectedProfile {
  browser: string;
  profileName: string;
}

/**
 * Parse a title string to detect antidetect browser and profile name.
 *
 * Known patterns:
 *   Octium:        "ATVanya333 - Octium"
 *   Mimic:         "FrKristy796: Расширения - Mimic"
 *   Dolphin Anty:  "ProfileName - Dolphin{Anty}"
 *   AdsPower:      "Profile 1 - AdsPower"
 *   GoLogin:       "ProfileName - GoLogin"
 *   Octo Browser:  "ProfileName - Octo Browser"
 */
function parseTitle(title: string): DetectedProfile | null {
  if (!title) return null;

  if (title.includes('Octium')) {
    const match = title.match(/^(.+?)\s*-\s*(?:.*\s*-\s*)?Octium/);
    return { browser: 'octium', profileName: match?.[1]?.trim() || 'unknown' };
  }

  if (title.includes('Mimic')) {
    const match = title.match(/^(.+?):/);
    return { browser: 'multilogin', profileName: match?.[1]?.trim() || 'unknown' };
  }

  if (title.includes('Dolphin')) {
    const match = title.match(/^(.+?)\s*-\s*.*Dolphin/);
    return { browser: 'dolphin', profileName: match?.[1]?.trim() || 'unknown' };
  }

  if (title.includes('AdsPower')) {
    const match = title.match(/^(.+?)\s*-\s*.*AdsPower/);
    return { browser: 'adspower', profileName: match?.[1]?.trim() || 'unknown' };
  }

  if (title.includes('GoLogin')) {
    const match = title.match(/^(.+?)\s*-\s*.*GoLogin/);
    return { browser: 'gologin', profileName: match?.[1]?.trim() || 'unknown' };
  }

  if (title.includes('Octo Browser')) {
    const match = title.match(/^(.+?)\s*-\s*.*Octo Browser/);
    return { browser: 'octo', profileName: match?.[1]?.trim() || 'unknown' };
  }

  return null;
}

/**
 * Detect antidetect browser profile by scanning ALL tabs in the window.
 *
 * Antidetect browsers set the profile name in the WINDOW title bar (OS-level),
 * not in the page's document.title. chrome.tabs.get().title returns the page
 * title ("Google Ads - ..."), NOT the window title ("ATVanya333 - Octium").
 *
 * However, some antidetect browsers also modify tab titles for certain pages
 * (e.g. new tab, extensions page, settings). By scanning ALL tabs in the
 * window we maximize the chance of finding the antidetect signature.
 *
 * All tab titles are logged for diagnosis regardless of match result.
 */
async function detectProfileFromWindow(tabId: number): Promise<DetectedProfile | null> {
  try {
    const sourceTab = await chrome.tabs.get(tabId);
    const windowId = sourceTab.windowId;

    // Log the source tab (the ads.google.com tab)
    console.log('[CTS sw] === PROFILE DETECTION START ===');
    console.log('[CTS sw] Source tab', tabId, 'title:', JSON.stringify(sourceTab.title));
    console.log('[CTS sw] Source tab url:', sourceTab.url);

    // Check source tab first
    const sourceResult = parseTitle(sourceTab.title ?? '');
    if (sourceResult) {
      console.log('[CTS sw] MATCH on source tab:', sourceResult.browser, '/', sourceResult.profileName);
      return sourceResult;
    }

    // Scan ALL tabs in this window
    const allTabs = await chrome.tabs.query({ windowId });
    console.log(`[CTS sw] Scanning all ${allTabs.length} tabs in window ${windowId}:`);

    for (const t of allTabs) {
      const title = t.title ?? '';
      const urlSnippet = (t.url ?? '').substring(0, 80);
      console.log(`[CTS sw]   tab ${t.id}: ${JSON.stringify(title)} (${urlSnippet})`);

      const result = parseTitle(title);
      if (result) {
        console.log('[CTS sw] MATCH on tab', t.id, ':', result.browser, '/', result.profileName);
        return result;
      }
    }

    console.log('[CTS sw] No antidetect signature found in any tab title.');
    console.log('[CTS sw] If you see "ATVanya333 - Octium" in the window title bar');
    console.log('[CTS sw] but not in any tab title above — the antidetect browser');
    console.log('[CTS sw] only sets the OS window title, which Chrome API cannot read.');
    console.log('[CTS sw] === PROFILE DETECTION END ===');
    return null;
  } catch (err) {
    console.error('[CTS sw] detectProfileFromWindow failed:', err);
    return null;
  }
}

// ─── Proxy IP detection ─────────────────────────────────────────────────────
//
// Not in original spec — auto-detects the outbound proxy IP used by the
// anti-detect browser profile via ipify + ipinfo.io enrichment. Sent with
// each data batch so the server can track which proxy/geo each account uses,
// enabling proxy rotation analysis and geographic ban pattern detection.
//

interface DetectedProxy {
  ip: string;
  geo: string | null;
  org: string | null;
  asn: string | null;
}

/**
 * Detect the outbound IP address by querying ipify, then enrich with ipinfo.io.
 * This reveals the proxy IP used by the antidetect browser profile.
 * Runs once per service worker lifetime, cached in chrome.storage.local.
 */
async function detectProxyIP(): Promise<DetectedProxy | null> {
  try {
    console.log('[CTS sw] Detecting proxy IP...');

    // Step 1: Get IP from ipify
    const ipResponse = await fetch('https://api.ipify.org?format=json', { method: 'GET' });
    if (!ipResponse.ok) {
      console.warn('[CTS sw] ipify returned', ipResponse.status);
      return null;
    }
    const ipData = await ipResponse.json() as { ip?: string };
    const ip = ipData.ip;
    if (!ip) return null;

    console.log('[CTS sw] Detected IP:', ip);

    // Step 2: Enrich with ipinfo.io (free tier, no API key needed)
    let geo: string | null = null;
    let org: string | null = null;
    let asn: string | null = null;

    try {
      const infoResponse = await fetch(`https://ipinfo.io/${ip}/json`, { method: 'GET' });
      if (infoResponse.ok) {
        const info = await infoResponse.json() as Record<string, unknown>;
        const country = info['country'] as string | undefined;
        const region = info['region'] as string | undefined;
        const city = info['city'] as string | undefined;
        geo = [city, region, country].filter(Boolean).join(', ') || null;
        org = (info['org'] as string | undefined) ?? null;
        // ipinfo.io org field often includes ASN like "AS12345 Provider Name"
        const orgStr = org ?? '';
        const asnMatch = orgStr.match(/^(AS\d+)/);
        asn = asnMatch?.[1] ?? null;
      }
    } catch {
      // ipinfo.io enrichment is optional — IP alone is valuable
    }

    const proxy: DetectedProxy = { ip, geo, org, asn };
    console.log('[CTS sw] Proxy info:', JSON.stringify(proxy));

    // Cache in storage
    await chrome.storage.local.set({ [PROXY_CACHE_KEY]: proxy });

    return proxy;
  } catch (err) {
    console.error('[CTS sw] Proxy detection failed:', err);
    return null;
  }
}

/** Restore cached proxy info on service worker startup. */
async function restoreCachedProxy(): Promise<void> {
  const cached = await chrome.storage.local.get(PROXY_CACHE_KEY);
  const proxy = cached[PROXY_CACHE_KEY] as DetectedProxy | undefined;
  if (proxy) {
    proxyDetected = true;
    console.log('[CTS sw] Restored cached proxy:', proxy.ip, proxy.geo);
  }
}

/** Get cached proxy info from storage. */
export async function getCachedProxy(): Promise<DetectedProxy | null> {
  const cached = await chrome.storage.local.get(PROXY_CACHE_KEY);
  return (cached[PROXY_CACHE_KEY] as DetectedProxy | undefined) ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a UUID v4 fallback for unknown/undetected browsers. */
function generateUUID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Get or generate a stable fallback profile ID (persisted across restarts). */
async function getFallbackProfileId(): Promise<string> {
  const result = await chrome.storage.local.get(FALLBACK_UUID_KEY);
  if (result[FALLBACK_UUID_KEY]) return result[FALLBACK_UUID_KEY] as string;
  const uuid = generateUUID();
  await chrome.storage.local.set({ [FALLBACK_UUID_KEY]: uuid });
  return uuid;
}

async function getConfig(): Promise<ExtensionConfig> {
  const result = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
  const stored = (result[CONFIG_STORAGE_KEY] as ExtensionConfig | undefined);
  // Clone to avoid mutating DEFAULT_CONFIG or stored reference
  const config: ExtensionConfig = stored
    ? { ...stored }
    : { ...DEFAULT_CONFIG };
  // Use build-time constants only if they were actually replaced (not placeholders)
  const isPlaceholder = (v: string) => v.startsWith('__CTS_') && v.endsWith('_PLACEHOLDER__');
  if (BUILD_CONFIG.SERVER_URL && !isPlaceholder(BUILD_CONFIG.SERVER_URL)) {
    config.serverUrl = BUILD_CONFIG.SERVER_URL;
  }
  if (BUILD_CONFIG.API_KEY && !isPlaceholder(BUILD_CONFIG.API_KEY)) {
    config.apiKey = BUILD_CONFIG.API_KEY;
  }
  return config;
}

async function saveConfig(config: ExtensionConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
}

async function saveStatus(): Promise<void> {
  status.queuedItems = await getQueueSize();
  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: status });
  await updateBadge();
}

interface PersistentStats {
  totalEventsSent: number;
  lastSendTimestamp: string | null;
}

async function loadStats(): Promise<void> {
  const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
  const stats = result[STATS_STORAGE_KEY] as PersistentStats | undefined;
  if (stats) {
    status.totalEventsSent = stats.totalEventsSent ?? 0;
    if (stats.lastSendTimestamp) {
      status.lastSyncAt = stats.lastSendTimestamp;
    }
  }
}

async function recordSentEvents(count: number): Promise<void> {
  status.totalEventsSent += count;
  status.lastSyncAt = new Date().toISOString();
  status.connected = true;
  const stats: PersistentStats = {
    totalEventsSent: status.totalEventsSent,
    lastSendTimestamp: status.lastSyncAt,
  };
  await chrome.storage.local.set({ [STATS_STORAGE_KEY]: stats });
}

/** Restore cached profile on service worker startup (survives SW restart). */
async function restoreCachedProfile(): Promise<void> {
  const cached = await chrome.storage.local.get(PROFILE_CACHE_KEY);
  const profile = cached[PROFILE_CACHE_KEY] as DetectedProfile | undefined;
  if (profile) {
    status.profileName = profile.profileName;
    status.antidetectBrowser = profile.browser;
    profileDetected = true;
    console.log('[CTS sw] Restored cached profile:', profile.browser, '/', profile.profileName);
  }
}

// ─── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse: (response: unknown) => void) => {
    const tabId = sender.tab?.id;
    console.log('[CTS sw] Message received:', message.type, 'from tab', tabId ?? 'popup');
    handleMessage(message, tabId)
      .then((result) => {
        console.log('[CTS sw] Message handled:', message.type, result);
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[CTS sw] Handler error:', message.type, err);
        sendResponse({ error: String(err) });
      });
    return true; // Keep message channel open for async response
  },
);

async function handleMessage(message: RuntimeMessage, tabId?: number): Promise<unknown> {
  switch (message.type) {
    case MessageType.INTERCEPTED_RESPONSE: {
      status.totalIntercepted++;

      const { url, method, status: httpStatus, body, timestamp, googleCid, requestBody } = message.payload;

      // ── Detect antidetect browser from window tabs (once per SW lifetime) ──
      if (!profileDetected && tabId) {
        console.log('[CTS sw] First intercept — attempting profile detection from window tabs');
        const detected = await detectProfileFromWindow(tabId);
        if (detected) {
          status.profileName = detected.profileName;
          status.antidetectBrowser = detected.browser;
          profileDetected = true;

          // Persist to config + cache
          const cfg = await getConfig();
          cfg.profileId = detected.profileName;
          await saveConfig(cfg);
          await chrome.storage.local.set({ [PROFILE_CACHE_KEY]: detected });
          console.log('[CTS sw] Profile saved to config:', detected.profileName);
        } else {
          console.log('[CTS sw] No antidetect detected — popup will prompt for profile name');
        }
      }

      // ── Detect proxy IP (once per SW lifetime) ──
      if (!proxyDetected) {
        proxyDetected = true; // Prevent concurrent detections
        detectProxyIP().catch(() => {});
      }

      // ── Resolve CID: page URL params → tab cache ──
      // CID comes ONLY from page-injector (URL query/hash params).
      // Response body extraction was removed — protobuf field guessing
      // cannot distinguish CID from campaign_id/billing_id/notification_id.
      let resolvedCid = googleCid ?? null;

      // If page-injector provided a valid CID, update per-tab cache
      if (resolvedCid && VALID_CID_RE.test(resolvedCid) && tabId) {
        tabCidCache.set(tabId, resolvedCid);
      }

      // Fallback: per-tab cache (same tab had CID on a previous request)
      if (!resolvedCid && tabId) {
        resolvedCid = tabCidCache.get(tabId) ?? null;
      }

      // Update status for popup display
      if (resolvedCid) {
        status.currentCid = resolvedCid;
      }

      // Use a temporary fallback for queueing — data is always collected.
      // If user hasn't set profile yet, use fallback UUID so nothing is lost.
      const config = await getConfig();
      if (!config.profileId) {
        config.profileId = await getFallbackProfileId();
        await saveConfig(config);
        console.log('[CTS sw] Temp fallback profile ID for queue:', config.profileId);
      }

      // Include resolved CID in data
      const cidFields = resolvedCid ? { googleCid: resolvedCid } : {};

      // Queue billing request body separately — server will parse it
      if (requestBody) {
        await enqueue('billing_request', { url, requestBody, timestamp, ...cidFields });
      }

      // Try to parse as JSON for structured extraction
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        // Not JSON — queue as raw text so nothing is lost
        await enqueue('raw', { url, method, httpStatus, body, timestamp, ...cidFields });
        await saveStatus();
        return { ok: true, queued: 'raw_text' };
      }

      // Attempt structured extraction
      const extracted = extractData(url, parsed);
      if (extracted) {
        await enqueue(extracted.type, {
          ...(extracted.data as unknown as Record<string, unknown>),
          _sourceUrl: url,
          ...cidFields,
        });

        // ── Status change detection for account data ──
        if (extracted.type === 'account') {
          const accountData = extracted.data as unknown as Record<string, unknown>;
          const accountId = (accountData['accountId'] as string | undefined) ?? googleCid;
          if (accountId) {
            const detectedStatus = extractAccountStatus(accountData);
            if (detectedStatus) {
              const change = await checkForStatusChange(accountId, detectedStatus);
              if (change) {
                console.log(`[CTS sw] STATUS CHANGE: ${accountId} ${change.previous_status} → ${change.new_status}`);
                await enqueueUrgent('status_change', {
                  accountId: change.account_id,
                  previousStatus: change.previous_status,
                  newStatus: change.new_status,
                  detectedAt: change.detected_at,
                  ...cidFields,
                });
                // Trigger immediate send for urgent items
                const cfg = await getConfig();
                if (cfg.serverUrl && cfg.apiKey) {
                  sendUrgentItems(cfg).catch(() => {});
                }
              }
            }
          }
        }

        await saveStatus();
        return { ok: true, queued: extracted.type };
      }

      // No extractor matched — queue raw parsed payload
      await enqueue('raw', { url, method, httpStatus, body: parsed as Record<string, unknown>, timestamp, ...cidFields });
      await saveStatus();
      return { ok: true, queued: 'raw' };
    }

    case MessageType.SEND_BATCH: {
      const config = await getConfig();
      const result = await sendBatch(config);

      if (result.success) {
        await recordSentEvents(result.processed);
        status.lastError = null;
        status.lastSuccessAt = new Date().toISOString();
        // Keep only last 10 errors
        if (status.errors.length > 10) {
          status.errors = status.errors.slice(-10);
        }
      } else if (result.error) {
        status.errors.push(result.error);
        status.lastError = result.error;
        status.connected = false;
      }

      await saveStatus();
      return result;
    }

    case MessageType.UPDATE_CONFIG: {
      await saveConfig(message.config);

      // Update batch alarm interval
      await chrome.alarms.clear(BATCH_ALARM_NAME);
      chrome.alarms.create(BATCH_ALARM_NAME, {
        periodInMinutes: message.config.batchIntervalMs / 60000,
      });

      // Test connection with detailed diagnostics
      const connResult = await testConnectionDetailed(message.config);
      status.connected = connResult.ok;
      status.lastError = connResult.error;
      if (connResult.ok) status.lastSuccessAt = new Date().toISOString();
      await saveStatus();

      return { ok: true, connected: status.connected };
    }

    case MessageType.SET_PROFILE: {
      const { profileName, browser } = message;
      console.log('[CTS sw] SET_PROFILE from popup:', browser, '/', profileName);

      // Save to config
      const cfg = await getConfig();
      cfg.profileId = profileName;
      await saveConfig(cfg);

      // Save to cache
      const profile: DetectedProfile = { browser, profileName };
      await chrome.storage.local.set({ [PROFILE_CACHE_KEY]: profile });

      // Update status
      status.profileName = profileName;
      status.antidetectBrowser = browser;
      profileDetected = true;

      // Test connection with detailed diagnostics
      const profileConnResult = await testConnectionDetailed(cfg);
      status.connected = profileConnResult.ok;
      status.lastError = profileConnResult.error;
      if (profileConnResult.ok) status.lastSuccessAt = new Date().toISOString();
      await saveStatus();

      return { ok: true, connected: status.connected };
    }

    case MessageType.GET_STATUS: {
      status.queuedItems = await getQueueSize();
      const cfg = await getConfig();
      status.serverUrl = cfg.serverUrl || null;
      status.apiKeyLast4 = cfg.apiKey ? cfg.apiKey.slice(-4) : null;
      return status;
    }

    case MessageType.SET_PROFILE_CONFIG: {
      // Profile config is saved by popup directly to chrome.storage.local.
      // This message is a notification so the service worker can acknowledge it.
      return { ok: true };
    }

    case MessageType.STATUS_CHANGE: {
      // Enqueue the status change as urgent and send immediately
      const changeData = message.data as Record<string, unknown> | undefined;
      if (changeData) {
        await enqueueUrgent('status_change', changeData);
      }
      const config = await getConfig();
      if (config.serverUrl && config.apiKey) {
        await sendUrgentItems(config);
      }
      return { ok: true };
    }

    case MessageType.RETRY_CONNECTION: {
      const config = await getConfig();

      // Validate config before attempting connection
      if (!config.serverUrl) {
        status.connected = false;
        status.lastError = 'Server URL не настроен';
        await saveStatus();
        return { ...status };
      }
      if (!config.apiKey) {
        status.connected = false;
        status.lastError = 'API Key не настроен — пересоберите расширение с EXT_API_KEY';
        status.serverUrl = config.serverUrl || null;
        status.apiKeyLast4 = null;
        await saveStatus();
        return { ...status };
      }

      const result = await testConnectionDetailed(config);
      if (result.ok) {
        status.connected = true;
        status.lastError = null;
        status.lastSuccessAt = new Date().toISOString();
        // Trigger queue flush on successful reconnection
        if (config.serverUrl && config.apiKey) {
          const batchResult = await sendBatch(config);
          if (batchResult.success && batchResult.processed > 0) {
            await recordSentEvents(batchResult.processed);
          }
        }
      } else {
        status.connected = false;
        status.lastError = result.error;
      }
      await saveStatus();
      status.queuedItems = await getQueueSize();
      status.serverUrl = config.serverUrl || null;
      status.apiKeyLast4 = config.apiKey ? config.apiKey.slice(-4) : null;
      return { ...status };
    }

    default: {
      console.warn('[CTS sw] Unknown message type:', (message as Record<string, unknown>).type);
      return { error: `Unknown message type: ${(message as Record<string, unknown>).type}` };
    }
  }
}

// ─── Alarms ─────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === BATCH_ALARM_NAME) {
    const config = await getConfig();
    if (config.serverUrl && config.apiKey) {
      // Auto-generate profileId if needed
      if (!config.profileId) {
        config.profileId = await getFallbackProfileId();
        await saveConfig(config);
      }
      const result = await sendBatch(config);
      if (result.success && result.processed > 0) {
        await recordSentEvents(result.processed);
      }
      await saveStatus();
    }
  }

  if (alarm.name === POLL_ALARM_NAME) {
    await pollActiveGoogleAdsTabs();
  }

  if (alarm.name === BADGE_ALARM_NAME) {
    await updateBadge();
  }
});

// ─── Background polling ─────────────────────────────────────────────────────

const GOOGLE_ADS_URL_PATTERN = 'https://ads.google.com/*';

/**
 * Poll all open Google Ads tabs: ping content scripts and re-inject if needed.
 *
 * MV3 service workers get terminated after inactivity. Content scripts survive
 * but may lose their connection. This polling ensures:
 * 1. Content scripts are still responsive (ping/pong)
 * 2. SPA navigations that don't trigger manifest matches still get intercepted
 * 3. We trigger a batch send if there is queued data
 */
async function pollActiveGoogleAdsTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: GOOGLE_ADS_URL_PATTERN });
    console.log(`[CTS sw] Polling ${tabs.length} Google Ads tab(s)`);

    for (const tab of tabs) {
      if (!tab.id) continue;

      try {
        // Ping the content script to check if it's alive
        await chrome.tabs.sendMessage(tab.id, { type: 'cts_ping' });
        console.log(`[CTS sw] Tab ${tab.id} content script alive`);
      } catch {
        // Content script not responding — re-inject both scripts
        console.log(`[CTS sw] Tab ${tab.id} content script dead — re-injecting`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['interceptors/page-injector.js'],
            world: 'MAIN' as chrome.scripting.ExecutionWorld,
          });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ['content/content-script.js'],
          });
          console.log(`[CTS sw] Re-injected scripts into tab ${tab.id}`);
        } catch (injectErr) {
          console.warn(`[CTS sw] Re-injection failed for tab ${tab.id}:`, injectErr);
        }
      }
    }

    // Also trigger a batch send if data is queued
    const config = await getConfig();
    if (config.serverUrl && config.apiKey) {
      const queueSize = await getQueueSize();
      if (queueSize > 0) {
        console.log(`[CTS sw] Poll: ${queueSize} items queued, sending batch`);
        const result = await sendBatch(config);
        if (result.success && result.processed > 0) {
          await recordSentEvents(result.processed);
          await saveStatus();
        }
      }
    }
  } catch (err) {
    console.error('[CTS sw] pollActiveGoogleAdsTabs failed:', err);
  }
}

// ─── Alarm setup ────────────────────────────────────────────────────────────

/**
 * Ensure alarms exist. Called on install, browser startup, and SW restart.
 * Chrome alarms persist across service worker restarts, but we verify
 * to guard against edge cases where they might be cleared.
 */
async function ensureAlarms(): Promise<void> {
  const config = await getConfig();

  const existing = await chrome.alarms.getAll();
  const hasBatch = existing.some(a => a.name === BATCH_ALARM_NAME);
  const hasPoll = existing.some(a => a.name === POLL_ALARM_NAME);
  const hasBadge = existing.some(a => a.name === BADGE_ALARM_NAME);

  if (!hasBatch) {
    chrome.alarms.create(BATCH_ALARM_NAME, {
      periodInMinutes: Math.max(config.batchIntervalMs / 60000, 0.5),
    });
    console.log('[CTS sw] Created batch alarm');
  }

  if (!hasPoll) {
    chrome.alarms.create(POLL_ALARM_NAME, {
      periodInMinutes: 30,
    });
    console.log('[CTS sw] Created poll alarm');
  }

  if (!hasBadge) {
    chrome.alarms.create(BADGE_ALARM_NAME, {
      periodInMinutes: 0.5, // Every 30 seconds
    });
    console.log('[CTS sw] Created badge alarm');
  }
}

// ─── Tab lifecycle: clean up per-tab CID cache ──────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCidCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  try {
    const newUrl = new URL(changeInfo.url);
    if (newUrl.hostname !== 'ads.google.com') {
      // Navigated away from Google Ads — clear cache
      tabCidCache.delete(tabId);
      return;
    }
    // Still on ads.google.com — check if account changed (different ocid/__c).
    // Clear cache so page-injector's fresh extraction takes priority.
    // This handles SPA navigation between accounts in the same tab.
    const params = new URLSearchParams(newUrl.search);
    const urlCid = params.get('ocid') ?? params.get('__c') ?? null;
    if (urlCid && VALID_CID_RE.test(urlCid)) {
      const cached = tabCidCache.get(tabId);
      if (cached && cached !== urlCid) {
        // Account switch detected — invalidate old cache
        tabCidCache.delete(tabId);
      }
    }
  } catch {
    tabCidCache.delete(tabId);
  }
});

// ─── Initialization ─────────────────────────────────────────────────────────

console.log('[CTS sw] Service worker loaded');

// Restore cached profile + proxy detection + stats on SW restart
restoreCachedProfile();
restoreCachedProxy();
loadStats();

// Ensure alarms exist on every SW startup (not just onInstalled)
ensureAlarms();

chrome.runtime.onInstalled.addListener(async () => {
  // Force-recreate alarms on install/update
  await chrome.alarms.clear(BATCH_ALARM_NAME);
  await chrome.alarms.clear(POLL_ALARM_NAME);
  await chrome.alarms.clear(BADGE_ALARM_NAME);
  await ensureAlarms();
  await saveStatus();
});

chrome.runtime.onStartup.addListener(async () => {
  // Browser cold start — ensure alarms + restore state
  await ensureAlarms();
  await saveStatus();
});
