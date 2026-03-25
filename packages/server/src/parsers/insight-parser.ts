import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * InsightService/GetDiagnostics
 *
 * Campaign diagnostics/health data.
 * Store as account metrics with type 'diagnostics'.
 */
export async function parseInsightDiagnostics(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[insight-parser] InsightService/GetDiagnostics invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  if (!body || typeof body !== 'object') return;

  // Store diagnostics data as a metric
  try {
    await pool.query(
      `INSERT INTO account_metrics (account_google_id, metric_type, data_points, raw_payload_id)
       VALUES ($1, $2, $3, $4)`,
      [cid, 'diagnostics', JSON.stringify(body), rawPayloadId],
    );
    console.log(`[insight-parser] Stored diagnostics for CID ${cid}`);
  } catch (err) {
    console.error(`[insight-parser] Failed to store diagnostics:`, err instanceof Error ? err.message : err);
  }
}

/**
 * CriterionDiagnosisService/Diagnose
 *
 * Keyword/criterion diagnosis data.
 * Store as account metrics with type 'criterion_diagnosis'.
 */
export async function parseCriterionDiagnosis(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[insight-parser] CriterionDiagnosisService/Diagnose invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  if (!body || typeof body !== 'object') return;

  // Extract diagnosis entries
  const entries = dig(body, '1') as unknown[] | undefined;
  const dataPoints = Array.isArray(entries) ? entries : [body];

  try {
    await pool.query(
      `INSERT INTO account_metrics (account_google_id, metric_type, data_points, raw_payload_id)
       VALUES ($1, $2, $3, $4)`,
      [cid, 'criterion_diagnosis', JSON.stringify(dataPoints), rawPayloadId],
    );
    console.log(`[insight-parser] Stored criterion diagnosis for CID ${cid}`);
  } catch (err) {
    console.error(`[insight-parser] Failed to store criterion diagnosis:`, err instanceof Error ? err.message : err);
  }
}
