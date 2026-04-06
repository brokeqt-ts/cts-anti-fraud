import type pg from 'pg';
import { createNotificationChecked, formatCid } from './notification.service.js';

/** Google Ads CID: 7-10 digits only. */
const VALID_CID_RE = /^\d{7,10}$/;

/** Check whether a string is a valid Google Ads CID (7-10 digits). */
export function isValidCid(value: string): boolean {
  return VALID_CID_RE.test(value);
}

/**
 * Ensure an account row exists for the given Google Ads CID.
 * Validates format (7-10 digits). Returns the account UUID or null if invalid.
 */
export async function ensureAccountExists(
  pool: pg.Pool,
  googleAccountId: string,
  userId?: string | null,
  profileName?: string | null,
): Promise<string | null> {
  if (!googleAccountId || !VALID_CID_RE.test(googleAccountId)) {
    console.warn(`[ensureAccountExists] Invalid CID rejected: "${googleAccountId}"`);
    return null;
  }

  // Use antidetect profile name as display_name if available, otherwise CID
  const displayName = profileName && profileName.trim() && !VALID_CID_RE.test(profileName)
    ? profileName.trim()
    : googleAccountId;

  const result = await pool.query(
    `INSERT INTO accounts (google_account_id, display_name, user_id)
     VALUES ($1::text, $2::text, $3::uuid)
     ON CONFLICT (google_account_id) DO UPDATE SET
       user_id = COALESCE(accounts.user_id, EXCLUDED.user_id),
       display_name = CASE
         WHEN accounts.display_name IS NULL OR accounts.display_name ~ '^\\d{7,10}$'
         THEN COALESCE(NULLIF($2::text, accounts.google_account_id), accounts.display_name)
         ELSE accounts.display_name
       END,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS is_new`,
    [googleAccountId, displayName, userId ?? null],
  );

  const row = result.rows[0] as { id: string; is_new: boolean } | undefined;
  if (!row) return null;

  // Notify owner about newly connected account (non-blocking)
  if (row.is_new && userId) {
    createNotificationChecked(pool, {
      userId,
      type: 'account_connected',
      title: `Новый аккаунт ${formatCid(googleAccountId)} подключён`,
      message: 'Данные начали собираться',
      severity: 'success',
      metadata: { account_google_id: googleAccountId },
    }).catch(() => {});
  }

  return row.id;
}
