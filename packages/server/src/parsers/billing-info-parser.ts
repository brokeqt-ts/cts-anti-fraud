import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * BillingSummaryInfoService/Get
 *
 * body.1.3   = balance formatted string ("€10.00")
 * body.1.9.1 = payment method name ("Visa •••• 8444")
 * body.1.9.2 = payment method icon URL
 * body.1.13  = threshold in micros string
 */
export async function parseBillingSummaryInfo(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const accountNickname = dig(body, '2', '7', '1') as string | undefined;
  const cid = resolveCid(ctx, { nickname: accountNickname });
  console.log(`[billing-info-parser] BillingSummaryInfo invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, nickname: ${accountNickname ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  try {
    const balanceFormatted = dig(body, '1', '3') as string | undefined;
    const paymentMethod = dig(body, '1', '9', '1') as string | undefined;
    const paymentMethodIconUrl = dig(body, '1', '9', '2') as string | undefined;
    const thresholdRaw = dig(body, '1', '13') as string | undefined;

    const thresholdMicros = thresholdRaw ? parseInt(thresholdRaw, 10) : null;

    await pool.query(
      `INSERT INTO billing_info (
         account_google_id, payment_method, payment_method_icon_url,
         balance_formatted, threshold_micros, raw_payload_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_google_id, raw_payload_id) DO UPDATE SET
         payment_method = COALESCE(EXCLUDED.payment_method, billing_info.payment_method),
         payment_method_icon_url = COALESCE(EXCLUDED.payment_method_icon_url, billing_info.payment_method_icon_url),
         balance_formatted = COALESCE(EXCLUDED.balance_formatted, billing_info.balance_formatted),
         threshold_micros = COALESCE(EXCLUDED.threshold_micros, billing_info.threshold_micros),
         updated_at = NOW()`,
      [
        cid,
        paymentMethod ?? null,
        paymentMethodIconUrl ?? null,
        balanceFormatted ?? null,
        Number.isFinite(thresholdMicros) ? thresholdMicros : null,
        rawPayloadId,
      ],
    );
  } catch (err) {
    console.error(`[billing-info-parser] Failed to upsert billing summary:`, err instanceof Error ? err.message : err);
  }
}

/**
 * SettingsDetailsService/GetDetails
 *
 * body.2.4.5 = billing cycle end date { 1: year, 2: month, 3: day }
 * body.2.7.1 = account nickname (same as SettingsSummaryService)
 *
 * If a billing_info record exists for this account, update the billing_cycle_end field.
 */
export async function parseSettingsDetails(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;

  const accountNickname = dig(body, '2', '7', '1') as string | undefined;
  const cid = resolveCid(ctx, { nickname: accountNickname });
  console.log(`[billing-info-parser] SettingsDetails invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, nickname: ${accountNickname ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  try {
    const endDateObj = dig(body, '2', '4', '5');
    if (!endDateObj || typeof endDateObj !== 'object') return;

    const year = (endDateObj as Record<string, unknown>)['1'];
    const month = (endDateObj as Record<string, unknown>)['2'];
    const day = (endDateObj as Record<string, unknown>)['3'];

    if (!year || !month || !day) return;

    const billingCycleEnd = { year: Number(year), month: Number(month), day: Number(day) };

    // Update billing_cycle_end on the latest billing_info record for this account
    const result = await pool.query(
      `UPDATE billing_info
       SET billing_cycle_end = $1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM billing_info
         WHERE account_google_id = $2
         ORDER BY captured_at DESC
         LIMIT 1
       )`,
      [JSON.stringify(billingCycleEnd), cid],
    );

    if (result.rowCount === 0) {
      console.log(`[billing-info-parser] No billing_info record found for CID ${cid} to update billing_cycle_end`);
    }
  } catch (err) {
    console.error(`[billing-info-parser] Failed to update billing cycle end:`, err instanceof Error ? err.message : err);
  }
}
