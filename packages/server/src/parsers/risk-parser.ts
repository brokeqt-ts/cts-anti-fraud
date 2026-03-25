import type { RpcContext } from './rpc-router.js';
import { resolveCid } from './rpc-router.js';

/**
 * HagridRiskVerdictService/GetHagridRiskVerdict
 *
 * Store the full verdict payload as-is for analysis.
 */
export async function parseRiskVerdict(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[risk-parser] RiskVerdict invoked — CID: ${cid ?? '(none)'}, URL CID: ${ctx.accountGoogleId ?? '(none)'}, profileId: ${ctx.profileId ?? '(none)'}`);
  if (!cid) return;

  await pool.query(
    `INSERT INTO risk_verdicts (account_google_id, verdict_data, raw_payload_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (raw_payload_id) WHERE raw_payload_id IS NOT NULL
     DO UPDATE SET
       verdict_data = EXCLUDED.verdict_data,
       updated_at = NOW()`,
    [cid, JSON.stringify(body), rawPayloadId],
  );
}
