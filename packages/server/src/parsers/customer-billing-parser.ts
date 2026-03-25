import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * CustomerBillingService/List
 *
 * body.1[].1 = customer_id
 * body.1[].2 = billing_account_id
 * body.1[].6 = billing status
 * body.1[].10 = payments_profile_id
 * body.1[].11 = billing_setup_id
 */
export async function parseCustomerBilling(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;

  const entries = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log(`[customer-billing-parser] body.1 is not an array or empty`);
    return;
  }

  let updated = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const customerId = dig(entry, '1') as string | undefined;
    const cid = resolveCid(ctx, { bodyCustomerId: customerId });
    if (!cid) continue;

    const paymentsProfileId = dig(entry, '10') as string | undefined;

    if (!paymentsProfileId) continue;

    try {
      await pool.query(
        `INSERT INTO accounts (google_account_id, payments_profile_id)
         VALUES ($1, $2)
         ON CONFLICT (google_account_id) DO UPDATE SET
           payments_profile_id = COALESCE(EXCLUDED.payments_profile_id, accounts.payments_profile_id),
           updated_at = NOW()`,
        [cid, paymentsProfileId],
      );
      updated++;
    } catch (err) {
      console.error(`[customer-billing-parser] Failed to update ${cid}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[customer-billing-parser] Updated ${updated} accounts with billing info`);
}
