import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * TransactionsDetailsService/GetDetails (enhanced parser)
 *
 * Extracts detailed transaction data into the transaction_details table.
 *
 * body.1.1  = period { 1: year, 2: month }
 * body.1.19 = currency
 * body.1.2 through body.1.17 = various amount fields
 */
export async function parseTransactionDetails(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[transaction-detail-parser] TransactionsDetails invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  const txnData = dig(body, '1');
  if (!txnData || typeof txnData !== 'object') return;

  // Extract period
  const periodObj = dig(txnData, '1');
  let period: string | null = null;
  if (periodObj && typeof periodObj === 'object') {
    const year = (periodObj as Record<string, unknown>)['1'];
    const month = (periodObj as Record<string, unknown>)['2'];
    if (year && month) {
      period = `${year}-${String(month).padStart(2, '0')}`;
    }
  }

  const currency = dig(txnData, '19') as string | undefined;

  // Extract all amount fields
  const amounts: Record<string, unknown> = {};
  const amountFields = ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'];
  for (const field of amountFields) {
    const value = dig(txnData, field);
    if (value != null) {
      amounts[field] = value;
    }
  }

  if (Object.keys(amounts).length === 0 && !period) return;

  try {
    await pool.query(
      `INSERT INTO transaction_details (
         account_google_id, period, currency, amounts, raw_payload_id
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_google_id, period, raw_payload_id) DO UPDATE SET
         currency = COALESCE(EXCLUDED.currency, transaction_details.currency),
         amounts = COALESCE(EXCLUDED.amounts, transaction_details.amounts),
         updated_at = NOW()`,
      [
        cid,
        period,
        currency ?? null,
        JSON.stringify(amounts),
        rawPayloadId,
      ],
    );
    console.log(`[transaction-detail-parser] Stored transaction details for CID ${cid}, period ${period ?? 'unknown'}`);
  } catch (err) {
    console.error(`[transaction-detail-parser] Failed to insert:`, err instanceof Error ? err.message : err);
  }
}
