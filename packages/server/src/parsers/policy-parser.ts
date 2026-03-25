import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * LocalizedPolicyTopicService/GetAllLocalizedPolicyTopics
 *
 * Maps policy violation codes to human-readable names.
 * Store as account metrics with type 'policy_topics' for lookup.
 */
export async function parsePolicyTopics(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[policy-parser] PolicyTopics invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  if (!body || typeof body !== 'object') return;

  // Extract policy topics list
  const topics = dig(body, '1') as unknown[] | undefined;
  if (!Array.isArray(topics) || topics.length === 0) {
    console.log(`[policy-parser] No policy topics found`);
    return;
  }

  // Parse into a structured lookup
  const policyLookup: Array<{ code: unknown; name: unknown; description: unknown }> = [];
  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') continue;
    policyLookup.push({
      code: dig(topic, '1'),
      name: dig(topic, '2'),
      description: dig(topic, '3'),
    });
  }

  try {
    await pool.query(
      `INSERT INTO account_metrics (account_google_id, metric_type, data_points, raw_payload_id)
       VALUES ($1, $2, $3, $4)`,
      [cid, 'policy_topics', JSON.stringify(policyLookup), rawPayloadId],
    );
    console.log(`[policy-parser] Stored ${policyLookup.length} policy topics for CID ${cid}`);
  } catch (err) {
    console.error(`[policy-parser] Failed to store policy topics:`, err instanceof Error ? err.message : err);
  }
}
