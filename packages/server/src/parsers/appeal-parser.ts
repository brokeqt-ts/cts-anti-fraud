import type { RpcContext } from './rpc-router.js';
import { dig, resolveCid } from './rpc-router.js';

/**
 * AccountSuspensionAppealService/List
 *
 * Shows appeal status. Body may contain appeal data or be empty if no appeal filed.
 * Updates the most recent ban_log with appeal_status info.
 */
export async function parseAppealStatus(ctx: RpcContext): Promise<void> {
  const { pool, body } = ctx;
  const cid = resolveCid(ctx);
  console.log(`[appeal-parser] AppealService/List invoked — CID: ${cid ?? '(none)'}`);
  if (!cid) return;

  // Check if there's actual appeal data
  const appealList = dig(body, '1') as unknown[] | undefined;

  let appealStatus = 'no_appeal';

  if (Array.isArray(appealList) && appealList.length > 0) {
    // There's appeal data — try to extract status
    const firstAppeal = appealList[0];
    const status = dig(firstAppeal, '2') as number | string | undefined;

    if (status != null) {
      // Map numeric status to string
      const statusMap: Record<string, string> = {
        '1': 'pending',
        '2': 'approved',
        '3': 'rejected',
        '4': 'in_review',
      };
      appealStatus = statusMap[String(status)] ?? `status_${status}`;
    } else {
      appealStatus = 'appeal_filed';
    }
  }

  try {
    // Update the most recent ban_log for this account with appeal status
    const result = await pool.query(
      `UPDATE ban_logs
       SET appeal_status = $1, updated_at = NOW()
       WHERE id = (
         SELECT id FROM ban_logs
         WHERE account_google_id = $2
         ORDER BY banned_at DESC
         LIMIT 1
       )`,
      [appealStatus, cid],
    );

    if (result.rowCount && result.rowCount > 0) {
      console.log(`[appeal-parser] Updated appeal_status to '${appealStatus}' for CID ${cid}`);
    } else {
      console.log(`[appeal-parser] No ban_log found for CID ${cid} to update appeal_status`);
    }
  } catch (err) {
    console.error(`[appeal-parser] Failed to update appeal status:`, err instanceof Error ? err.message : err);
  }
}
