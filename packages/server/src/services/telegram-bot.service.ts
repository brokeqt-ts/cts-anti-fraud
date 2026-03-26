import type { Pool } from 'pg';
import { env } from '../config/env.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BanAlertData {
  accountGoogleId: string;
  banReason: string | null;
  domain: string | null;
  offerVertical: string | null;
  lifetimeHours: number | null;
  totalSpend: number | null;
  lastRiskScore: number | null;
}

export interface RiskAlertData {
  accountGoogleId: string;
  riskScore: number;
  factors: string[];
}

export interface StatusChangeAlertData {
  accountGoogleId: string;
  oldStatus: string;
  newStatus: string;
}

export interface CreativeDecayAlertData {
  accountGoogleId: string;
  campaignName: string;
  adId: string;
  ctrPrevious: number;
  ctrCurrent: number;
  declinePercent: number;
}

interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_SECOND = 25;
let messagesSentThisSecond = 0;
let rateLimitResetAt = Date.now() + 1000;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  if (now >= rateLimitResetAt) {
    messagesSentThisSecond = 0;
    rateLimitResetAt = now + 1000;
  }
  if (messagesSentThisSecond >= MAX_MESSAGES_PER_SECOND) {
    const waitMs = rateLimitResetAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    messagesSentThisSecond = 0;
    rateLimitResetAt = Date.now() + 1000;
  }
  messagesSentThisSecond++;
}

// ─── Core send ────────────────────────────────────────────────────────────────

export async function sendMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.TELEGRAM_ENABLED) return false;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode });

  return sendWithRetry(url, body, chatId);
}

export async function sendMessageWithKeyboard(
  chatId: string,
  text: string,
  keyboard: InlineKeyboard,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.TELEGRAM_ENABLED) return false;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    reply_markup: keyboard,
  });

  return sendWithRetry(url, body, chatId);
}

async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    // ignore
  }
}

async function sendWithRetry(url: string, body: string, chatId: string): Promise<boolean> {
  const MAX_ATTEMPTS = 3;
  let delay = 1000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await waitForRateLimit();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (res.ok) return true;

      if (res.status === 429) {
        const json = await res.json().catch(() => ({})) as Record<string, unknown>;
        const retryAfter = ((json['parameters'] as Record<string, unknown> | undefined)?.['retry_after'] as number | undefined) ?? 1;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (res.status >= 400 && res.status < 500) {
        console.error(`[telegram] Non-retryable error ${res.status} for chat ${chatId}`);
        return false;
      }
    } catch (err) {
      console.error(`[telegram] Network error (attempt ${attempt}/${MAX_ATTEMPTS}):`, err);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }

  console.error(`[telegram] Failed to send message after ${MAX_ATTEMPTS} attempts`);
  return false;
}

// ─── Alert formatters ─────────────────────────────────────────────────────────

export async function sendBanAlert(data: BanAlertData): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const cid = formatCid(data.accountGoogleId);
  const reason = data.banReason ?? 'неизвестна';
  const domain = data.domain ?? '—';
  const vertical = data.offerVertical ?? '—';
  const lifetime = data.lifetimeHours != null ? `${data.lifetimeHours}ч` : '—';
  const spend = data.totalSpend != null ? `$${data.totalSpend.toFixed(2)}` : '—';
  const risk = data.lastRiskScore != null ? `${data.lastRiskScore}/100` : '—';
  const dashUrl = `${env.DASHBOARD_URL}/accounts/${data.accountGoogleId}`;

  const text = [
    '🚨 <b>БАН АККАУНТА</b>',
    '',
    `Аккаунт: <code>${cid}</code>`,
    `Причина: ${escapeHtml(reason)}`,
    `Домен: ${escapeHtml(domain)}`,
    `Вертикаль: ${escapeHtml(vertical)}`,
    `Lifetime: ${lifetime}`,
    `Потрачено: ${spend}`,
    '',
    `📊 Risk Score был: <b>${risk}</b>`,
    `🔗 <a href="${dashUrl}">Открыть в Dashboard</a>`,
  ].join('\n');

  await sendMessage(chatId, text);
}

export async function sendRiskAlert(data: RiskAlertData): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const cid = formatCid(data.accountGoogleId);
  const factorsList = data.factors.map((f) => `  • ${escapeHtml(f)}`).join('\n');
  const dashUrl = `${env.DASHBOARD_URL}/accounts/${data.accountGoogleId}`;

  const text = [
    '⚠️ <b>РИСК ПОВЫШЕН</b>',
    '',
    `Аккаунт: <code>${cid}</code>`,
    `Risk Score: <b>${data.riskScore}/100</b>`,
    '',
    'Факторы риска:',
    factorsList,
    '',
    `🔗 <a href="${dashUrl}">Открыть в Dashboard</a>`,
  ].join('\n');

  await sendMessage(chatId, text);
}

export async function sendStatusChangeAlert(data: StatusChangeAlertData): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const cid = formatCid(data.accountGoogleId);
  const emoji = data.newStatus === 'active' ? '✅' : data.newStatus === 'suspended' ? '🚨' : 'ℹ️';
  const dashUrl = `${env.DASHBOARD_URL}/accounts/${data.accountGoogleId}`;

  const text = [
    `${emoji} <b>СМЕНА СТАТУСА АККАУНТА</b>`,
    '',
    `Аккаунт: <code>${cid}</code>`,
    `Статус: ${escapeHtml(data.oldStatus)} → <b>${escapeHtml(data.newStatus)}</b>`,
    '',
    `🔗 <a href="${dashUrl}">Открыть в Dashboard</a>`,
  ].join('\n');

  await sendMessage(chatId, text);
}

export async function sendCreativeDecayAlert(data: CreativeDecayAlertData): Promise<void> {
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  const cid = formatCid(data.accountGoogleId);
  const emoji = data.declinePercent >= 30 ? '🔴' : '⚠️';
  const dashUrl = `${env.DASHBOARD_URL}/accounts/${data.accountGoogleId}`;

  const text = [
    `${emoji} <b>CREATIVE DECAY</b>`,
    '',
    `Аккаунт: <code>${cid}</code>`,
    `Кампания: ${escapeHtml(data.campaignName)}`,
    `Креатив: <code>${data.adId}</code>`,
    '',
    `📉 CTR упал на <b>${data.declinePercent.toFixed(1)}%</b>`,
    `  Было: ${data.ctrPrevious.toFixed(2)}%`,
    `  Стало: ${data.ctrCurrent.toFixed(2)}%`,
    '',
    '💡 Рекомендация: обновить креативы',
    `🔗 <a href="${dashUrl}">Открыть в Dashboard</a>`,
  ].join('\n');

  await sendMessage(chatId, text);
}

export async function sendTestMessage(chatId: string): Promise<boolean> {
  const text = [
    '✅ <b>CTS Anti-Fraud — тест уведомления</b>',
    '',
    'Telegram уведомления настроены корректно.',
    `Dashboard: <a href="${env.DASHBOARD_URL}">${env.DASHBOARD_URL}</a>`,
  ].join('\n');

  return sendMessage(chatId, text);
}

// ─── Connect flow (6-digit code) ─────────────────────────────────────────────

interface PendingCode {
  userId: string;
  code: string;
  expiresAt: number;
}

const pendingCodes = new Map<string, PendingCode>();
const CODE_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  if (pendingCodes.has(code)) return generateCode();
  return code;
}

function cleanExpiredCodes(): void {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (now >= entry.expiresAt) pendingCodes.delete(code);
  }
}

export async function startConnect(userId: string): Promise<{ code: string; bot_username: string | null }> {
  for (const [code, entry] of pendingCodes) {
    if (entry.userId === userId) pendingCodes.delete(code);
  }

  const code = generateCode();
  pendingCodes.set(code, {
    userId,
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  // Ensure polling is running
  ensurePollingStarted();

  const botUsername = await getBotUsername();
  return { code, bot_username: botUsername };
}

export async function getConnectStatus(
  userId: string,
  pool: Pool,
): Promise<{ connected: boolean; telegram_chat_id: string | null; pending: boolean }> {
  const result = await pool.query(
    `SELECT telegram_chat_id FROM users WHERE id = $1`,
    [userId],
  );
  const chatId = (result.rows[0] as { telegram_chat_id: string | null } | undefined)?.telegram_chat_id ?? null;

  let pending = false;
  for (const entry of pendingCodes.values()) {
    if (entry.userId === userId && Date.now() < entry.expiresAt) {
      pending = true;
      break;
    }
  }

  return { connected: chatId != null, telegram_chat_id: chatId, pending };
}

export async function disconnect(userId: string, pool: Pool): Promise<void> {
  await pool.query(`UPDATE users SET telegram_chat_id = NULL WHERE id = $1`, [userId]);
}

// ─── Bot info ─────────────────────────────────────────────────────────────────

let cachedBotUsername: string | null = null;

export async function getBotUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; result?: { username?: string } };
    cachedBotUsername = data.result?.username ?? null;
    return cachedBotUsername;
  } catch {
    return null;
  }
}

export function isBotConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN) && env.TELEGRAM_ENABLED;
}

// ─── Register bot commands with Telegram API ─────────────────────────────────

export async function registerBotCommands(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || !env.TELEGRAM_ENABLED) return;

  const { BOT_COMMANDS } = await import('./telegram-commands.service.js');

  try {
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
    console.log('[telegram] Bot commands registered');
  } catch (err) {
    console.error('[telegram] Failed to register bot commands:', err);
  }
}

// ─── Always-on polling ───────────────────────────────────────────────────────

let pollingActive = false;
let lastUpdateId = 0;

function ensurePollingStarted(): void {
  if (pollingActive) return;
  void startBotPolling();
}

/**
 * Start the always-on polling loop. Call once at server startup.
 * Handles: commands, callback queries, connect codes.
 */
export async function startBotPolling(): Promise<void> {
  if (!isBotConfigured()) {
    console.log('[telegram] Bot not configured, polling disabled');
    return;
  }
  if (pollingActive) return;

  // Delete any existing webhook to avoid 409 conflict with getUpdates
  const token = env.TELEGRAM_BOT_TOKEN!;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    const data = await res.json() as { ok: boolean };
    console.log(`[telegram] deleteWebhook: ok=${data.ok}`);
  } catch (err) {
    console.warn('[telegram] deleteWebhook failed:', err instanceof Error ? err.message : err);
  }

  pollingActive = true;
  console.log('[telegram] Starting bot polling...');

  pollLoop().catch((err) => {
    console.error('[telegram] Polling loop crashed:', err);
    pollingActive = false;
  });
}

export function stopBotPolling(): void {
  pollingActive = false;
}

async function pollLoop(): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN!;

  while (pollingActive) {
    cleanExpiredCodes();

    try {
      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=30&allowed_updates=["message","callback_query"]`;
      const res = await fetch(url);

      if (!res.ok) {
        console.error(`[telegram] getUpdates failed: ${res.status}`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const data = await res.json() as {
        ok: boolean;
        result?: Array<{
          update_id: number;
          message?: {
            chat: { id: number };
            text?: string;
            from?: { first_name?: string; username?: string };
          };
          callback_query?: {
            id: string;
            from: { id: number; first_name?: string; username?: string };
            message?: { chat: { id: number } };
            data?: string;
          };
        }>;
      };

      if (data.ok && data.result) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;

          try {
            if (update.callback_query) {
              await handleCallbackQueryUpdate(update.callback_query);
            } else if (update.message?.text) {
              await processUpdate(
                update.message.text.trim(),
                update.message.chat.id,
                update.message.from,
              );
            }
          } catch (err) {
            console.error('[telegram] Error processing update:', err);
          }
        }
      }
    } catch (err) {
      console.error('[telegram] Polling error:', err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function handleCallbackQueryUpdate(cq: {
  id: string;
  from: { id: number };
  message?: { chat: { id: number } };
  data?: string;
}): Promise<void> {
  // Answer callback to remove "loading" indicator
  await answerCallbackQuery(cq.id);

  if (!cq.data || !cq.message) return;

  const chatId = String(cq.message.chat.id);
  const { getPool } = await import('../config/database.js');
  const pool = getPool(env.DATABASE_URL);
  const { handleCallbackQuery } = await import('./telegram-commands.service.js');

  await handleCallbackQuery(chatId, cq.data, pool);
}

async function processUpdate(
  text: string,
  chatId: number,
  from?: { first_name?: string; username?: string },
): Promise<void> {
  const chatIdStr = String(chatId);

  // Handle /start with connect code (deep link)
  if (text.startsWith('/start ')) {
    const param = text.slice(7).trim();
    // If it's a 6-digit code, try to connect
    if (/^\d{6}$/.test(param)) {
      await handleConnectCode(param, chatId, from);
      return;
    }
    // Otherwise fall through to /start command handler
  }

  // Handle /command args
  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const command = parts[0].slice(1).replace(/@.*$/, ''); // remove @botname suffix
    const args = parts.slice(1).join(' ');

    const { getPool } = await import('../config/database.js');
    const pool = getPool(env.DATABASE_URL);
    const { handleCommand } = await import('./telegram-commands.service.js');

    const handled = await handleCommand(chatIdStr, command, args, pool);
    if (handled) return;

    // Unknown command
    await sendMessage(chatIdStr, 'Неизвестная команда. Введите /help для списка команд.');
    return;
  }

  // Plain 6-digit code (connect flow)
  if (/^\d{6}$/.test(text)) {
    await handleConnectCode(text, chatId, from);
    return;
  }

  // Check for pending feedback comment
  const { handlePendingComment } = await import('./telegram-commands.service.js');
  const { getPool } = await import('../config/database.js');
  const pool = getPool(env.DATABASE_URL);
  if (await handlePendingComment(chatIdStr, text, pool)) return;

  // Any other text — show help hint
  await sendMessage(chatIdStr, 'Введите /help для списка команд.');
}

async function handleConnectCode(
  code: string,
  chatId: number,
  from?: { first_name?: string; username?: string },
): Promise<void> {
  const chatIdStr = String(chatId);
  const entry = pendingCodes.get(code);

  if (!entry || Date.now() >= entry.expiresAt) {
    await sendMessage(chatIdStr, '❌ Код не найден или истёк. Запросите новый код в настройках.');
    return;
  }

  const { getPool } = await import('../config/database.js');
  const pool = getPool(env.DATABASE_URL);

  await pool.query(
    `UPDATE users SET telegram_chat_id = $1 WHERE id = $2`,
    [chatIdStr, entry.userId],
  );

  pendingCodes.delete(code);

  const name = from?.first_name ?? from?.username ?? 'пользователь';
  const text = [
    `✅ Telegram привязан, ${escapeHtml(name)}!`,
    '',
    'Теперь вы будете получать уведомления CTS Anti-Fraud в этот чат.',
    '',
    'Введите /help для списка команд.',
  ].join('\n');

  await sendMessage(chatIdStr, text);
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

export function formatCid(googleId: string): string {
  if (googleId.length === 10) {
    return `${googleId.slice(0, 3)}-${googleId.slice(3, 6)}-${googleId.slice(6)}`;
  }
  return googleId;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
