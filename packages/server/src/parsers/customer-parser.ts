import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { autoNameAccount } from '../services/auto-name.service.js';

/**
 * CustomerService/List + CtCustomerService/List
 *
 * Contains rich account metadata:
 *   body.1[].1 = customer_id ("7923171594")
 *   body.1[].2.1 = conversion_tracking_id ("17855528496")
 *   body.1[].2.2 = account type (2 = standard)
 *   body.1[].2.9 = currency ("EUR")
 *   body.1[].2.13 = country code ("179")
 *   body.1[].2.14 = timezone code ("180")
 *   body.1[].2.31 = Google Tag (gtag) script with conversion ID
 *   body.1[].9 = languages array (["tr"])
 *   body.1[].12 = conversion_tracking_id (alternative location)
 */
export async function parseCustomerList(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;

  const customerList = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(customerList) || customerList.length === 0) {
    console.log(`[customer-parser] body.1 is not an array or empty`);
    return;
  }

  let updated = 0;

  for (const customer of customerList) {
    if (!customer || typeof customer !== 'object') continue;

    const customerId = dig(customer, '1') as string | undefined;
    const cid = resolveCid(ctx, { bodyCustomerId: customerId });
    if (!cid) continue;

    const conversionTrackingId =
      (dig(customer, '2', '1') as string | undefined) ??
      (dig(customer, '12') as string | undefined);
    const currency = dig(customer, '2', '9') as string | undefined;
    const timezoneCode = dig(customer, '2', '14') as string | undefined;
    const languages = dig(customer, '9') as unknown;

    // Extract gtag ID from the script content (field 2.31)
    const gtagScript = dig(customer, '2', '31') as string | undefined;
    let gtagId: string | null = null;
    if (gtagScript && typeof gtagScript === 'string') {
      const match = gtagScript.match(/AW-(\d+)/);
      if (match) {
        gtagId = `AW-${match[1]}`;
      }
    }

    try {
      await pool.query(
        `INSERT INTO accounts (google_account_id, currency, conversion_tracking_id, timezone, languages, gtag_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (google_account_id) DO UPDATE SET
           currency = COALESCE(EXCLUDED.currency, accounts.currency),
           conversion_tracking_id = COALESCE(EXCLUDED.conversion_tracking_id, accounts.conversion_tracking_id),
           timezone = COALESCE(EXCLUDED.timezone, accounts.timezone),
           languages = COALESCE(EXCLUDED.languages, accounts.languages),
           gtag_id = COALESCE(EXCLUDED.gtag_id, accounts.gtag_id),
           updated_at = NOW()`,
        [
          cid,
          currency ?? null,
          conversionTrackingId ?? null,
          timezoneCode ?? null,
          languages ? JSON.stringify(languages) : null,
          gtagId,
        ],
      );
      updated++;
    } catch (err) {
      console.error(`[customer-parser] Failed to update account ${cid}:`, err instanceof Error ? err.message : err);
    }
  }

  // Auto-name accounts that got new currency data
  for (const customer of customerList) {
    if (!customer || typeof customer !== 'object') continue;
    const customerId = dig(customer, '1') as string | undefined;
    const cid = resolveCid(ctx, { bodyCustomerId: customerId });
    if (cid) {
      autoNameAccount(pool, cid).catch(() => {});
    }
  }

  console.log(`[customer-parser] Updated ${updated} accounts from CustomerService/List`);
}
