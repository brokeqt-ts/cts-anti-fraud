import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Multilogin User Parser — not in original spec.
 *
 * Parses MultiLoginUserService/Get responses to extract Google account
 * owner details (email, display name, avatar) and linked CIDs. This data
 * populates the accounts table and helps map CIDs to human-readable
 * identities across the dashboard.
 *
 * Contains Google account email and linked CIDs:
 *   body.1[].1.2 = email ("truuuuer@gmail.com")
 *   body.1[].1.3 = display name ("_ Truer _")
 *   body.1[].1.4 = avatar URL
 *   body.1[].2[] = linked accounts:
 *     .3 = CID formatted ("385-165-5493")
 *     .6 = some internal ID
 */
export async function parseMultiLoginUser(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;

  const userList = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(userList) || userList.length === 0) {
    console.log(`[multilogin-parser] body.1 is not an array or empty`);
    return;
  }

  let updated = 0;

  for (const user of userList) {
    if (!user || typeof user !== 'object') continue;

    const email = dig(user, '1', '2') as string | undefined;
    const displayName = dig(user, '1', '3') as string | undefined;

    if (!email && !displayName) continue;

    // Get linked accounts
    const linkedAccounts = dig(user, '2') as unknown[] | undefined;
    if (!Array.isArray(linkedAccounts)) continue;

    for (const linked of linkedAccounts) {
      if (!linked || typeof linked !== 'object') continue;

      const cidFormatted = dig(linked, '3') as string | undefined;
      if (!cidFormatted) continue;

      // Remove dashes from formatted CID "385-165-5493" -> "3851655493"
      const cidClean = cidFormatted.replace(/-/g, '');
      if (!/^\d{7,13}$/.test(cidClean)) continue;

      try {
        await pool.query(
          `INSERT INTO accounts (google_account_id, email, google_display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (google_account_id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, accounts.email),
             google_display_name = COALESCE(EXCLUDED.google_display_name, accounts.google_display_name),
             updated_at = NOW()`,
          [cidClean, email ?? null, displayName ?? null],
        );
        updated++;
      } catch (err) {
        console.error(`[multilogin-parser] Failed to update account ${cidClean}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  // Also try to update the current context account if CID is available
  if (updated === 0 && userList.length > 0) {
    const firstUser = userList[0];
    const email = dig(firstUser, '1', '2') as string | undefined;
    const displayName = dig(firstUser, '1', '3') as string | undefined;
    const cid = resolveCid(ctx);

    if (cid && (email || displayName)) {
      try {
        await pool.query(
          `INSERT INTO accounts (google_account_id, email, google_display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (google_account_id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, accounts.email),
             google_display_name = COALESCE(EXCLUDED.google_display_name, accounts.google_display_name),
             updated_at = NOW()`,
          [cid, email ?? null, displayName ?? null],
        );
        updated++;
      } catch (err) {
        console.error(`[multilogin-parser] Failed to update context account:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`[multilogin-parser] Updated ${updated} accounts from MultiLoginUserService/Get`);
}
