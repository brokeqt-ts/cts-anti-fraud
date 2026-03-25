import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * Change History Parser — not in original spec.
 *
 * Captures raw change event data from Google Ads ChangeEvent/ChangeHistory
 * RPC services. Partially parses entries if recognizable structure is found.
 * Stores change events for audit trail and ban correlation — helps identify
 * which campaign modifications preceded account suspensions.
 *
 * Known structures (may vary):
 *   - body["1"] = array of change entries
 *   - entry["1"] = change_type / resource_type
 *   - entry["2"] = action (CREATE/UPDATE/REMOVE)
 *   - entry["3"] = changed_fields list
 *   - entry["5"] = old_resource snapshot
 *   - entry["6"] = new_resource snapshot
 *   - entry["7"] = user_email
 *   - entry["8"] = change timestamp
 */
export async function parseChangeHistory(ctx: RpcContext): Promise<void> {
  const { pool, rawPayloadId, sourceUrl, body } = ctx;

  const accountGoogleId = resolveCid(ctx) ?? 'unknown';

  // Extract RPC service name from URL
  const rpcMatch = sourceUrl.match(/\/rpc\/([^?]+)/);
  const rpcService = rpcMatch?.[1]?.split('?')[0] ?? 'unknown';

  console.log(`[change-history-parser] ${rpcService} — CID: ${accountGoogleId}`);

  if (!body || typeof body !== 'object') {
    // Store the raw call even if body is empty — useful for knowing what services fire
    await pool.query(
      `INSERT INTO change_history (account_google_id, rpc_service, raw_payload_id)
       VALUES ($1, $2, $3)`,
      [accountGoogleId, rpcService, rawPayloadId],
    );
    return;
  }

  const obj = body as Record<string, unknown>;

  // Try to find entries array — could be in body["1"], body["2"], etc.
  let entries: unknown[] | null = null;
  for (const key of ['1', '2', '3']) {
    const candidate = obj[key];
    if (Array.isArray(candidate) && candidate.length > 0) {
      entries = candidate;
      break;
    }
  }

  if (!entries || entries.length === 0) {
    // No recognizable entries — store a single row with full body
    await pool.query(
      `INSERT INTO change_history (account_google_id, rpc_service, raw_entry, raw_payload_id)
       VALUES ($1, $2, $3, $4)`,
      [accountGoogleId, rpcService, JSON.stringify(body), rawPayloadId],
    );
    return;
  }

  let parsed = 0;

  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;

    // Try to extract known fields
    const changeType = dig(entry, '1') as string | undefined;
    const action = dig(entry, '2') as string | undefined;
    const changedFields = dig(entry, '3') as string | string[] | undefined;
    const oldValue = dig(entry, '5') as Record<string, unknown> | undefined;
    const newValue = dig(entry, '6') as Record<string, unknown> | undefined;
    const userEmail = dig(entry, '7') as string | undefined;
    const changedAt = dig(entry, '8') as string | undefined;

    // Try to find resource type / resource ID from various locations
    const resourceType = dig(entry, '4') as string | undefined;
    const resourceId = dig(entry, '9') as string | undefined;

    const fieldsStr = Array.isArray(changedFields)
      ? changedFields.join(', ')
      : typeof changedFields === 'string' ? changedFields : null;

    let changedAtTs: Date | null = null;
    if (changedAt) {
      try {
        const d = new Date(changedAt);
        if (!isNaN(d.getTime())) changedAtTs = d;
      } catch { /* skip */ }
      // Also try epoch seconds/ms
      if (!changedAtTs && /^\d+$/.test(changedAt)) {
        const n = Number(changedAt);
        const d = new Date(n > 1e12 ? n : n * 1000);
        if (!isNaN(d.getTime()) && d.getFullYear() > 2020 && d.getFullYear() < 2030) changedAtTs = d;
      }
    }

    try {
      await pool.query(
        `INSERT INTO change_history (
           account_google_id, rpc_service, change_type, resource_type,
           resource_id, action, changed_fields, old_value, new_value,
           user_email, changed_at, raw_entry, raw_payload_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          accountGoogleId,
          rpcService,
          typeof changeType === 'string' ? changeType : null,
          typeof resourceType === 'string' ? resourceType : null,
          typeof resourceId === 'string' ? resourceId : null,
          typeof action === 'string' ? action : null,
          fieldsStr,
          oldValue ? JSON.stringify(oldValue) : null,
          newValue ? JSON.stringify(newValue) : null,
          typeof userEmail === 'string' && userEmail.includes('@') ? userEmail : null,
          changedAtTs,
          JSON.stringify(entry),
          rawPayloadId,
        ],
      );
      parsed++;
    } catch (err) {
      console.error(`[change-history-parser] Failed to insert entry:`, err);
    }
  }

  if (parsed > 0) {
    console.log(`[change-history-parser] Stored ${parsed} change entries for CID ${accountGoogleId}`);
  }
}
