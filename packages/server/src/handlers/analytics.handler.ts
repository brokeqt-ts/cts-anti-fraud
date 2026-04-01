import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { generatePostMortem } from '../services/post-mortem.service.js';
import * as analyticsRepo from '../repositories/analytics.repository.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { getUserIdFilter } from '../utils/user-scope.js';
import * as creativeDecayService from '../services/creative-decay.service.js';

/** Timing helper — logs slow analytics queries for monitoring. */
function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  return fn().finally(() => {
    const ms = Math.round(performance.now() - start);
    if (ms > 500) {
      console.warn(`[analytics-timing] ${label}: ${ms}ms (SLOW)`);
    } else if (ms > 100) {
      console.log(`[analytics-timing] ${label}: ${ms}ms`);
    }
  });
}

/**
 * GET /analytics/ban-timing — KF-6: Ban Timing Intelligence
 *
 * Returns a 7×24 heatmap (day_of_week × hour) with ban counts.
 * DOW: 0=Sun .. 6=Sat. Reordered in response to Mon-first.
 */
export async function banTimingHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const rows = await analyticsRepo.getBanTimingHeatmap(pool, !userId, userId);

  // Build 7×24 matrix (Mon=0 .. Sun=6 in our output)
  // Postgres DOW: 0=Sun, 1=Mon .. 6=Sat → remap: pg_dow=1→0, 2→1, ..., 6→5, 0→6
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  let totalBans = 0;

  for (const row of rows) {
    const pgDow = row.day_of_week; // 0=Sun
    const dayIdx = pgDow === 0 ? 6 : pgDow - 1;
    heatmap[dayIdx]![row.hour] = row.ban_count;
    totalBans += row.ban_count;
  }

  // Find peak day and hour
  let peakDay = 0;
  let peakDayCount = 0;
  let peakHour = 0;
  let peakHourCount = 0;

  const dayTotals = Array(7).fill(0) as number[];
  const hourTotals = Array(24).fill(0) as number[];

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = heatmap[d]![h]!;
      dayTotals[d]! += v;
      hourTotals[h]! += v;
    }
  }

  for (let d = 0; d < 7; d++) {
    if (dayTotals[d]! > peakDayCount) { peakDayCount = dayTotals[d]!; peakDay = d; }
  }
  for (let h = 0; h < 24; h++) {
    if (hourTotals[h]! > peakHourCount) { peakHourCount = hourTotals[h]!; peakHour = h; }
  }

  const dayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  await reply.status(200).send({
    heatmap,
    day_labels: dayLabels,
    total_bans: totalBans,
    peak_day: dayLabels[peakDay],
    peak_day_index: peakDay,
    peak_hour: peakHour,
    avg_bans_per_day: totalBans > 0 ? Math.round((totalBans / 7) * 10) / 10 : 0,
    day_totals: dayTotals,
    hour_totals: hourTotals,
  });
}

/**
 * GET /analytics/overview — General analytics overview metrics.
 */
export async function analyticsOverviewHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const stats = await timed('overview', () => analyticsRepo.getOverviewStats(pool, userId));

  const totalAccounts = stats.banRate.total_accounts;
  const bannedAccounts = stats.banRate.banned_accounts;

  await reply.status(200).send({
    lifetime: stats.lifetime,
    ban_rate: {
      ...stats.banRate,
      rate_pct: totalAccounts > 0
        ? Math.round((bannedAccounts / totalAccounts) * 1000) / 10
        : 0,
    },
    spend: stats.spend,
    by_vertical: stats.verticals,
  });
}

/**
 * GET /analytics/spend-velocity?account_google_id=XXX — KF-3: Spend Velocity Anomaly
 */
export async function spendVelocityHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_google_id } = request.query as { account_google_id?: string };

  if (!account_google_id) {
    await reply.status(400).send({ error: 'account_google_id query param required', code: 'VALIDATION_ERROR' });
    return;
  }

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, account_google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const accountAge = await analyticsRepo.getAccountAge(pool, account_google_id);

  // Safe threshold: farm (<14d) = 20%, aged (>60d) = 50%, linear interpolation between
  let safeThreshold: number;
  if (accountAge <= 14) safeThreshold = 20;
  else if (accountAge >= 60) safeThreshold = 50;
  else safeThreshold = 20 + ((accountAge - 14) / (60 - 14)) * 30;
  safeThreshold = Math.round(safeThreshold * 10) / 10;

  const spendRows = await analyticsRepo.getDailySpend(pool, account_google_id);

  interface DailySpend { date: string; spend: number; change_pct: number | null }
  const dailySpend: DailySpend[] = [];
  interface Anomaly { date: string; change_pct: number; threshold: number }
  const anomalies: Anomaly[] = [];

  let prevSpend: number | null = null;
  for (const row of spendRows) {
    let changePct: number | null = null;

    if (prevSpend !== null && prevSpend > 0) {
      changePct = Math.round(((row.spend - prevSpend) / prevSpend) * 1000) / 10;
      if (changePct > safeThreshold) {
        anomalies.push({ date: row.date, change_pct: changePct, threshold: safeThreshold });
      }
    }

    dailySpend.push({ date: row.date, spend: row.spend, change_pct: changePct });
    prevSpend = row.spend;
  }

  const currentVelocity = dailySpend.length > 1 ? (dailySpend[dailySpend.length - 1]?.change_pct ?? 0) : 0;

  let status: string;
  if (currentVelocity === null || currentVelocity === 0 || currentVelocity <= safeThreshold) {
    status = 'normal';
  } else if (currentVelocity <= safeThreshold * 2) {
    status = 'elevated';
  } else {
    status = 'critical';
  }

  await reply.status(200).send({
    account_google_id,
    account_age_days: accountAge,
    daily_spend: dailySpend,
    safe_threshold_pct: safeThreshold,
    anomalies,
    current_velocity: currentVelocity,
    status,
  });
}

/**
 * GET /analytics/spend-velocity-all — KF-3: Spend Velocity for all accounts.
 */
export async function spendVelocityAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const rows = await timed('spend-velocity-all', () => analyticsRepo.getVelocityAllAccounts(pool, userId));

  const accounts = rows.map(r => {
    const age = r.account_age_days;
    let threshold: number;
    if (age <= 14) threshold = 20;
    else if (age >= 60) threshold = 50;
    else threshold = 20 + ((age - 14) / (60 - 14)) * 30;

    let status = 'normal';
    if (r.change_pct != null && r.change_pct > threshold) {
      status = r.change_pct > threshold * 2 ? 'critical' : 'elevated';
    }

    return {
      account_google_id: r.account_google_id,
      display_name: r.display_name,
      latest_spend: r.latest_spend,
      change_pct: r.change_pct,
      threshold: Math.round(threshold),
      account_age_days: age,
      currency: r.currency ?? 'USD',
      status,
    };
  });

  await reply.status(200).send({ accounts });
}

/**
 * GET /analytics/ban-chain?account_google_id=XXX — KF-4: Ban Chain Prediction
 */
export async function banChainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_google_id } = request.query as { account_google_id?: string };

  if (!account_google_id) {
    await reply.status(400).send({ error: 'account_google_id query param required', code: 'VALIDATION_ERROR' });
    return;
  }

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, account_google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  interface Connection {
    connected_account: string;
    display_name: string | null;
    link_type: string;
    link_value: string;
    weight: number;
    is_banned: boolean;
    banned_at: string | null;
  }

  const connections: Connection[] = [];

  const [domainRows, binRows, proxyRows, profileRows] = await Promise.all([
    analyticsRepo.getDomainConnections(pool, account_google_id),
    analyticsRepo.getBinConnections(pool, account_google_id),
    analyticsRepo.getProxyConnections(pool, account_google_id),
    analyticsRepo.getProfileConnections(pool, account_google_id),
  ]);

  const mapRows = (rows: analyticsRepo.ConnectionRow[], linkType: string, weight: number) => {
    for (const row of rows) {
      connections.push({
        connected_account: row.account_google_id,
        display_name: row.display_name,
        link_type: linkType,
        link_value: row.link_value,
        weight,
        is_banned: row.banned_at != null,
        banned_at: row.banned_at,
      });
    }
  };

  mapRows(domainRows, 'domain', 0.9);
  mapRows(binRows, 'bin', 0.6);
  mapRows(proxyRows, 'proxy', 0.3);
  mapRows(profileRows, 'antidetect_profile', 0.2);

  // Deduplicate by connected_account, keeping highest weight
  const bestMap = new Map<string, Connection>();
  for (const conn of connections) {
    const existing = bestMap.get(conn.connected_account);
    if (!existing || conn.weight > existing.weight) {
      bestMap.set(conn.connected_account, conn);
    }
  }
  const uniqueConnections = Array.from(bestMap.values());

  // Calculate chain risk
  const bannedWeightSum = uniqueConnections
    .filter(c => c.is_banned)
    .reduce((sum, c) => sum + c.weight, 0);

  const chainRiskScore = Math.min(bannedWeightSum, 1);
  const riskLevel = chainRiskScore >= 0.7 ? 'critical' : chainRiskScore >= 0.3 ? 'elevated' : 'low';

  await reply.status(200).send({
    account_google_id,
    connections: uniqueConnections,
    all_connections: connections,
    chain_risk_score: Math.round(chainRiskScore * 100) / 100,
    risk_level: riskLevel,
  });
}

/**
 * GET /analytics/ban-chain-all — KF-4: All account connections summary.
 */
export async function banChainAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const sharedDomains = await analyticsRepo.getSharedDomains(pool, userId);

  await reply.status(200).send({ shared_domains: sharedDomains });
}

/**
 * GET /analytics/consumable-scoring — KF-7: Consumable Scoring
 */
export async function consumableScoringHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const scoring = await analyticsRepo.getConsumableScoring(pool, userId);

  const scoreItem = (banRate: number | null) => {
    if (banRate == null) return 'unknown';
    if (banRate > 60) return 'bad';
    if (banRate > 30) return 'medium';
    return 'good';
  };

  await reply.status(200).send({
    bins: scoring.bins.map(r => ({ ...r, score: scoreItem(r.ban_rate) })),
    domains: scoring.domains.map(r => ({
      ...r,
      safe_page_score: r.safe_page_quality_score,
      score: scoreItem(r.ban_rate),
    })),
    proxies: scoring.proxies.map(r => ({ ...r, score: scoreItem(r.ban_rate) })),
  });
}

/**
 * GET /analytics/creative-decay?account_google_id=XXX — KF-2: Creative Decay Detection
 */
export async function creativeDecayHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_google_id } = request.query as { account_google_id?: string };

  // Verify buyer owns this account (if specified)
  const userId = getUserIdFilter(request);
  if (userId && account_google_id) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, account_google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const rows = await analyticsRepo.getCampaignDailyMetrics(pool, account_google_id, userId);

  // Group by campaign
  const campaignMap = new Map<string, {
    campaign_id: string;
    campaign_name: string;
    account_google_id: string;
    days: Array<{ date: string; ctr: number | null; cpc: number | null }>;
  }>();

  for (const row of rows) {
    if (!campaignMap.has(row.campaign_id)) {
      campaignMap.set(row.campaign_id, {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        account_google_id: row.account_google_id,
        days: [],
      });
    }
    campaignMap.get(row.campaign_id)!.days.push({
      date: row.date,
      ctr: row.ctr,
      cpc: row.cpc,
    });
  }

  const LEARNING_DAYS = 14;
  const BASELINE_DAYS = 7;
  const DECAY_THRESHOLD = -15;
  const CONSECUTIVE_DAYS = 3;

  interface CampaignDecay {
    campaign_id: string;
    campaign_name: string;
    account_google_id: string;
    baseline_ctr: number | null;
    baseline_cpc: number | null;
    current_ctr: number | null;
    current_cpc: number | null;
    ctr_change_pct: number | null;
    decay_detected: boolean;
    decay_started_at: string | null;
    days_in_decay: number;
  }

  const campaigns: CampaignDecay[] = [];

  for (const [, data] of campaignMap) {
    const { days } = data;
    if (days.length < LEARNING_DAYS + BASELINE_DAYS) {
      const lastDay = days[days.length - 1];
      campaigns.push({
        campaign_id: data.campaign_id,
        campaign_name: data.campaign_name,
        account_google_id: data.account_google_id,
        baseline_ctr: null,
        baseline_cpc: null,
        current_ctr: lastDay?.ctr ?? null,
        current_cpc: lastDay?.cpc ?? null,
        ctr_change_pct: null,
        decay_detected: false,
        decay_started_at: null,
        days_in_decay: 0,
      });
      continue;
    }

    const baselineSlice = days.slice(LEARNING_DAYS, LEARNING_DAYS + BASELINE_DAYS);
    const baselineCtrs = baselineSlice.map(d => d.ctr).filter((v): v is number => v != null);
    const baselineCpcs = baselineSlice.map(d => d.cpc).filter((v): v is number => v != null);

    const baselineCtr = baselineCtrs.length > 0 ? baselineCtrs.reduce((a, b) => a + b, 0) / baselineCtrs.length : null;
    const baselineCpc = baselineCpcs.length > 0 ? baselineCpcs.reduce((a, b) => a + b, 0) / baselineCpcs.length : null;

    const postBaseline = days.slice(LEARNING_DAYS + BASELINE_DAYS);
    let consecutiveDecayDays = 0;
    let decayStartDate: string | null = null;
    let maxConsecutive = 0;
    let decayStart: string | null = null;

    for (const day of postBaseline) {
      if (baselineCtr != null && day.ctr != null && baselineCtr > 0) {
        const deviation = ((day.ctr - baselineCtr) / baselineCtr) * 100;
        if (deviation < DECAY_THRESHOLD) {
          consecutiveDecayDays++;
          if (consecutiveDecayDays === 1) decayStartDate = day.date;
          if (consecutiveDecayDays > maxConsecutive) {
            maxConsecutive = consecutiveDecayDays;
            decayStart = decayStartDate;
          }
        } else {
          consecutiveDecayDays = 0;
          decayStartDate = null;
        }
      }
    }

    const lastDay = days[days.length - 1];
    const currentCtr = lastDay?.ctr ?? null;
    const currentCpc = lastDay?.cpc ?? null;
    const ctrChangePct = baselineCtr != null && currentCtr != null && baselineCtr > 0
      ? Math.round(((currentCtr - baselineCtr) / baselineCtr) * 1000) / 10
      : null;

    campaigns.push({
      campaign_id: data.campaign_id,
      campaign_name: data.campaign_name,
      account_google_id: data.account_google_id,
      baseline_ctr: baselineCtr != null ? Math.round(baselineCtr * 10000) / 10000 : null,
      baseline_cpc: baselineCpc != null ? Math.round(baselineCpc * 100) / 100 : null,
      current_ctr: currentCtr != null ? Math.round(currentCtr * 10000) / 10000 : null,
      current_cpc: currentCpc != null ? Math.round(currentCpc * 100) / 100 : null,
      ctr_change_pct: ctrChangePct,
      decay_detected: maxConsecutive >= CONSECUTIVE_DAYS,
      decay_started_at: maxConsecutive >= CONSECUTIVE_DAYS ? decayStart : null,
      days_in_decay: maxConsecutive >= CONSECUTIVE_DAYS ? maxConsecutive : 0,
    });
  }

  await reply.status(200).send({ campaigns });
}

/**
 * POST /analytics/post-mortem/:ban_id — KF-8: Generate Post-Mortem
 */
export async function postMortemHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { ban_id } = request.params as { ban_id: string };

  // Verify buyer owns the ban's account
  const userId = getUserIdFilter(request);
  if (userId) {
    const banResult = await pool.query(
      `SELECT 1 FROM ban_logs bl
       JOIN accounts a ON a.google_account_id = bl.account_google_id
       WHERE bl.id = $1 AND a.user_id = $2`,
      [ban_id, userId],
    );
    if (banResult.rowCount === 0) {
      await reply.status(404).send({ error: 'Ban log not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const result = await generatePostMortem(pool, ban_id);

  if (!result) {
    await reply.status(404).send({ error: 'Ban log not found', code: 'NOT_FOUND' });
    return;
  }

  await reply.status(200).send(result);
}

/**
 * POST /analytics/post-mortem-all — KF-8: Generate Post-Mortem for all bans without one.
 */
export async function postMortemAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const banIds = await analyticsRepo.getBanIdsWithoutPostMortem(pool, 50, userId);

  let generated = 0;
  let failed = 0;
  const errors: Array<{ ban_id: string; error: string }> = [];

  for (const banId of banIds) {
    try {
      await generatePostMortem(pool, banId);
      generated++;
    } catch (err) {
      failed++;
      errors.push({
        ban_id: banId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await reply.status(200).send({
    total_pending: banIds.length,
    generated,
    failed,
    errors,
  });
}

/**
 * GET /analytics/competitive-intelligence — KF-1: Competitive Intelligence
 */
export async function competitiveIntelligenceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  const rows = await timed('competitive-intelligence', () => analyticsRepo.getCompetitiveIntelligence(pool, userId));

  const competitors = rows.map((r) => ({
    ...r,
    is_long_lived: r.longevity_days > 7,
  }));

  const byOverlap = [...competitors].sort((a, b) => b.avg_overlap_rate - a.avg_overlap_rate);
  const byShare = [...competitors].sort((a, b) => b.avg_impression_share - a.avg_impression_share);
  const byLongevity = [...competitors].sort((a, b) => b.longevity_days - a.longevity_days);

  await reply.status(200).send({
    total_competitors: competitors.length,
    competitors,
    insights: {
      most_aggressive: byOverlap[0]?.domain ?? null,
      highest_impression_share: byShare[0]?.domain ?? null,
      longest_lived: byLongevity[0]?.domain ?? null,
    },
  });
}

/**
 * GET /accounts/:google_id/competitive-intelligence — per-account competitors
 * Note: ownership check done via accounts route preHandler pattern
 */
export async function accountCompetitiveIntelligenceHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { google_id } = request.params as { google_id: string };

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const competitors = await analyticsRepo.getAccountCompetitors(pool, google_id);
  await reply.status(200).send({ competitors });
}

export async function mvFreshnessHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const result = await pool.query(
      `SELECT MAX(last_autoanalyze) AS last_refreshed_at
       FROM pg_stat_user_tables
       WHERE relname LIKE 'mv_%'`,
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    await reply.status(200).send({ last_refreshed_at: row?.['last_refreshed_at'] ?? null });
  } catch {
    await reply.status(200).send({ last_refreshed_at: null });
  }
}

export async function accountRiskSummaryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const userId = getUserIdFilter(request);
  try {
    // When userId present, filter MV results to user's accounts
    const userFilter = userId
      ? `WHERE account_google_id IN (SELECT google_account_id FROM accounts WHERE user_id = $1)`
      : '';
    const params = userId ? [userId] : [];
    const result = await pool.query(
      `SELECT * FROM mv_account_risk_summary ${userFilter} ORDER BY risk_score DESC LIMIT 100`,
      params,
    );
    const accounts = result.rows.map(r => ({
      account_id: r['account_id'] as string,
      account_google_id: r['account_google_id'] as string,
      display_name: r['display_name'] as string | null,
      days_active: Number(r['days_active'] ?? 0),
      total_spend: Number(r['total_spend'] ?? 0),
      daily_velocity: Number(r['daily_velocity'] ?? 0),
      policy_violations: Number(r['policy_violations'] ?? 0),
      ban_count: Number(r['ban_count'] ?? 0),
      campaign_count: Number(r['campaign_count'] ?? 0),
      risk_score: Number(r['risk_score'] ?? 0),
    }));
    await reply.status(200).send({ accounts });
  } catch (err: unknown) {
    // MV may not exist yet
    request.log.warn({ err }, 'mv_account_risk_summary query failed, returning empty');
    await reply.status(200).send({ accounts: [] });
  }
}

/**
 * POST /analytics/creative-decay/scan — Force a creative decay scan (admin only).
 * Snapshots current metrics, detects decay, sends notifications.
 */
export async function creativeDecayScanHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  // Step 1: Take snapshots
  const snapshot = await creativeDecayService.snapshotCreativePerformance(pool);
  request.log.info(`[creative-decay] Snapshot: ${snapshot.snapshotted} campaigns`);

  // Step 2: Detect decay and send alerts
  const scan = await creativeDecayService.runDecayScanWithAlerts(pool);

  await reply.status(200).send({
    snapshotted: snapshot.snapshotted,
    scanned: scan.scanned,
    decayed: scan.decayed,
    critical: scan.critical,
    results: scan.results,
  });
}

/**
 * GET /analytics/creative-decay/trends?account_google_id=XXX — CTR trends for sparklines.
 */
export async function creativeDecayTrendsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { account_google_id, days } = request.query as { account_google_id?: string; days?: string };

  if (!account_google_id) {
    await reply.status(400).send({ error: 'account_google_id is required', code: 'MISSING_PARAM' });
    return;
  }

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, account_google_id, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
      return;
    }
  }

  const trends = await creativeDecayService.getDecayTrends(pool, account_google_id, days ? parseInt(days, 10) : 30);
  await reply.status(200).send({ trends });
}

/**
 * GET /analytics/ban-chain-graph — Returns nodes + edges for interactive graph visualization.
 * Nodes = accounts, Edges = shared domains / BINs / proxies.
 */
export async function banChainGraphHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  const accountsRes = await pool.query(`
    SELECT
      a.google_account_id,
      a.display_name,
      a.status::text,
      (SELECT COUNT(*)::int FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS ban_count,
      (SELECT MAX(bl.banned_at) FROM ban_logs bl WHERE bl.account_google_id = a.google_account_id) AS last_ban_at
    FROM accounts a
    WHERE a.google_account_id ~ '^\\d{7,13}$'
    ORDER BY a.updated_at DESC
    LIMIT 300
  `);

  interface GNode { id: string; google_account_id: string; display_name: string | null; status: string; ban_count: number; last_ban_at: string | null }
  interface GEdge { source: string; target: string; type: string; label: string }

  const nodes: GNode[] = (accountsRes.rows as Array<Record<string, unknown>>).map(r => ({
    id: r.google_account_id as string,
    google_account_id: r.google_account_id as string,
    display_name: r.display_name as string | null,
    status: r.status as string,
    ban_count: r.ban_count as number,
    last_ban_at: r.last_ban_at as string | null,
  }));

  const accountIds = nodes.map(n => n.google_account_id);
  if (accountIds.length === 0) {
    await reply.send({ nodes: [], edges: [] });
    return;
  }

  const edges: GEdge[] = [];

  // Shared domains (ban_logs)
  const domRes = await pool.query(`
    SELECT b1.account_google_id AS src, b2.account_google_id AS tgt, b1.domain
    FROM ban_logs b1
    JOIN ban_logs b2 ON b1.domain = b2.domain AND b1.account_google_id < b2.account_google_id
    WHERE b1.domain IS NOT NULL AND b1.domain != ''
      AND b1.account_google_id = ANY($1) AND b2.account_google_id = ANY($1)
    GROUP BY b1.account_google_id, b2.account_google_id, b1.domain
  `, [accountIds]);
  for (const r of domRes.rows as Array<Record<string, string>>) {
    edges.push({ source: r.src, target: r.tgt, type: 'domain', label: r.domain });
  }

  // Shared domains (ads.final_urls)
  const adDomRes = await pool.query(`
    WITH ad AS (
      SELECT DISTINCT a.account_google_id,
        SPLIT_PART(CASE WHEN url LIKE 'http://%' OR url LIKE 'https://%'
          THEN SUBSTR(url, POSITION('://' IN url) + 3) ELSE url END, '/', 1) AS domain
      FROM ads a,
      LATERAL (SELECT jsonb_array_elements_text(a.final_urls) AS url
               WHERE a.final_urls IS NOT NULL AND jsonb_typeof(a.final_urls) = 'array') u
      WHERE a.account_google_id = ANY($1)
    )
    SELECT d1.account_google_id AS src, d2.account_google_id AS tgt, d1.domain
    FROM ad d1 JOIN ad d2 ON d1.domain = d2.domain AND d1.account_google_id < d2.account_google_id
    WHERE d1.domain IS NOT NULL AND d1.domain != ''
  `, [accountIds]);
  const domSet = new Set(edges.map(e => `${e.source}|${e.target}|${e.label}`));
  for (const r of adDomRes.rows as Array<Record<string, string>>) {
    const key = `${r.src}|${r.tgt}|${r.domain}`;
    if (!domSet.has(key)) { edges.push({ source: r.src, target: r.tgt, type: 'domain', label: r.domain }); domSet.add(key); }
  }

  // Shared BIN
  const binRes = await pool.query(`
    SELECT a1.google_account_id AS src, a2.google_account_id AS tgt, a1.payment_bin AS bin
    FROM accounts a1 JOIN accounts a2 ON a1.payment_bin = a2.payment_bin AND a1.google_account_id < a2.google_account_id
    WHERE a1.payment_bin IS NOT NULL AND a1.payment_bin != ''
      AND a1.google_account_id = ANY($1) AND a2.google_account_id = ANY($1)
  `, [accountIds]);
  for (const r of binRes.rows as Array<Record<string, string>>) {
    edges.push({ source: r.src, target: r.tgt, type: 'bin', label: r.bin });
  }

  // Shared proxy
  const proxyRes = await pool.query(`
    SELECT a1.google_account_id AS src, a2.google_account_id AS tgt,
           COALESCE(p.ip_address, p.provider || '/' || p.geo, p.id::text) AS proxy_label
    FROM account_consumables ac1
    JOIN account_consumables ac2 ON ac1.proxy_id = ac2.proxy_id AND ac1.account_id < ac2.account_id
    JOIN accounts a1 ON a1.id = ac1.account_id
    JOIN accounts a2 ON a2.id = ac2.account_id
    JOIN proxies p ON p.id = ac1.proxy_id
    WHERE ac1.proxy_id IS NOT NULL AND ac1.unlinked_at IS NULL AND ac2.unlinked_at IS NULL
      AND a1.google_account_id = ANY($1) AND a2.google_account_id = ANY($1)
    GROUP BY a1.google_account_id, a2.google_account_id, proxy_label
  `, [accountIds]);
  for (const r of proxyRes.rows as Array<Record<string, string>>) {
    edges.push({ source: r.src, target: r.tgt, type: 'proxy', label: r.proxy_label });
  }

  // Only return connected nodes
  const connected = new Set<string>();
  for (const e of edges) { connected.add(e.source); connected.add(e.target); }

  await reply.send({ nodes: nodes.filter(n => connected.has(n.id)), edges });
}
