import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * OverviewService/Get
 *
 * Parses chart data from the Google Ads overview page.
 *
 * Structure:
 * - body.1.1.2[] = array of chart sections
 *   - Each section: .1.10.1.1 = metric name (e.g. "impressions")
 *   - Each section: .10.1[] = data points array
 *     - Each point: {1: day_group, 2: hour_index, 3: value}
 */
export async function parseOverview(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[overview-parser] OverviewService/Get invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  // Navigate to chart sections: body.1.1.2[]
  const sections = dig(body, '1', '1', '2') as unknown[] | undefined;
  if (!Array.isArray(sections)) {
    console.log(`[overview-parser] No chart sections found at body.1.1.2`);
    return;
  }

  let inserted = 0;

  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;

    // Extract metric name: section.1.10.1.1
    const metricName = (dig(section, '1', '10', '1', '1') as string | undefined)
      ?? (dig(section, '1', '10', '1') as string | undefined);

    if (!metricName || typeof metricName !== 'string') continue;

    // Extract data points: section.10.1[]
    const dataPoints = dig(section, '10', '1') as unknown[] | undefined;
    const points: Array<{ day_index: unknown; hour: unknown; value: unknown }> = [];
    let totalValue = 0;

    if (Array.isArray(dataPoints)) {
      for (const point of dataPoints) {
        if (!point || typeof point !== 'object') continue;
        const p = point as Record<string, unknown>;
        const dayIndex = p['1'] ?? null;
        const hour = p['2'] ?? null;
        const value = p['3'] ?? 0;
        points.push({ day_index: dayIndex, hour, value });
        if (typeof value === 'number') totalValue += value;
        else if (typeof value === 'string') totalValue += parseFloat(value) || 0;
      }
    }

    await pool.query(
      `INSERT INTO account_metrics (account_google_id, metric_type, data_points, total_value, raw_payload_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        cid,
        metricName.toLowerCase(),
        JSON.stringify(points),
        totalValue,
        rawPayloadId,
      ],
    );
    inserted++;
  }

  console.log(`[overview-parser] Inserted ${inserted} metric rows for CID ${cid}`);
}
