import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';
import { autoNameAccount } from '../services/auto-name.service.js';

/**
 * SettingsSummaryService/GetSummary
 *
 * body.2.3.1 → payment method name ("Visa •••• 8444")
 * body.2.4.5 → billing cycle end date { 1: year, 2: month, 3: day }
 * body.2.6.1 → payer name
 * body.2.7.1 → account nickname ("Google Ads 385-165-5493")
 * body.2.7.2 → payments profile ID
 */
export async function parseBillingSettings(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;

  const paymentMethodName = dig(body, '2', '3', '1') as string | undefined;
  const payerName = dig(body, '2', '6', '1') as string | undefined;
  const accountNickname = dig(body, '2', '7', '1') as string | undefined;
  const paymentsProfileId = dig(body, '2', '7', '2') as string | undefined;

  const cid = resolveCid(ctx, { nickname: accountNickname });
  console.log(`[billing-parser] SettingsSummary invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, nickname: ${accountNickname ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  const endDate = dig(body, '2', '4', '5');
  let billingCycleEnd: string | null = null;
  if (endDate && typeof endDate === 'object') {
    const y = (endDate as Record<string, unknown>)['1'];
    const m = (endDate as Record<string, unknown>)['2'];
    const d = (endDate as Record<string, unknown>)['3'];
    if (y && m && d) {
      billingCycleEnd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  await pool.query(
    `INSERT INTO accounts (google_account_id, display_name, payer_name, payments_profile_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (google_account_id) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, accounts.display_name),
       payer_name = COALESCE(EXCLUDED.payer_name, accounts.payer_name),
       payments_profile_id = COALESCE(EXCLUDED.payments_profile_id, accounts.payments_profile_id),
       updated_at = NOW()`,
    [
      cid,
      accountNickname ?? null,
      payerName ?? null,
      paymentsProfileId ?? null,
      JSON.stringify({
        _parser: 'SettingsSummaryService',
        _raw_payload_id: rawPayloadId,
        payment_method_name: paymentMethodName ?? null,
        billing_cycle_end: billingCycleEnd,
      }),
    ],
  );
}

/**
 * PaymentsSignupInfoService/Get
 *
 * body.1.2[0] → company name
 * body.1.2[1] → contact name
 * body.1.2[2] → address line 1
 * body.1.2[3] → city/zip
 * body.1.2[4] → country
 */
export async function parsePaymentsSignupInfo(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[billing-parser] PaymentsSignupInfo invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  const addressArray = dig(body, '1', '2') as string[] | undefined;
  if (!Array.isArray(addressArray)) return;

  const billingAddress = {
    company: addressArray[0] ?? null,
    contact: addressArray[1] ?? null,
    address_line1: addressArray[2] ?? null,
    city_zip: addressArray[3] ?? null,
    country: addressArray[4] ?? null,
  };

  await pool.query(
    `INSERT INTO accounts (google_account_id, billing_address)
     VALUES ($1, $2)
     ON CONFLICT (google_account_id) DO UPDATE SET
       billing_address = EXCLUDED.billing_address,
       updated_at = NOW()`,
    [cid, JSON.stringify(billingAddress)],
  );
}

/**
 * TransactionsDetailsService/GetDetails
 *
 * body.1.1  → period { 1: year, 2: month }
 * body.1.19 → currency
 * body.1.2 through body.1.17 → amounts
 */
export async function parseTransactionsDetails(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[billing-parser] TransactionsDetails invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  const currency = dig(body, '1', '19') as string | undefined;

  if (currency) {
    await pool.query(
      `INSERT INTO accounts (google_account_id, currency)
       VALUES ($1, $2)
       ON CONFLICT (google_account_id) DO UPDATE SET
         currency = COALESCE(EXCLUDED.currency, accounts.currency),
         updated_at = NOW()`,
      [cid, currency],
    );
    autoNameAccount(pool, cid).catch(() => {});
  }
}
