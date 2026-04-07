import { MessageType } from '../types/messages.js';
import type { ExtensionStatus, ProfileConfig } from '../types/messages.js';

const PROFILE_CONFIG_KEY = 'profileConfig';
const STATS_STORAGE_KEY = 'cts_stats';

// ─── DOM Elements ───────────────────────────────────────────────────────────

const statusEl = document.getElementById('status') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;

const proxyProviderSelect = document.getElementById('proxyProvider') as HTMLSelectElement;
const proxyProviderCustom = document.getElementById('proxyProviderCustom') as HTMLInputElement;
const accountTypeSelect = document.getElementById('accountType') as HTMLSelectElement;
const paymentServiceSelect = document.getElementById('paymentService') as HTMLSelectElement;
const paymentServiceCustom = document.getElementById('paymentServiceCustom') as HTMLInputElement;

const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const errorContainer = document.getElementById('error-container') as HTMLDivElement;

const accountCidEl = document.getElementById('accountCid') as HTMLSpanElement;
const totalSentEl = document.getElementById('totalSent') as HTMLSpanElement;
const lastSendEl = document.getElementById('lastSend') as HTMLSpanElement;
const queueCountEl = document.getElementById('queueCount') as HTMLSpanElement;

const connectionErrorEl = document.getElementById('connection-error') as HTMLDivElement;
const connectionErrorTextEl = document.getElementById('connection-error-text') as HTMLSpanElement;
const retryBtn = document.getElementById('retryBtn') as HTMLButtonElement;
const errorInstructionEl = document.getElementById('error-instruction') as HTMLDivElement;
const staleWarningEl = document.getElementById('stale-warning') as HTMLDivElement;
const staleWarningTextEl = document.getElementById('stale-warning-text') as HTMLDivElement;
const sendNowBtn = document.getElementById('sendNowBtn') as HTMLButtonElement;
const debugSection = document.getElementById('debugSection') as HTMLDetailsElement;

const debugServerUrlEl = document.getElementById('debugServerUrl') as HTMLSpanElement;
const debugApiKeyEl = document.getElementById('debugApiKey') as HTMLSpanElement;
const debugLastSuccessEl = document.getElementById('debugLastSuccess') as HTMLSpanElement;
const debugLastErrorEl = document.getElementById('debugLastError') as HTMLSpanElement;
const debugQueueSizeEl = document.getElementById('debugQueueSize') as HTMLSpanElement;
const debugBrowserEl = document.getElementById('debugBrowser') as HTMLSpanElement;
const debugProfileEl = document.getElementById('debugProfile') as HTMLSpanElement;

// ─── Field fill state highlighting ──────────────────────────────────────────

function updateFieldHighlight(field: HTMLInputElement | HTMLSelectElement): void {
  const wrapper = field.closest('.field');
  if (!wrapper) return;
  const isFilled = field.value.trim() !== '';
  wrapper.classList.toggle('field--filled', isFilled);
  wrapper.classList.toggle('field--empty', !isFilled);
}

function updateAllFieldHighlights(): void {
  updateFieldHighlight(proxyProviderSelect);
  updateFieldHighlight(accountTypeSelect);
  updateFieldHighlight(paymentServiceSelect);
}

// ─── "Другой..." toggle logic ──────────────────────────────────────────────

function setupOtherToggle(select: HTMLSelectElement, customInput: HTMLInputElement): void {
  select.addEventListener('change', () => {
    if (select.value === '__other') {
      customInput.classList.remove('hidden');
      customInput.focus();
    } else {
      customInput.classList.add('hidden');
      customInput.value = '';
    }
    enableSaveIfDirty();
    updateFieldHighlight(select);
  });
  customInput.addEventListener('input', () => { enableSaveIfDirty(); updateFieldHighlight(select); });
}

setupOtherToggle(proxyProviderSelect, proxyProviderCustom);
setupOtherToggle(paymentServiceSelect, paymentServiceCustom);

function getSelectValue(select: HTMLSelectElement, customInput: HTMLInputElement): string {
  return select.value === '__other' ? customInput.value.trim() : select.value;
}

function setSelectWithCustom(select: HTMLSelectElement, customInput: HTMLInputElement, value: string): void {
  const options = Array.from(select.options);
  const match = options.find((o) => o.value === value && o.value !== '__other');
  if (match) {
    select.value = value;
    customInput.classList.add('hidden');
    customInput.value = '';
  } else if (value) {
    select.value = '__other';
    customInput.classList.remove('hidden');
    customInput.value = value;
  } else {
    select.value = '';
    customInput.classList.add('hidden');
    customInput.value = '';
  }
}

// ─── Retry button ────────────────────────────────────────────────────────────

retryBtn.addEventListener('click', async () => {
  retryBtn.disabled = true;
  retryBtn.textContent = 'Проверяю...';
  try {
    const result = (await chrome.runtime.sendMessage({
      type: MessageType.RETRY_CONNECTION,
    })) as ExtensionStatus | undefined;
    if (result && !('error' in result)) {
      updateStatusDisplay(result);
    } else {
      const errMsg = result && 'error' in result ? String((result as Record<string, unknown>).error) : 'Расширение не отвечает';
      connectionErrorTextEl.textContent = errMsg;
    }
  } catch {
    connectionErrorTextEl.textContent = 'Расширение не отвечает';
  }
  retryBtn.textContent = '\u{1f504} Повторить отправку';
  retryBtn.disabled = false;
});

// ─── "Send now" button ──────────────────────────────────────────────────────

sendNowBtn.addEventListener('click', async () => {
  sendNowBtn.disabled = true;
  sendNowBtn.textContent = 'Отправляю...';
  try {
    await chrome.runtime.sendMessage({ type: MessageType.SEND_BATCH });
    await refreshStatus();
  } catch {
    // ignore
  }
  sendNowBtn.textContent = 'Отправить сейчас';
  sendNowBtn.disabled = false;
});

// ─── Dirty tracking (enable save button on change) ─────────────────────────

let initialSnapshot = '';

function captureSnapshot(): string {
  return JSON.stringify({
    proxyProvider: getSelectValue(proxyProviderSelect, proxyProviderCustom),
    accountType: accountTypeSelect.value,
    paymentService: getSelectValue(paymentServiceSelect, paymentServiceCustom),
  });
}

function enableSaveIfDirty(): void {
  saveBtn.disabled = captureSnapshot() === initialSnapshot;
}

accountTypeSelect.addEventListener('change', () => { enableSaveIfDirty(); updateFieldHighlight(accountTypeSelect); });

// ─── Status display ─────────────────────────────────────────────────────────

function updateStatusDisplay(s: ExtensionStatus | null | undefined): void {
  if (!s) {
    // Received undefined/null from service worker — don't overwrite existing display
    console.warn('[CTS popup] updateStatusDisplay called with', s, '— skipping');
    return;
  }

  // Status indicator
  statusEl.className = 'status';
  let isError = false;
  if (s.connected) {
    if (s.totalIntercepted > 0) {
      statusEl.classList.add('status--connected');
      statusText.textContent = 'Подключено';
    } else {
      statusEl.classList.add('status--warning');
      statusText.textContent = 'Отправка...';
    }
    connectionErrorEl.classList.add('hidden');
    errorInstructionEl.classList.add('hidden');
  } else {
    isError = true;
    statusEl.classList.add('status--error');
    // Specific error text instead of generic "Нет связи"
    const errorReason = s.lastError || (s.errors.length > 0 ? s.errors[s.errors.length - 1] : null);
    if (errorReason) {
      if (errorReason.includes('401') || errorReason.includes('авториз')) {
        statusText.textContent = 'Ошибка авторизации 401';
      } else if (errorReason.includes('403')) {
        statusText.textContent = 'Доступ запрещён 403';
      } else if (errorReason.includes('ECONNREFUSED') || errorReason.includes('Failed to fetch') || errorReason.includes('недоступен')) {
        statusText.textContent = 'Сервер недоступен';
      } else {
        statusText.textContent = 'Нет связи с сервером';
      }
      connectionErrorTextEl.textContent = errorReason;
    } else {
      statusText.textContent = 'Нет связи с сервером';
      connectionErrorTextEl.textContent = 'Причина неизвестна';
    }
    connectionErrorEl.classList.remove('hidden');
    // Show error instruction (task 4)
    errorInstructionEl.classList.remove('hidden');
  }

  // Auto-expand diagnostics on error, collapse on recovery (task 6)
  if (isError) {
    debugSection.open = true;
  }

  // Account CID
  accountCidEl.textContent = s.currentCid
    ? s.currentCid.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')
    : '—';

  // Stats
  totalSentEl.textContent = String(s.totalEventsSent);
  lastSendEl.textContent = s.lastSyncAt ? formatRelativeTime(s.lastSyncAt) : '—';
  queueCountEl.textContent = String(s.queuedItems);

  // Errors
  if (s.errors.length > 0) {
    errorContainer.classList.remove('hidden');
    errorContainer.textContent = s.errors[s.errors.length - 1] ?? '';
  } else {
    errorContainer.classList.add('hidden');
  }

  // Debug info
  debugServerUrlEl.textContent = s.serverUrl
    ? (s.serverUrl.length > 40 ? s.serverUrl.slice(0, 40) + '...' : s.serverUrl)
    : '—';
  debugApiKeyEl.textContent = s.apiKeyLast4 ? `***${s.apiKeyLast4}` : '—';
  debugLastSuccessEl.textContent = s.lastSuccessAt ? formatRelativeTime(s.lastSuccessAt) : 'никогда';
  debugLastErrorEl.textContent = s.lastError || '—';
  debugQueueSizeEl.textContent = String(s.queuedItems);
  debugBrowserEl.textContent = s.antidetectBrowser || '—';
  debugProfileEl.textContent = s.profileName || '—';

  // Stale data warning (task 7): lastSuccessAt > 5 min ago AND queue > 0
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const lastSuccessMs = s.lastSuccessAt ? Date.now() - new Date(s.lastSuccessAt).getTime() : Infinity;
  if (lastSuccessMs > STALE_THRESHOLD_MS && s.queuedItems > 0) {
    const staleMinutes = Math.floor(lastSuccessMs / 60000);
    staleWarningTextEl.textContent = `Данные не отправляются уже ${staleMinutes} мин`;
    staleWarningEl.classList.remove('hidden');
  } else {
    staleWarningEl.classList.add('hidden');
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'только что';
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад`;
}

// ─── Refresh status ─────────────────────────────────────────────────────────

async function refreshStatus(): Promise<void> {
  try {
    const s = (await chrome.runtime.sendMessage({
      type: MessageType.GET_STATUS,
    })) as ExtensionStatus;
    updateStatusDisplay(s);
  } catch {
    // Extension context may be invalidated
  }
}

// ─── Load persisted stats directly from storage (faster than waiting for SW) ─

async function loadStatsFromStorage(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STATS_STORAGE_KEY);
    const stats = result[STATS_STORAGE_KEY] as { totalEventsSent?: number; lastSendTimestamp?: string | null } | undefined;
    if (stats) {
      totalSentEl.textContent = String(stats.totalEventsSent ?? 0);
      lastSendEl.textContent = stats.lastSendTimestamp ? formatRelativeTime(stats.lastSendTimestamp) : '—';
    }
  } catch {
    // Ignore
  }
}

// ─── Profile config persistence ─────────────────────────────────────────────

async function loadProfileConfig(): Promise<ProfileConfig | undefined> {
  const result = await chrome.storage.local.get(PROFILE_CONFIG_KEY);
  return result[PROFILE_CONFIG_KEY] as ProfileConfig | undefined;
}

async function saveProfileConfig(config: ProfileConfig): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_CONFIG_KEY]: config });
  try {
    await chrome.runtime.sendMessage({
      type: MessageType.SET_PROFILE_CONFIG,
      profileConfig: config,
    });
  } catch {
    // Service worker may not be ready
  }
}

// ─── Save handler ───────────────────────────────────────────────────────────

saveBtn.addEventListener('click', async () => {
  saveBtn.textContent = 'Сохраняю...';
  saveBtn.disabled = true;

  // Save profile config (proxy, account type, payment)
  const profileConfig: ProfileConfig = {
    proxy_provider: getSelectValue(proxyProviderSelect, proxyProviderCustom),
    account_type: accountTypeSelect.value,
    payment_service: getSelectValue(paymentServiceSelect, paymentServiceCustom),
  };
  await saveProfileConfig(profileConfig);

  // Update snapshot so button stays disabled until next change
  initialSnapshot = captureSnapshot();
  saveBtn.textContent = 'Сохранить';
  saveBtn.disabled = true;

  await refreshStatus();
});

// ─── Initialize ─────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Load profile config (proxy, account type, payment)
  const config = await loadProfileConfig();
  if (config) {
    setSelectWithCustom(proxyProviderSelect, proxyProviderCustom, config.proxy_provider);
    accountTypeSelect.value = config.account_type || '';
    setSelectWithCustom(paymentServiceSelect, paymentServiceCustom, config.payment_service);
  } else {
    // No saved config — fetch defaults from server (user's last-used config)
    try {
      const defaults = (await chrome.runtime.sendMessage({
        type: MessageType.FETCH_PROFILE_DEFAULTS,
      })) as { proxy_provider: string | null; account_type: string | null; payment_service: string | null } | undefined;
      if (defaults) {
        if (defaults.proxy_provider) setSelectWithCustom(proxyProviderSelect, proxyProviderCustom, defaults.proxy_provider);
        if (defaults.account_type) accountTypeSelect.value = defaults.account_type;
        if (defaults.payment_service) setSelectWithCustom(paymentServiceSelect, paymentServiceCustom, defaults.payment_service);
      }
    } catch {
      // Server not reachable — leave fields empty
    }
  }

  // Capture initial state for dirty tracking
  initialSnapshot = captureSnapshot();
  saveBtn.disabled = true;

  // Highlight filled/empty fields on load (task 2)
  updateAllFieldHighlights();

  // Load stats from storage immediately (no SW round-trip)
  await loadStatsFromStorage();

  // Then refresh full status from service worker
  await refreshStatus();

  // Trigger a live connection test on popup open so status reflects reality
  try {
    const result = (await chrome.runtime.sendMessage({
      type: MessageType.RETRY_CONNECTION,
    })) as ExtensionStatus;
    updateStatusDisplay(result);
  } catch {
    // Service worker not ready — status already set from refreshStatus
  }
}

init();

// Refresh every 5 seconds while popup is open
setInterval(refreshStatus, 5000);
