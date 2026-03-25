import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Verification Eligibility Parser — not in original spec.
 *
 * Parses CustomerVerificationEligibilityService/List to detect when Google
 * requires advertiser identity verification for an account. Verification
 * requests are a known precursor to increased scrutiny and potential bans —
 * tracking this status helps the team prioritize account rotation.
 *
 * body.1[].1 = customer_id ("7973813934")
 * body.1[].2 = verification_status (1 = eligible/required?)
 */
export async function parseVerificationEligibility(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;

  const entries = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log(`[verification-parser] body.1 is not an array or empty`);
    return;
  }

  let updated = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    const customerId = dig(entry, '1') as string | undefined;
    const cid = resolveCid(ctx, { bodyCustomerId: customerId });
    if (!cid) continue;

    const verificationRaw = dig(entry, '2') as number | string | undefined;
    if (verificationRaw == null) continue;

    // Map status values
    const statusMap: Record<string, string> = {
      '1': 'pending',
      '2': 'verified',
      '3': 'failed',
      '0': 'not_started',
    };
    const verificationStatus = statusMap[String(verificationRaw)] ?? 'not_started';

    try {
      await pool.query(
        `INSERT INTO accounts (google_account_id, verification_status)
         VALUES ($1, $2)
         ON CONFLICT (google_account_id) DO UPDATE SET
           verification_status = $2,
           updated_at = NOW()`,
        [cid, verificationStatus],
      );
      updated++;
    } catch (err) {
      console.error(`[verification-parser] Failed to update ${cid}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[verification-parser] Updated ${updated} accounts with verification status`);
}
