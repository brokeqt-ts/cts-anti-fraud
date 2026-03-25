import type pg from 'pg';
import * as assessmentRepo from '../repositories/assessment.repository.js';
import { evaluateRules, getBudgetRecommendation, type AssessmentContext, type RuleResult } from './rules-engine.js';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface AssessmentRequest {
  domain?: string;
  account_google_id?: string;
  bin?: string;
  vertical?: string;
  geo?: string;
}

export interface AssessmentFactor {
  category: string;
  score: number;
  weight: number;
  detail: string;
}

export interface AssessmentResult {
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  factors: AssessmentFactor[];
  recommendations: string[];
  comparable_accounts: {
    total: number;
    banned: number;
    ban_rate: number;
    avg_lifetime_days: number;
  };
  budget_recommendation: number | null;
}

// ─── Weight config ──────────────────────────────────────────────────────────

const WEIGHTS = {
  domain: 0.25,
  bin: 0.20,
  account: 0.15,
  vertical: 0.20,
  geo: 0.20,
} as const;

// ─── Score helpers ──────────────────────────────────────────────────────────

function domainScore(
  domainAgeDays: number | null,
  safePageScore: number | null,
  vertical: string,
): number {
  // 0 = safe, 100 = maximum risk
  let score = 0;

  if (domainAgeDays == null) {
    score += 50; // unknown = moderate risk
  } else if (domainAgeDays < 7) {
    score += 80;
  } else if (domainAgeDays < 14) {
    score += 50;
  } else if (domainAgeDays < 30) {
    score += 20;
  }

  if (safePageScore != null) {
    // Invert: low safe score = high risk
    score += Math.round((100 - safePageScore) * 0.5);
  } else {
    score += 25; // unknown
  }

  // High-risk verticals get a domain age penalty
  if (['gambling', 'crypto', 'finance'].includes(vertical) && domainAgeDays != null && domainAgeDays < 30) {
    score += 20;
  }

  return Math.min(score, 100);
}

function binScore(banRate: number): number {
  // Direct mapping: ban rate percentage → risk score
  return Math.min(Math.round(banRate), 100);
}

function accountScore(
  accountAgeDays: number | null,
  hasActiveViolations: boolean,
): number {
  let score = 0;

  if (hasActiveViolations) {
    return 100; // Instant critical
  }

  if (accountAgeDays == null) {
    score += 40;
  } else if (accountAgeDays < 3) {
    score += 80;
  } else if (accountAgeDays < 7) {
    score += 50;
  } else if (accountAgeDays < 30) {
    score += 20;
  }

  return Math.min(score, 100);
}

function verticalScore(banRate: number): number {
  return Math.min(Math.round(banRate * 1.5), 100);
}

function geoScore(banRate: number): number {
  return Math.min(Math.round(banRate * 1.5), 100);
}

function riskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

// ─── Main assessment ────────────────────────────────────────────────────────

export async function assess(pool: pg.Pool, req: AssessmentRequest): Promise<AssessmentResult> {
  // 1. Gather data in parallel
  const [domainInfo, accountInfo, binStats, verticalStats, geoStats, comparable] = await Promise.all([
    req.domain ? assessmentRepo.getDomainInfo(pool, req.domain) : Promise.resolve(null),
    req.account_google_id ? assessmentRepo.getAccountInfo(pool, req.account_google_id) : Promise.resolve(null),
    req.bin ? assessmentRepo.getBinStats(pool, req.bin) : Promise.resolve(null),
    req.vertical ? assessmentRepo.getVerticalStats(pool, req.vertical) : Promise.resolve(null),
    req.geo ? assessmentRepo.getGeoStats(pool, req.geo) : Promise.resolve(null),
    assessmentRepo.getComparableAccounts(pool, {
      domain: req.domain,
      vertical: req.vertical,
      bin: req.bin,
    }),
  ]);

  // 2. Compute per-category scores
  const factors: AssessmentFactor[] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  if (req.domain) {
    const s = domainScore(
      domainInfo?.domainAgeDays ?? null,
      domainInfo?.safePageQualityScore ?? null,
      req.vertical ?? 'other',
    );
    factors.push({
      category: 'domain',
      score: s,
      weight: WEIGHTS.domain,
      detail: domainInfo
        ? `Возраст: ${domainInfo.domainAgeDays ?? '?'} дн., Safe Score: ${domainInfo.safePageQualityScore ?? '?'}/100`
        : 'Домен не найден в базе',
    });
    weightedSum += s * WEIGHTS.domain;
    totalWeight += WEIGHTS.domain;
  }

  if (req.bin) {
    const s = binScore(binStats?.banRate ?? 0);
    factors.push({
      category: 'bin',
      score: s,
      weight: WEIGHTS.bin,
      detail: binStats
        ? `Всего аккаунтов: ${binStats.total}, забанено: ${binStats.banned} (${binStats.banRate}%), среднее время жизни: ${binStats.avgLifetimeHours} ч.`
        : 'BIN не найден в базе',
    });
    weightedSum += s * WEIGHTS.bin;
    totalWeight += WEIGHTS.bin;
  }

  if (req.account_google_id) {
    const s = accountScore(
      accountInfo?.accountAgeDays ?? null,
      accountInfo?.hasActiveViolations ?? false,
    );
    factors.push({
      category: 'account',
      score: s,
      weight: WEIGHTS.account,
      detail: accountInfo
        ? `Возраст: ${accountInfo.accountAgeDays ?? '?'} дн., нарушения: ${accountInfo.hasActiveViolations ? 'да' : 'нет'}`
        : 'Аккаунт не найден в базе',
    });
    weightedSum += s * WEIGHTS.account;
    totalWeight += WEIGHTS.account;
  }

  if (req.vertical) {
    const s = verticalScore(verticalStats?.banRate ?? 0);
    factors.push({
      category: 'vertical',
      score: s,
      weight: WEIGHTS.vertical,
      detail: verticalStats
        ? `Баны: ${verticalStats.banCount}/${verticalStats.totalAccounts} (${verticalStats.banRate}%), среднее время жизни: ${verticalStats.avgLifetimeHours} ч.`
        : 'Нет данных по вертикали',
    });
    weightedSum += s * WEIGHTS.vertical;
    totalWeight += WEIGHTS.vertical;
  }

  if (req.geo) {
    const s = geoScore(geoStats?.banRate ?? 0);
    factors.push({
      category: 'geo',
      score: s,
      weight: WEIGHTS.geo,
      detail: geoStats
        ? `Баны: ${geoStats.banCount}/${geoStats.totalAccounts} (${geoStats.banRate}%)`
        : 'Нет данных по гео',
    });
    weightedSum += s * WEIGHTS.geo;
    totalWeight += WEIGHTS.geo;
  }

  // 3. Compute weighted risk score (normalize if not all factors present)
  const riskScore = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : 0;

  // 4. Run expert rules engine
  const rulesCtx: AssessmentContext = {
    domain: req.domain,
    domainAgeDays: domainInfo?.domainAgeDays ?? null,
    domainSafePageScore: domainInfo?.safePageQualityScore ?? null,
    accountGoogleId: req.account_google_id,
    accountAgeDays: accountInfo?.accountAgeDays ?? null,
    accountHasActiveViolations: accountInfo?.hasActiveViolations ?? false,
    bin: req.bin,
    binBanRate: binStats?.banRate ?? null,
    vertical: req.vertical,
    geo: req.geo,
    verticalBanRate: verticalStats?.banRate ?? null,
    geoBanRate: geoStats?.banRate ?? null,
  };

  const ruleResults = evaluateRules(rulesCtx);

  // If any rule has severity 'block', bump score to at least 80
  const hasBlocker = ruleResults.some(r => r.severity === 'block');
  const finalScore = hasBlocker ? Math.max(riskScore, 80) : riskScore;

  // 5. Build recommendations from rule messages
  const recommendations = buildRecommendations(ruleResults, rulesCtx);

  // 6. Budget recommendation
  const budgetRec = getBudgetRecommendation(accountInfo?.accountAgeDays ?? null);

  // 7. Comparable accounts stats
  const comparableBanRate = comparable.total > 0
    ? Math.round((comparable.banned / comparable.total) * 1000) / 10
    : 0;

  return {
    risk_score: finalScore,
    risk_level: riskLevel(finalScore),
    factors,
    recommendations,
    comparable_accounts: {
      total: comparable.total,
      banned: comparable.banned,
      ban_rate: comparableBanRate,
      avg_lifetime_days: comparable.avgLifetimeDays,
    },
    budget_recommendation: budgetRec,
  };
}

// ─── Recommendation builder ─────────────────────────────────────────────────

function buildRecommendations(rules: RuleResult[], ctx: AssessmentContext): string[] {
  const recs: string[] = [];

  // Add all rule messages as recommendations, ordered by severity
  const severityOrder = { block: 0, warning: 1, info: 2 };
  const sorted = [...rules].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  for (const r of sorted) {
    const prefix = r.severity === 'block' ? '🚫 ' : r.severity === 'warning' ? '⚠️ ' : 'ℹ️ ';
    recs.push(`${prefix}${r.message}`);
  }

  // If no domain provided but everything else is fine, suggest adding one
  if (!ctx.domain && rules.length === 0) {
    recs.push('ℹ️ Добавьте домен для более точной оценки рисков');
  }

  // If no rules triggered and we have data, good news
  if (rules.length === 0 && (ctx.domain || ctx.bin || ctx.accountGoogleId)) {
    recs.push('✅ Серьёзных рисков не обнаружено');
  }

  return recs;
}
