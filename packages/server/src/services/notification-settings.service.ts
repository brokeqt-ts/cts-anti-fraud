import type pg from 'pg';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NotificationSetting {
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

export interface UpdateSettingParams {
  enabled?: boolean;
  severity?: string;
  notify_owner?: boolean;
  notify_admins?: boolean;
  cooldown_minutes?: number;
  telegram_enabled?: boolean;
  telegram_chat_id?: string | null;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

interface CacheEntry {
  setting: NotificationSetting;
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const cache = new Map<string, CacheEntry>();

export function invalidateCache(key: string): void {
  cache.delete(key);
}

export function invalidateAllCache(): void {
  cache.clear();
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getAllSettings(pool: pg.Pool): Promise<NotificationSetting[]> {
  const result = await pool.query(
    `SELECT * FROM notification_settings ORDER BY key`,
  );
  return result.rows as NotificationSetting[];
}

export async function getSetting(pool: pg.Pool, key: string): Promise<NotificationSetting | null> {
  const result = await pool.query(
    `SELECT * FROM notification_settings WHERE key = $1`,
    [key],
  );
  return (result.rows[0] as NotificationSetting) ?? null;
}

export async function getSettingCached(pool: pg.Pool, key: string): Promise<NotificationSetting | null> {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) {
    return entry.setting;
  }

  const setting = await getSetting(pool, key);
  if (setting) {
    cache.set(key, { setting, cachedAt: Date.now() });
  }
  return setting;
}

export async function isEnabled(pool: pg.Pool, key: string): Promise<boolean> {
  const setting = await getSettingCached(pool, key);
  return setting?.enabled ?? false;
}

export async function updateSetting(
  pool: pg.Pool,
  key: string,
  updates: UpdateSettingParams,
): Promise<NotificationSetting | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.enabled !== undefined) {
    setClauses.push(`enabled = $${paramIndex++}`);
    values.push(updates.enabled);
  }
  if (updates.severity !== undefined) {
    setClauses.push(`severity = $${paramIndex++}`);
    values.push(updates.severity);
  }
  if (updates.notify_owner !== undefined) {
    setClauses.push(`notify_owner = $${paramIndex++}`);
    values.push(updates.notify_owner);
  }
  if (updates.notify_admins !== undefined) {
    setClauses.push(`notify_admins = $${paramIndex++}`);
    values.push(updates.notify_admins);
  }
  if (updates.cooldown_minutes !== undefined) {
    setClauses.push(`cooldown_minutes = $${paramIndex++}`);
    values.push(updates.cooldown_minutes);
  }
  if (updates.telegram_enabled !== undefined) {
    setClauses.push(`telegram_enabled = $${paramIndex++}`);
    values.push(updates.telegram_enabled);
  }
  if (updates.telegram_chat_id !== undefined) {
    setClauses.push(`telegram_chat_id = $${paramIndex++}`);
    values.push(updates.telegram_chat_id);
  }

  if (setClauses.length === 0) return getSetting(pool, key);

  values.push(key);
  const result = await pool.query(
    `UPDATE notification_settings SET ${setClauses.join(', ')} WHERE key = $${paramIndex} RETURNING *`,
    values,
  );

  const setting = (result.rows[0] as NotificationSetting) ?? null;
  invalidateCache(key);
  return setting;
}

// ─── Cooldown check ──────────────────────────────────────────────────────────

/**
 * Check if a notification of this type was sent for this account within the cooldown window.
 * Returns true if the notification should be skipped (cooldown active).
 */
export async function isCooldownActive(
  pool: pg.Pool,
  notificationType: string,
  accountGoogleId: string,
  cooldownMinutes: number,
): Promise<boolean> {
  if (cooldownMinutes <= 0) return false;

  const result = await pool.query(
    `SELECT 1 FROM notifications
     WHERE type = $1
       AND metadata->>'account_google_id' = $2
       AND created_at > NOW() - INTERVAL '1 minute' * $3
     LIMIT 1`,
    [notificationType, accountGoogleId, cooldownMinutes],
  );

  return (result.rowCount ?? 0) > 0;
}
