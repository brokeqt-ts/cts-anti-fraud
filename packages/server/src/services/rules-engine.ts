/**
 * Expert Rules Engine (§8.1) — configurable rules for pre-launch risk assessment.
 *
 * Each rule evaluates a condition against the assessment context and produces
 * a severity + message in Russian.
 */

export interface AssessmentContext {
  domain?: string;
  domainAgeDays?: number | null;
  domainSafePageScore?: number | null;
  accountGoogleId?: string;
  accountAgeDays?: number | null;
  accountHasActiveViolations?: boolean;
  bin?: string;
  binBanRate?: number | null;
  vertical?: string;
  geo?: string;
  verticalBanRate?: number | null;
  geoBanRate?: number | null;
}

export interface Rule {
  id: string;
  name: string;
  category: 'bin' | 'domain' | 'geo' | 'vertical' | 'spend' | 'account';
  condition: (ctx: AssessmentContext) => boolean;
  severity: 'block' | 'warning' | 'info';
  messageRu: (ctx: AssessmentContext) => string;
}

// ─── Minimum domain age by vertical ────────────────────────────────────────

const MIN_DOMAIN_AGE_BY_VERTICAL: Record<string, number> = {
  nutra: 14,
  gambling: 30,
  finance: 30,
  crypto: 30,
  dating: 14,
  sweepstakes: 14,
  ecom: 7,
  other: 7,
};

// ─── Max recommended daily budget by account age ───────────────────────────

const MAX_BUDGET_BY_ACCOUNT_AGE: Array<{ maxAgeDays: number; maxBudget: number }> = [
  { maxAgeDays: 7, maxBudget: 30 },
  { maxAgeDays: 30, maxBudget: 100 },
];

// ─── Known risky BIN ranges ────────────────────────────────────────────────

const RISKY_BIN_PREFIXES = [
  '404038', // Virtual cards — high ban rate
  '431274', // Prepaid — high ban rate
  '516732', // Virtual/prepaid
  '539860', // Prepaid
  '555555', // Test/virtual
];

// ─── High-risk geo × vertical combinations ─────────────────────────────────

const HIGH_RISK_GEO_VERTICALS: Array<{ geo: string; vertical: string }> = [
  { geo: 'IN', vertical: 'nutra' },
  { geo: 'PK', vertical: 'nutra' },
  { geo: 'BD', vertical: 'nutra' },
  { geo: 'NG', vertical: 'gambling' },
  { geo: 'PH', vertical: 'gambling' },
];

// ─── Rule Definitions ──────────────────────────────────────────────────────

const RULES: Rule[] = [
  // ── BIN rules ──
  {
    id: 'bin_risky_prefix',
    name: 'Risky BIN prefix',
    category: 'bin',
    condition: (ctx) => {
      if (!ctx.bin) return false;
      return RISKY_BIN_PREFIXES.some(p => ctx.bin!.startsWith(p));
    },
    severity: 'warning',
    messageRu: (ctx) => `BIN ${ctx.bin ?? ''} входит в список рискованных (виртуальные/предоплаченные карты)`,
  },
  {
    id: 'bin_high_ban_rate',
    name: 'BIN with high ban rate',
    category: 'bin',
    condition: (ctx) => ctx.binBanRate != null && ctx.binBanRate > 50,
    severity: 'warning',
    messageRu: (ctx) => `BIN ${ctx.bin ?? ''} имеет процент банов ${ctx.binBanRate?.toFixed(0) ?? '?'}% — рассмотрите альтернативу`,
  },
  {
    id: 'bin_critical_ban_rate',
    name: 'BIN with critical ban rate',
    category: 'bin',
    condition: (ctx) => ctx.binBanRate != null && ctx.binBanRate > 80,
    severity: 'block',
    messageRu: (ctx) => `BIN ${ctx.bin ?? ''} имеет критический процент банов (${ctx.binBanRate?.toFixed(0) ?? '?'}%) — НЕ ИСПОЛЬЗОВАТЬ`,
  },

  // ── Domain rules ──
  {
    id: 'domain_too_young',
    name: 'Domain below minimum age for vertical',
    category: 'domain',
    condition: (ctx) => {
      if (ctx.domainAgeDays == null) return false;
      const vertical = ctx.vertical ?? 'other';
      const minAge = MIN_DOMAIN_AGE_BY_VERTICAL[vertical] ?? 7;
      return ctx.domainAgeDays < minAge;
    },
    severity: 'warning',
    messageRu: (ctx) => {
      const vertical = ctx.vertical ?? 'other';
      const minAge = MIN_DOMAIN_AGE_BY_VERTICAL[vertical] ?? 7;
      return `Домен слишком молодой (${ctx.domainAgeDays ?? 0} дн.) — рекомендуется минимум ${minAge} дней для вертикали ${vertical}`;
    },
  },
  {
    id: 'domain_no_age',
    name: 'Domain age unknown',
    category: 'domain',
    condition: (ctx) => ctx.domain != null && ctx.domainAgeDays == null,
    severity: 'info',
    messageRu: () => 'Возраст домена неизвестен — рекомендуется проверить вручную',
  },
  {
    id: 'domain_low_safe_score',
    name: 'Low safe page score',
    category: 'domain',
    condition: (ctx) => ctx.domainSafePageScore != null && ctx.domainSafePageScore < 40,
    severity: 'warning',
    messageRu: (ctx) => `Низкий Safe Page Score домена (${ctx.domainSafePageScore ?? 0}/100) — высокий риск бана`,
  },
  {
    id: 'domain_critical_safe_score',
    name: 'Critical safe page score',
    category: 'domain',
    condition: (ctx) => ctx.domainSafePageScore != null && ctx.domainSafePageScore < 20,
    severity: 'block',
    messageRu: (ctx) => `Критически низкий Safe Page Score (${ctx.domainSafePageScore ?? 0}/100) — запуск не рекомендуется`,
  },

  // ── Spend rules ──
  {
    id: 'spend_new_account_budget',
    name: 'Budget recommendation for new accounts',
    category: 'spend',
    condition: (ctx) => ctx.accountAgeDays != null && ctx.accountAgeDays < 7,
    severity: 'info',
    messageRu: () => 'Рекомендуемый начальный бюджет: не более $30/день (аккаунт моложе 7 дней)',
  },
  {
    id: 'spend_medium_account_budget',
    name: 'Budget recommendation for medium accounts',
    category: 'spend',
    condition: (ctx) => ctx.accountAgeDays != null && ctx.accountAgeDays >= 7 && ctx.accountAgeDays < 30,
    severity: 'info',
    messageRu: () => 'Рекомендуемый бюджет: не более $100/день (аккаунт от 7 до 30 дней)',
  },

  // ── Geo rules ──
  {
    id: 'geo_high_risk_combo',
    name: 'High-risk geo+vertical combination',
    category: 'geo',
    condition: (ctx) => {
      if (!ctx.geo || !ctx.vertical) return false;
      return HIGH_RISK_GEO_VERTICALS.some(
        r => r.geo === ctx.geo && r.vertical === ctx.vertical,
      );
    },
    severity: 'warning',
    messageRu: (ctx) => `Комбинация ${ctx.geo ?? ''} + ${ctx.vertical ?? ''} имеет повышенный риск бана`,
  },
  {
    id: 'geo_high_ban_rate',
    name: 'Geo with high ban rate',
    category: 'geo',
    condition: (ctx) => ctx.geoBanRate != null && ctx.geoBanRate > 40,
    severity: 'warning',
    messageRu: (ctx) => `Гео ${ctx.geo ?? ''} имеет процент банов ${ctx.geoBanRate?.toFixed(0) ?? '?'}%`,
  },

  // ── Account rules ──
  {
    id: 'account_active_violations',
    name: 'Account has active policy violations',
    category: 'account',
    condition: (ctx) => ctx.accountHasActiveViolations === true,
    severity: 'block',
    messageRu: () => 'Аккаунт имеет активные нарушения политики — запуск заблокирован',
  },
  {
    id: 'account_very_new',
    name: 'Very new account',
    category: 'account',
    condition: (ctx) => ctx.accountAgeDays != null && ctx.accountAgeDays < 3,
    severity: 'warning',
    messageRu: (ctx) => `Аккаунт очень молодой (${ctx.accountAgeDays ?? 0} дн.) — высокий риск мгновенного бана`,
  },

  // ── Vertical rules ──
  {
    id: 'vertical_high_ban_rate',
    name: 'Vertical with high ban rate',
    category: 'vertical',
    condition: (ctx) => ctx.verticalBanRate != null && ctx.verticalBanRate > 50,
    severity: 'warning',
    messageRu: (ctx) => `Вертикаль ${ctx.vertical ?? ''} имеет процент банов ${ctx.verticalBanRate?.toFixed(0) ?? '?'}% — будьте осторожны`,
  },
];

// ─── Engine ────────────────────────────────────────────────────────────────

export interface RuleResult {
  ruleId: string;
  name: string;
  category: string;
  severity: 'block' | 'warning' | 'info';
  message: string;
}

export function evaluateRules(ctx: AssessmentContext): RuleResult[] {
  const results: RuleResult[] = [];

  for (const rule of RULES) {
    if (rule.condition(ctx)) {
      results.push({
        ruleId: rule.id,
        name: rule.name,
        category: rule.category,
        severity: rule.severity,
        message: rule.messageRu(ctx),
      });
    }
  }

  return results;
}

export function getBudgetRecommendation(accountAgeDays: number | null): number | null {
  if (accountAgeDays == null) return null;
  for (const tier of MAX_BUDGET_BY_ACCOUNT_AGE) {
    if (accountAgeDays < tier.maxAgeDays) return tier.maxBudget;
  }
  return null; // No limit for aged accounts
}
