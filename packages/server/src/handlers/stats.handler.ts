import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as statsRepo from '../repositories/stats.repository.js';
import { getUserIdFilter } from '../utils/user-scope.js';

export async function overviewHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);

  const [
    totalAccounts,
    totalBans,
    avgLifetimeHours,
    bansByVerticalRows,
    bansByTargetRows,
    recentBans,
    signalsSummaryRows,
  ] = await Promise.all([
    statsRepo.getAccountCount(pool, userId),
    statsRepo.getBanCount(pool, userId),
    statsRepo.getAvgLifetimeHours(pool, userId),
    statsRepo.getBansByVertical(pool, userId),
    statsRepo.getBansByTarget(pool, userId),
    statsRepo.getRecentBans(pool, userId),
    statsRepo.getSignalsSummary(pool, userId),
  ]);

  // Count suspended accounts from signals (latest account_suspended signal per account where value->'1' = true)
  const [bannedAccounts, suspendedAccounts] = await Promise.all([
    statsRepo.getDistinctBannedAccountCount(pool, userId),
    statsRepo.getSuspendedAccountCount(pool, userId),
  ]);

  const verticalMap: Record<string, number> = {};
  for (const row of bansByVerticalRows) {
    verticalMap[row.offer_vertical] = row.count;
  }

  const targetMap: Record<string, number> = {};
  for (const row of bansByTargetRows) {
    targetMap[row.ban_target] = row.count;
  }

  const signalsMap: Record<string, number> = {};
  for (const row of signalsSummaryRows) {
    const key = `${row.signal_name}_${JSON.stringify(row.signal_value)}`;
    signalsMap[key] = row.count;
  }

  // at_risk = accounts with bans but not currently suspended
  const atRiskAccounts = Math.max(0, bannedAccounts - suspendedAccounts);
  const activeAccounts = Math.max(0, totalAccounts - suspendedAccounts - atRiskAccounts);

  await reply.status(200).send({
    total_accounts: totalAccounts,
    total_bans: totalBans,
    active_accounts: activeAccounts,
    suspended_accounts: suspendedAccounts,
    at_risk_accounts: atRiskAccounts,
    avg_lifetime_hours: avgLifetimeHours,
    bans_by_vertical: verticalMap,
    bans_by_target: targetMap,
    recent_bans: recentBans,
    signals_summary: signalsMap,
  });
}
