/**
 * Expert Rules Engine v2 — DB-backed configurable rules.
 *
 * Rules are loaded from the `expert_rules` table and cached for 5 minutes.
 * Supports simple conditions, compound AND/OR logic, and message templates
 * with {variable} substitution.
 *
 * Backward-compatible with rules-engine.ts: same AssessmentContext + RuleResult types.
 */

import type pg from 'pg';
import type { AssessmentContext, RuleResult } from './rules-engine.js';

// ─── DB types ────────────────────────────────────────────────────────────────

type Operator = '>' | '<' | '>=' | '<=' | '==' | '!=' | 'in' | 'not_in' | 'contains' | 'regex' | 'starts_with_any';
type Severity = 'block' | 'warning' | 'info';

interface SimpleCondition {
  field: string;
  operator: Operator;
  value: unknown;
}

interface CompoundCondition {
  logic: 'AND' | 'OR';
  conditions: Condition[];
}

type Condition = SimpleCondition | CompoundCondition;

interface DbRule {
  id: string;
  name: string;
  description: string | null;
  category: string;
  condition: Condition;
  severity: Severity;
  message_template: string;
  is_active: boolean;
  priority: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedRules: DbRule[] | null = null;
let cacheExpiry = 0;

export function invalidateRulesCache(): void {
  cachedRules = null;
  cacheExpiry = 0;
}

async function loadRules(pool: pg.Pool): Promise<DbRule[]> {
  if (cachedRules && Date.now() < cacheExpiry) {
    return cachedRules;
  }

  const result = await pool.query<DbRule>(
    `SELECT id, name, description, category, condition, severity, message_template, is_active, priority
     FROM expert_rules
     WHERE is_active = true
     ORDER BY priority DESC, created_at ASC`,
  );

  cachedRules = result.rows;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return cachedRules;
}

// ─── Condition evaluator ─────────────────────────────────────────────────────

function getField(ctx: AssessmentContext, field: string): unknown {
  return (ctx as unknown as Record<string, unknown>)[field];
}

function evalSimple(cond: SimpleCondition, ctx: AssessmentContext): boolean {
  const raw = getField(ctx, cond.field);

  switch (cond.operator) {
    case '>':
      return raw != null && Number(raw) > Number(cond.value);
    case '<':
      return raw != null && Number(raw) < Number(cond.value);
    case '>=':
      return raw != null && Number(raw) >= Number(cond.value);
    case '<=':
      return raw != null && Number(raw) <= Number(cond.value);
    case '==':
      return raw === cond.value;
    case '!=':
      return raw !== cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(raw);
    case 'not_in':
      return Array.isArray(cond.value) && !cond.value.includes(raw);
    case 'contains':
      return typeof raw === 'string' && typeof cond.value === 'string' && raw.includes(cond.value);
    case 'regex':
      return typeof raw === 'string' && typeof cond.value === 'string' && new RegExp(cond.value).test(raw);
    case 'starts_with_any':
      return (
        typeof raw === 'string' &&
        Array.isArray(cond.value) &&
        (cond.value as string[]).some((prefix) => (raw as string).startsWith(prefix))
      );
    default:
      return false;
  }
}

function evalCondition(cond: Condition, ctx: AssessmentContext): boolean {
  if ('logic' in cond) {
    if (cond.logic === 'AND') {
      return cond.conditions.every((c) => evalCondition(c, ctx));
    }
    // OR
    return cond.conditions.some((c) => evalCondition(c, ctx));
  }
  return evalSimple(cond, ctx);
}

// ─── Template rendering ───────────────────────────────────────────────────────

function renderTemplate(template: string, ctx: AssessmentContext): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const val = getField(ctx, key);
    if (val == null) return '?';
    if (typeof val === 'number') return Number.isInteger(val) ? String(val) : val.toFixed(1);
    return String(val);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function evaluateRulesV2(pool: pg.Pool, ctx: AssessmentContext): Promise<RuleResult[]> {
  const rules = await loadRules(pool);
  const results: RuleResult[] = [];

  for (const rule of rules) {
    try {
      if (evalCondition(rule.condition, ctx)) {
        results.push({
          ruleId: rule.id,
          name: rule.name,
          category: rule.category,
          severity: rule.severity,
          message: renderTemplate(rule.message_template, ctx),
        });
      }
    } catch {
      // Skip malformed rules silently — don't break assessment
    }
  }

  return results;
}

// Re-export types so callers don't need to import from both files
export type { AssessmentContext, RuleResult };
