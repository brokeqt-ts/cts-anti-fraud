import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { checkAndCreateBan } from '../services/auto-ban-detector.js';

/**
 * EducationFeatureService/GetSignals
 *
 * body.1[] → array of signals
 *   .1 → signal name ("account_suspended")
 *   .2.1 → signal value (boolean/number/string)
 *   .4 → signal code
 */
export async function parseSignals(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[signals-parser] GetSignals invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  const signals = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(signals)) {
    console.log(`[signals-parser] body.1 is not an array, type: ${typeof dig(body, '1')}`);
    return;
  }

  console.log(`[signals-parser] Found ${signals.length} signals for CID ${cid}`);

  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') continue;

    const signalName = dig(signal, '1') as string | undefined;
    if (!signalName) continue;

    const signalValue = dig(signal, '2') ?? null;
    const signalCode = dig(signal, '4') ?? null;

    const storedValue = { value: signalValue, code: signalCode };

    await pool.query(
      `INSERT INTO account_signals (account_google_id, signal_name, signal_value, raw_payload_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (raw_payload_id, signal_name) WHERE raw_payload_id IS NOT NULL
       DO UPDATE SET
         signal_value = EXCLUDED.signal_value,
         updated_at = NOW()`,
      [
        cid,
        signalName,
        JSON.stringify(storedValue),
        rawPayloadId,
      ],
    );

    // Auto-ban detection: check account_suspended signals
    if (signalName === 'account_suspended') {
      // Update account status to suspended
      const isSuspended = signalValue === true
        || (signalValue != null && typeof signalValue === 'object' && (signalValue as Record<string, unknown>)['1'] === true);
      if (isSuspended) {
        await pool.query(
          `UPDATE accounts SET status = 'suspended', updated_at = NOW()
           WHERE google_account_id = $1 AND status NOT IN ('suspended', 'banned')`,
          [cid],
        );
      }

      try {
        await checkAndCreateBan(pool, cid, storedValue);
      } catch (err) {
        console.error(`[signals-parser] Auto-ban detection failed for CID ${cid}:`, err);
      }
    }
  }
}
