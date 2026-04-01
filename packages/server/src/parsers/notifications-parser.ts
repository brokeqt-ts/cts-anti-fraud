import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Notification Details Parser — not in original spec.
 *
 * Parses NotificationService/List responses from Google Ads to extract
 * notification entries with severity, type, and message text. Stores
 * parsed details in the notification_details table for early warning
 * detection — policy violation and disapproval notifications often
 * precede account bans.
 *
 * Field "30" in entries may contain Google Ads CID.
 */
export async function parseNotifications(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  // Try shared CID resolution first
  let accountGoogleId = resolveCid(ctx);

  // Special fallback: scan notification entries for field "30" (CID)
  if (!accountGoogleId && body && typeof body === 'object') {
    const entries = dig(body, '1') as unknown[] | undefined;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const cid = dig(entry, '30') as string | undefined;
        if (cid) {
          accountGoogleId = cid;
          break;
        }
      }
    }
  }

  if (!accountGoogleId) {
    accountGoogleId = 'unknown';
  }

  console.log(`[notifications-parser] List invoked — CID: ${accountGoogleId}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);

  // Store raw notification as before
  await pool.query(
    `INSERT INTO account_notifications (account_google_id, notifications, raw_payload_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (raw_payload_id) WHERE raw_payload_id IS NOT NULL
     DO UPDATE SET
       notifications = EXCLUDED.notifications,
       updated_at = NOW()`,
    [accountGoogleId, JSON.stringify(body), rawPayloadId],
  );

  // Parse into notification_details table
  await parseNotificationDetails(pool, accountGoogleId, rawPayloadId, body);
}

/**
 * Blacklist of Google Ads UI notification types that are irrelevant for anti-fraud.
 * These are feature flags, promotional banners, and UI chrome — not policy signals.
 */
const NOTIFICATION_TYPE_BLACKLIST = new Set([
  'L2_MENU_EXPAND_COLLAPSE',
  'HALO_SCOPING_FEATURE',
  'PARENT_CHILD_REPORT_PROMO',
  'AWN_DS_FORECASTING_INGREDIENTS',
  'CREATIVE_BRIEF_AIMAX',
  'CREATIVE_BRIEF',
  'DATA_MANAGER_LAUNCH_IN_SA360',
  'DM_IN_SA360_CONVERSIONS',
  'ASSET_SUGGESTIONS_PROMO',
  'CONVERSION_TRACKING_PROMO',
  'SMART_CAMPAIGN_PROMO',
  'RECOMMENDATION_PROMO',
  'PERFORMANCE_INSIGHTS_PROMO',
  'AUDIENCE_SIGNAL_PROMO',
  'BROAD_MATCH_PROMO',
  'VALUE_BASED_BIDDING_PROMO',
  'INSIGHTS_PAGE_PROMO',
  'EXPERIMENTS_PROMO',
  'AUTO_APPLY_PROMO',
  'SEARCH_THEMES_PROMO',
  'DEMAND_GEN_PROMO',
  'PMAX_PROMO',
  'BRAND_RESTRICTIONS_PROMO',
  'OPTIMIZATION_SCORE_PROMO',
  'GOOGLE_ANALYTICS_LINK_PROMO',
]);

/** Returns true if the notification should be filtered out (noise). */
function isBlacklisted(notificationType: string | null, label: string | null, title: string | null): boolean {
  if (notificationType && NOTIFICATION_TYPE_BLACKLIST.has(notificationType)) return true;
  if (label && NOTIFICATION_TYPE_BLACKLIST.has(label)) return true;
  if (title && NOTIFICATION_TYPE_BLACKLIST.has(title)) return true;
  // Also filter generic promo patterns and known UI noise substrings
  const text = `${notificationType ?? ''} ${label ?? ''} ${title ?? ''}`;
  if (/_PROMO$/i.test(text)) return true;
  if (/EXPAND_COLLAPSE|HALO_|CREATIVE_BRIEF|FORECASTING|DATA_MANAGER|DM_IN_SA360|SCOPING_FEATURE/i.test(text)) return true;
  return false;
}

/**
 * Parse individual notification items from the body and insert into notification_details.
 *
 * The notification body has field "2" which is an array of items. Each item:
 *   - item.1 = notification_id
 *   - item.50.1 = title ("Your account is suspended")
 *   - item.50.2 = description ("Your account violated...")
 *   - item.50.5 = array of {1: key, 2: value} pairs → extract Category, Type
 *   - item.6 = label
 *   - item.5 = priority
 */
async function parseNotificationDetails(
  pool: import('pg').Pool,
  accountGoogleId: string,
  rawPayloadId: string,
  body: unknown,
): Promise<void> {
  if (!body || typeof body !== 'object') return;

  const obj = body as Record<string, unknown>;

  // Try field "2" directly, or nested under "notifications"
  let items: unknown[] | null = null;

  if (Array.isArray(obj['2'])) {
    items = obj['2'] as unknown[];
  }

  if (!items) {
    const notifs = obj['notifications'];
    if (notifs && typeof notifs === 'object' && !Array.isArray(notifs)) {
      const inner = notifs as Record<string, unknown>;
      if (Array.isArray(inner['2'])) {
        items = inner['2'] as unknown[];
      }
    }
  }

  if (!items || items.length === 0) return;

  let parsed = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;

    const notificationId = dig(entry, '1') as string | undefined;
    const field50 = dig(entry, '50') as Record<string, unknown> | undefined;
    let title = field50 ? (dig(field50, '1') as string | undefined) : undefined;
    let description = field50 ? (dig(field50, '2') as string | undefined) : undefined;
    const kvPairs = field50 ? (dig(field50, '5') as Array<Record<string, string>> | undefined) : undefined;
    const label = dig(entry, '6') as string | undefined;
    const priority = dig(entry, '5') as string | undefined;

    // Try alternative title/description sources when field 50 is absent
    if (!title) {
      // field "7" sometimes contains short text / title
      const field7 = dig(entry, '7') as string | undefined;
      if (field7 && typeof field7 === 'string' && field7.length > 3) title = field7;
    }
    if (!title) {
      // field "2" may have title text
      const field2 = dig(entry, '2') as string | undefined;
      if (field2 && typeof field2 === 'string' && field2.length > 3 && !/^\d+$/.test(field2)) title = field2;
    }
    if (!description) {
      // field "8" may contain extended message
      const field8 = dig(entry, '8') as string | undefined;
      if (field8 && typeof field8 === 'string' && field8.length > 3) description = field8;
    }
    // Deep scan: find the first string > 10 chars in the entry as fallback title
    if (!title && !description) {
      const found = findDeepString(entry, 0, 4);
      if (found) title = found;
    }

    // Extract category and type from key-value pairs
    let category: string = 'INFO';
    let notificationType: string | null = null;

    if (Array.isArray(kvPairs)) {
      for (const kv of kvPairs) {
        if (!kv || typeof kv !== 'object') continue;
        const name = kv['1'];
        const value = kv['2'];
        if (name === 'Category') {
          if (value === 'CRITICAL') category = 'CRITICAL';
          else if (value === 'WARNING') category = 'WARNING';
          else category = 'INFO';
        }
        if (name === 'Type') {
          notificationType = value ?? null;
        }
      }
    }

    // Infer category from content if not found in kvPairs
    if (!kvPairs || kvPairs.length === 0) {
      const allText = `${title ?? ''} ${description ?? ''} ${label ?? ''}`.toLowerCase();
      if (allText.includes('suspend') || allText.includes('violation') || allText.includes('disapproved')) {
        category = 'CRITICAL';
      } else if (allText.includes('warning') || allText.includes('payment') || allText.includes('billing')) {
        category = 'WARNING';
      }
    }

    if (!title && !description && !label && !notificationId) continue;

    // Filter out Google Ads UI noise (feature flags, promos, chrome)
    if (isBlacklisted(notificationType, label ?? null, title ?? null)) continue;

    try {
      await pool.query(
        `INSERT INTO notification_details (
           account_google_id, notification_id, title, description,
           category, notification_type, label, priority,
           raw_notification, raw_payload_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (notification_id, raw_payload_id)
         WHERE notification_id IS NOT NULL AND raw_payload_id IS NOT NULL
         DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           notification_type = EXCLUDED.notification_type,
           label = EXCLUDED.label,
           priority = EXCLUDED.priority,
           raw_notification = EXCLUDED.raw_notification,
           updated_at = NOW()`,
        [
          accountGoogleId,
          safeText(notificationId, 1000),
          safeText(title, 2000),
          safeText(description, 10000),
          safeText(category, 100),
          safeText(notificationType, 1000),
          safeText(label, 2000),
          priority != null ? safeText(String(priority), 255) : null,
          JSON.stringify(entry),
          rawPayloadId,
        ],
      );
      parsed++;
    } catch (err) {
      console.error(`[notifications-parser] Failed to insert notification detail:`, err);
    }
  }

  if (parsed > 0) {
    console.log(`[notifications-parser] Parsed ${parsed} notification details for CID ${accountGoogleId}`);
  }
}

/** Truncate a string to maxLen if it exceeds the limit (defense in depth). */
function safeText(value: string | undefined | null, maxLen: number): string | null {
  if (value == null) return null;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

/** Recursively find the first human-readable string (>10 chars, non-numeric) in an object. */
function findDeepString(obj: unknown, depth: number, maxDepth: number): string | null {
  if (depth > maxDepth || obj == null) return null;
  if (typeof obj === 'string' && obj.length > 10 && !/^\d+$/.test(obj)) return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDeepString(item, depth + 1, maxDepth);
      if (found) return found;
    }
  } else if (typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      const found = findDeepString(val, depth + 1, maxDepth);
      if (found) return found;
    }
  }
  return null;
}
