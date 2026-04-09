import type pg from 'pg';
import * as notificationsRepo from '../repositories/notifications.repository.js';
import type { CreateNotificationParams, ListNotificationsParams, NotificationRow } from '../repositories/notifications.repository.js';
import { getSettingCached, isCooldownActive } from './notification-settings.service.js';
import * as telegram from './telegram-bot.service.js';
import { broadcastToUser } from './sse-bus.js';

export type { CreateNotificationParams, NotificationRow };

// ─── Dedup key generation ────────────────────────────────────────────────────

/**
 * Generate a dedup key from notification type and metadata.
 * Same key within 24h = duplicate, will be skipped.
 */
function buildDedupKey(type: string, metadata?: Record<string, unknown> | null): string {
  const parts = [type];

  if (metadata) {
    // Use the most specific identifier available
    if (metadata['account_google_id']) parts.push(String(metadata['account_google_id']));
    if (metadata['campaign_id']) parts.push(String(metadata['campaign_id']));
    if (metadata['domain']) parts.push(String(metadata['domain']));
    if (metadata['ban_id']) parts.push(String(metadata['ban_id']));
  }

  return parts.join(':');
}

// ─── Core Operations ─────────────────────────────────────────────────────────

export async function createNotification(
  pool: pg.Pool,
  params: CreateNotificationParams,
): Promise<NotificationRow | null> {
  const row = await notificationsRepo.insertNotification(pool, params);
  if (row) {
    // Push to SSE clients in real-time
    broadcastToUser(params.userId, 'notification', {
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      severity: row.severity,
    });
    // Also push updated unread count
    const count = await notificationsRepo.countUnread(pool, params.userId);
    broadcastToUser(params.userId, 'unread_count', { count });
  }
  return row;
}

export async function getUserNotifications(
  pool: pg.Pool,
  userId: string,
  params: ListNotificationsParams,
): Promise<{ notifications: NotificationRow[]; total: number }> {
  return notificationsRepo.findByUser(pool, userId, params);
}

export async function getUnreadCount(pool: pg.Pool, userId: string): Promise<number> {
  return notificationsRepo.countUnread(pool, userId);
}

export async function markAsRead(
  pool: pg.Pool,
  notificationId: string,
  userId: string,
): Promise<boolean> {
  return notificationsRepo.markRead(pool, notificationId, userId);
}

export async function markAllRead(pool: pg.Pool, userId: string): Promise<number> {
  return notificationsRepo.markAllRead(pool, userId);
}

export async function deleteOldNotifications(pool: pg.Pool, daysOld: number): Promise<number> {
  return notificationsRepo.deleteOlderThan(pool, daysOld);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format CID as XXX-XXX-XXXX for display. */
export function formatCid(cid: string): string {
  if (cid.length === 10) {
    return `${cid.slice(0, 3)}-${cid.slice(3, 6)}-${cid.slice(6)}`;
  }
  return cid;
}

/**
 * Map notification type → notification_settings key.
 * Types without a mapping (e.g. 'system') bypass settings check.
 */
const TYPE_TO_SETTINGS_KEY: Record<string, string> = {
  ban_detected: 'auto_ban_detected',
  ban_resolved: 'auto_ban_resolved',
  risk_elevated: 'auto_risk_elevated',
  account_connected: 'auto_account_connected',
  predictive_ban_alert: 'auto_predictive_ban_alert',
};

export interface NotifyResult {
  sent: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Notify account owner + all active admins about an event.
 * Checks notification_settings before sending:
 *  1. enabled — if false, skip entirely
 *  2. cooldown — if recent notification of same type for same account, skip
 *  3. severity — override from settings
 *  4. notify_owner / notify_admins — select recipients
 */
export async function notifyOwnerAndAdmins(
  pool: pg.Pool,
  ownerUserId: string | null,
  params: Omit<CreateNotificationParams, 'userId'>,
): Promise<NotifyResult> {
  const settingsKey = TYPE_TO_SETTINGS_KEY[params.type];

  // If there's a settings key, check DB settings
  if (settingsKey) {
    const setting = await getSettingCached(pool, settingsKey);

    // 1. Enabled check
    if (!setting || !setting.enabled) {
      return { sent: 0, skipped: true, reason: 'disabled' };
    }

    // 2. Cooldown check
    if (setting.cooldown_minutes > 0) {
      const accountGoogleId = (params.metadata?.['account_google_id'] as string) ?? '';
      if (accountGoogleId) {
        const onCooldown = await isCooldownActive(pool, params.type, accountGoogleId, setting.cooldown_minutes);
        if (onCooldown) {
          return { sent: 0, skipped: true, reason: 'cooldown' };
        }
      }
    }

    // 3. Override severity from settings + add dedup key
    const dedupKey = buildDedupKey(params.type, params.metadata);
    const effectiveParams = { ...params, severity: setting.severity, dedupKey };

    // 4. Select recipients based on settings
    const notifiedIds = new Set<string>();

    if (setting.notify_owner && ownerUserId) {
      await createNotification(pool, { ...effectiveParams, userId: ownerUserId });
      notifiedIds.add(ownerUserId);
    }

    if (setting.notify_admins) {
      const admins = await pool.query(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = true`,
      );
      for (const admin of admins.rows) {
        const adminId = admin['id'] as string;
        if (!notifiedIds.has(adminId)) {
          await createNotification(pool, { ...effectiveParams, userId: adminId });
          notifiedIds.add(adminId);
        }
      }
    }

    // 5. Send to Telegram if enabled for this notification type
    if (shouldSendTelegram(setting)) {
      // a) Send to the setting-level chat ID (global override)
      const settingChatId = setting.telegram_chat_id ?? null;
      if (settingChatId) {
        dispatchTelegramNotification(params, settingChatId).catch(() => {});
      }

      // b) Send to each notified user's personal telegram_chat_id
      if (notifiedIds.size > 0) {
        const userChatIds = await pool.query(
          `SELECT telegram_chat_id FROM users WHERE id = ANY($1) AND telegram_chat_id IS NOT NULL`,
          [Array.from(notifiedIds)],
        );
        for (const row of userChatIds.rows) {
          const userChatId = (row as { telegram_chat_id: string }).telegram_chat_id;
          if (userChatId && userChatId !== settingChatId) {
            dispatchTelegramNotification(params, userChatId).catch(() => {});
          }
        }
      }
    }

    return { sent: notifiedIds.size, skipped: false };
  }

  // No settings key — send unconditionally with dedup
  const dedupKey = buildDedupKey(params.type, params.metadata);
  const paramsWithDedup = { ...params, dedupKey };
  const notifiedIds = new Set<string>();

  if (ownerUserId) {
    const n = await createNotification(pool, { ...paramsWithDedup, userId: ownerUserId });
    if (n) notifiedIds.add(ownerUserId);
  }

  const admins = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' AND is_active = true`,
  );

  for (const admin of admins.rows) {
    const adminId = admin['id'] as string;
    if (!notifiedIds.has(adminId)) {
      const n = await createNotification(pool, { ...paramsWithDedup, userId: adminId });
      if (n) notifiedIds.add(adminId);
    }
  }

  return { sent: notifiedIds.size, skipped: false };
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────

function shouldSendTelegram(setting: { telegram_enabled?: boolean | null }): boolean {
  return setting.telegram_enabled === true;
}

/**
 * Dispatch a Telegram notification based on notification type.
 * Uses a generic message format — type-specific alerts are sent directly
 * from auto-ban-detector.ts with richer data.
 */
async function dispatchTelegramNotification(
  params: Omit<CreateNotificationParams, 'userId'>,
  overrideChatId: string | null,
): Promise<void> {
  const text = [
    `<b>${escapeHtml(params.title)}</b>`,
    '',
    escapeHtml(params.message ?? ''),
  ].filter(Boolean).join('\n');

  await telegram.sendMessage(overrideChatId ?? '', text);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Create a notification with settings check (for direct callers like ensure-account).
 * Returns null if the notification type is disabled.
 */
export async function createNotificationChecked(
  pool: pg.Pool,
  params: CreateNotificationParams,
): Promise<NotificationRow | null> {
  const settingsKey = TYPE_TO_SETTINGS_KEY[params.type];

  if (settingsKey) {
    const setting = await getSettingCached(pool, settingsKey);
    if (!setting || !setting.enabled) return null;

    // Override severity from settings
    return createNotification(pool, { ...params, severity: setting.severity });
  }

  return createNotification(pool, params);
}
