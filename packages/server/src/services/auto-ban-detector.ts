import type pg from 'pg';
import { generatePostMortem } from './post-mortem.service.js';
import { scoreAccountOnBan } from './ai/auto-scoring.service.js';
import { scoreOnBanDetected } from './ai/leaderboard.service.js';
import { notifyOwnerAndAdmins, formatCid } from './notification.service.js';
import * as telegram from './telegram-bot.service.js';

/**
 * Auto-ban detection service.
 *
 * When a signal with signal_name = "account_suspended" and value.1 = true is detected,
 * automatically creates a ban_log entry if one doesn't already exist.
 *
 * When the signal changes to value.1 = false, resolves the existing ban.
 *
 * After ban creation: auto-generates post-mortem and logs Telegram-ready alert.
 */

/**
 * Check if the account_suspended signal indicates suspension and create/resolve ban accordingly.
 */
export async function checkAndCreateBan(
  pool: pg.Pool,
  accountGoogleId: string,
  signalValue: unknown,
): Promise<void> {
  const isSuspended = isAccountSuspended(signalValue);

  if (isSuspended) {
    await handleSuspension(pool, accountGoogleId);
  } else {
    await handleResolution(pool, accountGoogleId);
  }
}

function isAccountSuspended(signalValue: unknown): boolean {
  if (signalValue == null || typeof signalValue !== 'object') return false;
  const obj = signalValue as Record<string, unknown>;

  // signal_value is stored as { value: ..., code: ... }
  const val = obj['value'];
  if (val != null && typeof val === 'object') {
    const inner = val as Record<string, unknown>;
    if (inner['1'] === true) return true;
  }
  if (val === true) return true;

  // Direct check
  if (obj['1'] === true) return true;

  return false;
}

async function handleSuspension(
  pool: pg.Pool,
  accountGoogleId: string,
  options: { silent?: boolean } = {},
): Promise<void> {
  // Check if ANY unresolved ban already exists (auto or manual)
  const existing = await pool.query(
    `SELECT id FROM ban_logs
     WHERE account_google_id = $1
       AND resolved_at IS NULL
     LIMIT 1`,
    [accountGoogleId],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    console.log(`[auto-ban-detector] Ban already exists for CID ${accountGoogleId}, skipping`);
    return;
  }

  // Extract ban reason from latest notification_details for this account
  const banReasonGoogle = await extractBanReason(pool, accountGoogleId);

  // Build snapshot: current account state + latest signals + latest notifications + campaigns + billing
  const [accountSnap, signalsSnap, notificationsSnap, campaignsSnap, billingSnap] = await Promise.all([
    pool.query(`SELECT * FROM accounts WHERE google_account_id = $1`, [accountGoogleId]),
    pool.query(
      `SELECT signal_name, signal_value, captured_at
       FROM account_signals
       WHERE account_google_id = $1
       ORDER BY captured_at DESC LIMIT 50`,
      [accountGoogleId],
    ),
    pool.query(
      `SELECT notifications, captured_at
       FROM account_notifications
       WHERE account_google_id = $1
       ORDER BY captured_at DESC LIMIT 5`,
      [accountGoogleId],
    ),
    pool.query(
      `SELECT campaign_id, campaign_name, campaign_type, status, budget_micros, currency
       FROM campaigns
       WHERE account_google_id = $1
       ORDER BY captured_at DESC LIMIT 20`,
      [accountGoogleId],
    ),
    pool.query(
      `SELECT payment_method, balance_formatted, threshold_micros
       FROM billing_info
       WHERE account_google_id = $1
       ORDER BY captured_at DESC LIMIT 1`,
      [accountGoogleId],
    ),
  ]);

  // Use the earliest timestamp we have evidence of suspension as ban time.
  // Prefer the first account_signals.captured_at for account_suspended —
  // this is when the extension first intercepted the suspension signal from Google Ads,
  // not when our detection code ran (avoids catch-up scans inflating the date).
  const banTimeResult = await pool.query(
    `SELECT MIN(captured_at) AS first_suspended_at
     FROM account_signals
     WHERE account_google_id = $1 AND signal_name = 'account_suspended'`,
    [accountGoogleId],
  );
  const bannedAt: Date = banTimeResult.rows[0]?.['first_suspended_at'] ?? new Date();

  // Calculate lifetime_hours: from earliest Google Ads campaign start_date to ban time.
  // start_date is stored as "YYYYMMDDHHmmss" from CampaignService/List interception.
  // Fallback: earliest raw_payload capture (first time extension saw this account).
  const lifetimeResult = await pool.query(
    `SELECT COALESCE(
       (SELECT EXTRACT(EPOCH FROM ($2::timestamptz - MIN(TO_TIMESTAMP(SUBSTRING(start_date, 1, 8), 'YYYYMMDD')))) / 3600
        FROM campaigns
        WHERE account_google_id = $1
          AND start_date IS NOT NULL
          AND LENGTH(start_date) >= 8
          AND start_date ~ '^[0-9]{8}'),
       (SELECT EXTRACT(EPOCH FROM ($2::timestamptz - MIN(created_at))) / 3600
        FROM raw_payloads WHERE profile_id = $1)
     ) AS lifetime_hours`,
    [accountGoogleId, bannedAt.toISOString()],
  );
  const lifetimeHours = lifetimeResult.rows[0]?.['lifetime_hours']
    ? Math.round(Number(lifetimeResult.rows[0]['lifetime_hours']))
    : null;

  const snapshot = {
    account: accountSnap.rows[0] ?? null,
    signals: signalsSnap.rows,
    notifications: notificationsSnap.rows,
    campaigns: campaignsSnap.rows,
    billing: billingSnap.rows[0] ?? null,
    snapshot_taken_at: new Date().toISOString(),
  };

  await pool.query(
    `INSERT INTO ban_logs (
       account_google_id, is_banned, banned_at, ban_reason,
       ban_target, lifetime_hours, snapshot,
       ban_reason_internal, source
     ) VALUES ($1, true, $2, $3, 'account', $4, $5, $6, 'auto')`,
    [
      accountGoogleId,
      bannedAt.toISOString(),
      banReasonGoogle,
      lifetimeHours,
      JSON.stringify(snapshot),
      'Auto-detected from suspended signal',
    ],
  );

  // Get the created ban ID for post-mortem
  const banIdResult = await pool.query(
    `SELECT id FROM ban_logs
     WHERE account_google_id = $1 AND source = 'auto' AND resolved_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [accountGoogleId],
  );
  const banId = banIdResult.rows[0]?.['id'] as string | undefined;

  console.log(`[auto-ban-detector] Auto-created ban for CID ${accountGoogleId} (lifetime: ${lifetimeHours}h, reason: ${banReasonGoogle ?? 'unknown'})`);

  // Skip notifications and alerts for catch-up (historical) bans
  if (options.silent) {
    console.log(`[auto-ban-detector] Silent catch-up ban created for CID ${accountGoogleId}`);
    return;
  }

  // Notify account owner + admins about the ban
  const ownerUserId = (accountSnap.rows[0]?.['user_id'] as string | null) ?? null;
  const lifetime = lifetimeHours != null ? `${lifetimeHours}ч` : 'неизв.';
  notifyOwnerAndAdmins(pool, ownerUserId, {
    type: 'ban_detected',
    title: `Аккаунт ${formatCid(accountGoogleId)} забанен`,
    message: `Причина: ${banReasonGoogle ?? 'неизвестна'}. Лайфтайм: ${lifetime}`,
    severity: 'critical',
    metadata: { account_google_id: accountGoogleId, ban_log_id: banId ?? null },
  }).catch((err) => {
    console.error('[auto-ban-detector] Failed to create ban notification:', err instanceof Error ? err.message : err);
  });

  // АВТОМАТИЗАЦИЯ ML: Record pre-ban prediction score (non-blocking)
  scoreAccountOnBan(pool, accountGoogleId).catch(() => {});

  // Score AI model predictions for leaderboard accuracy tracking (non-blocking)
  scoreOnBanDetected(pool, accountGoogleId).catch(() => {});

  // АВТОМАТИЗАЦИЯ 3: Auto-generate post-mortem after 5s delay
  // Delay allows related payloads (keywords, campaigns) to finish parsing first
  if (banId) {
    const account = accountSnap.rows[0] as Record<string, unknown> | undefined;
    const telegramData: telegram.BanAlertData = {
      accountGoogleId,
      banReason: banReasonGoogle,
      domain: (account?.['final_url_domain'] as string | null) ?? null,
      offerVertical: (account?.['offer_vertical'] as string | null) ?? null,
      lifetimeHours,
      totalSpend: null,
      lastRiskScore: null,
    };

    setTimeout(() => {
      generatePostMortem(pool, banId)
        .then(() => {
          console.log(`[auto-ban-detector] Post-mortem auto-generated for ban ${banId}`);
        })
        .catch((err) => {
          console.error(`[auto-ban-detector] Post-mortem failed for ban ${banId}:`, err instanceof Error ? err.message : err);
        })
        .finally(() => {
          // АВТОМАТИЗАЦИЯ 6: Telegram ban alert (non-blocking)
          telegram.sendBanAlert(telegramData).catch(() => {});
        });
    }, 5000);
  }
}

/**
 * Scan ALL accounts for suspended signals and create auto-bans where missing.
 * This is a catch-up function for existing data where auto-ban detection
 * wasn't active when the signals were originally parsed.
 *
 * Returns a summary of actions taken.
 */
export async function scanAllSuspendedAccounts(
  pool: pg.Pool,
): Promise<{ scanned: number; created: number; skipped: number; errors: string[] }> {
  // Find all accounts whose latest account_suspended signal shows suspended=true
  const result = await pool.query(
    `SELECT DISTINCT ON (account_google_id)
       account_google_id, signal_value
     FROM account_signals
     WHERE signal_name = 'account_suspended'
     ORDER BY account_google_id, captured_at DESC`,
  );

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of result.rows) {
    const cid = row['account_google_id'] as string;
    const signalValue = row['signal_value'] as Record<string, unknown>;

    if (!isAccountSuspended(signalValue)) {
      skipped++;
      continue;
    }

    // Check if unresolved auto-ban already exists
    const existing = await pool.query(
      `SELECT id FROM ban_logs
       WHERE account_google_id = $1
         AND resolved_at IS NULL
         AND source = 'auto'
       LIMIT 1`,
      [cid],
    );

    if (existing.rowCount && existing.rowCount > 0) {
      skipped++;
      continue;
    }

    try {
      await handleSuspension(pool, cid, { silent: true });
      created++;
    } catch (err) {
      if (errors.length < 20) {
        errors.push(`${cid}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  }

  return { scanned: result.rowCount ?? 0, created, skipped, errors };
}

async function handleResolution(pool: pg.Pool, accountGoogleId: string): Promise<void> {
  const result = await pool.query(
    `UPDATE ban_logs
     SET resolved_at = NOW(), updated_at = NOW()
     WHERE account_google_id = $1
       AND resolved_at IS NULL
       AND source = 'auto'`,
    [accountGoogleId],
  );

  if (result.rowCount && result.rowCount > 0) {
    console.log(`[auto-ban-detector] Resolved ${result.rowCount} auto-ban(s) for CID ${accountGoogleId}`);

    // Notify owner + admins about ban resolution
    const accountResult = await pool.query(
      `SELECT user_id FROM accounts WHERE google_account_id = $1`,
      [accountGoogleId],
    );
    const ownerUserId = (accountResult.rows[0]?.['user_id'] as string | null) ?? null;
    notifyOwnerAndAdmins(pool, ownerUserId, {
      type: 'ban_resolved',
      title: `Бан аккаунта ${formatCid(accountGoogleId)} снят`,
      message: `Аккаунт больше не заблокирован`,
      severity: 'success',
      metadata: { account_google_id: accountGoogleId },
    }).catch((err) => {
      console.error('[auto-ban-detector] Failed to create resolution notification:', err instanceof Error ? err.message : err);
    });

    // Telegram notification (non-blocking)
    telegram.sendStatusChangeAlert({
      accountGoogleId,
      oldStatus: 'suspended',
      newStatus: 'active',
    }).catch(() => {});

  }
}

async function extractBanReason(pool: pg.Pool, accountGoogleId: string): Promise<string | null> {
  // First try notification_details table (parsed)
  const detailResult = await pool.query(
    `SELECT label, notification_type, title
     FROM notification_details
     WHERE account_google_id = $1
       AND (category = 'CRITICAL' OR notification_type ILIKE '%SUSPENDED%' OR label ILIKE '%UNACCEPTABLE%')
     ORDER BY captured_at DESC
     LIMIT 1`,
    [accountGoogleId],
  );

  if (detailResult.rowCount && detailResult.rowCount > 0) {
    const row = detailResult.rows[0]!;
    return (row['label'] as string) ?? (row['notification_type'] as string) ?? (row['title'] as string) ?? null;
  }

  // Fallback: scan raw notification JSONB for common ban reasons
  const rawResult = await pool.query(
    `SELECT notifications
     FROM account_notifications
     WHERE account_google_id = $1
     ORDER BY captured_at DESC
     LIMIT 5`,
    [accountGoogleId],
  );

  for (const row of rawResult.rows) {
    const notifData = row['notifications'] as Record<string, unknown> | null;
    if (!notifData) continue;

    const reason = extractReasonFromRawNotification(notifData);
    if (reason) return reason;
  }

  return null;
}

function extractReasonFromRawNotification(data: Record<string, unknown>): string | null {
  // Look in field "2" array for notification items
  const items = (data['2'] as unknown[]) ?? [];
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;

    // Check label field (field "6") for patterns like "7973813934:UNACCEPTABLE_BUSINESS_PRACTICES"
    const label = obj['6'] as string | undefined;
    if (label && /UNACCEPTABLE|CIRCUMVENTING|MISREPRESENTATION|MALWARE|COUNTERFEIT/i.test(label)) {
      return label;
    }

    // Check nested field 50.5 for Type/Category
    const field50 = obj['50'] as Record<string, unknown> | undefined;
    if (field50) {
      const kvPairs = field50['5'] as Array<Record<string, string>> | undefined;
      if (Array.isArray(kvPairs)) {
        for (const kv of kvPairs) {
          if (kv['1'] === 'Type' && kv['2']) return kv['2'];
        }
      }
    }
  }

  return null;
}
