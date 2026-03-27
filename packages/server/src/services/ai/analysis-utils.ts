import type { AccountFeatureVector } from '../../repositories/features.repository.js';

export interface AiAnalysisAction {
  priority: 'critical' | 'high' | 'medium' | 'low';
  action_ru: string;
  reasoning_ru: string;
  estimated_impact: string;
}

export interface AiRiskFactor {
  factor: string;
  value: string;
  interpretation: string;
}

export interface AiAnalysisResult {
  // Structured output fields (new)
  risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  top_risk_factors?: AiRiskFactor[];
  actions_today?: AiAnalysisAction[];
  actions_this_week?: AiAnalysisAction[];
  stable_factors?: string[];
  // Legacy fields (kept for backwards compatibility)
  summary_ru: string;
  risk_assessment: string;
  immediate_actions: AiAnalysisAction[];
  strategic_recommendations: AiAnalysisAction[];
  similar_patterns: string[];
  confidence: 'low' | 'medium' | 'high';
  model: string;
  tokens_used: number;
  latency_ms: number;
}

export function parseAnalysisResponse(text: string): Omit<AiAnalysisResult, 'model' | 'tokens_used' | 'latency_ms'> {
  // Strip potential markdown code blocks
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  return {
    // Structured output fields
    risk_level: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(parsed['risk_level'] as string)
      ? parsed['risk_level']
      : undefined) as AiAnalysisResult['risk_level'],
    top_risk_factors: Array.isArray(parsed['top_risk_factors'])
      ? (parsed['top_risk_factors'] as AiRiskFactor[])
      : undefined,
    actions_today: Array.isArray(parsed['actions_today'])
      ? (parsed['actions_today'] as AiAnalysisAction[])
      : undefined,
    actions_this_week: Array.isArray(parsed['actions_this_week'])
      ? (parsed['actions_this_week'] as AiAnalysisAction[])
      : undefined,
    stable_factors: Array.isArray(parsed['stable_factors'])
      ? (parsed['stable_factors'] as string[])
      : undefined,
    // Legacy fields
    summary_ru: (parsed['summary_ru'] as string) ?? '',
    risk_assessment: (parsed['risk_assessment'] as string) ?? '',
    immediate_actions: Array.isArray(parsed['immediate_actions'])
      ? (parsed['immediate_actions'] as AiAnalysisAction[])
      : [],
    strategic_recommendations: Array.isArray(parsed['strategic_recommendations'])
      ? (parsed['strategic_recommendations'] as AiAnalysisAction[])
      : [],
    similar_patterns: Array.isArray(parsed['similar_patterns'])
      ? (parsed['similar_patterns'] as string[])
      : [],
    confidence: (['low', 'medium', 'high'].includes(parsed['confidence'] as string)
      ? parsed['confidence']
      : 'low') as 'low' | 'medium' | 'high',
  };
}

export function buildPostMortemFactors(
  features: AccountFeatureVector,
  lifetimeHours: number | null,
): Array<{ factor: string; severity: string }> {
  const factors: Array<{ factor: string; severity: string }> = [];

  if (lifetimeHours != null && lifetimeHours < 24) {
    factors.push({ factor: `Бан через ${lifetimeHours}ч после создания`, severity: 'critical' });
  }

  if (features.policy_violation_count > 0) {
    factors.push({
      factor: `${features.policy_violation_count} нарушений политики`,
      severity: features.policy_violation_count >= 3 ? 'critical' : 'warning',
    });
  }

  if (features.connected_banned_accounts > 0) {
    factors.push({
      factor: `Связан с ${features.connected_banned_accounts} забаненными аккаунтами`,
      severity: 'critical',
    });
  }

  if (features.shared_domain_with_banned) {
    factors.push({ factor: 'Общий домен с забаненным аккаунтом', severity: 'critical' });
  }

  if (features.shared_bin_with_banned) {
    factors.push({ factor: 'Общий BIN с забаненным аккаунтом', severity: 'warning' });
  }

  if ((features.bin_ban_rate ?? 0) > 50) {
    factors.push({ factor: `Высокий BIN ban rate: ${features.bin_ban_rate}%`, severity: 'warning' });
  }

  if (features.ad_disapproval_count > 0) {
    factors.push({
      factor: `${features.ad_disapproval_count} отклонённых объявлений`,
      severity: features.ad_disapproval_count >= 3 ? 'warning' : 'info',
    });
  }

  if (features.notification_critical_count > 0) {
    factors.push({
      factor: `${features.notification_critical_count} критических уведомлений`,
      severity: 'critical',
    });
  }

  if (features.spend_velocity_ratio > 3) {
    factors.push({
      factor: `Высокая скорость расхода: ${features.spend_velocity_ratio}x`,
      severity: 'warning',
    });
  }

  return factors;
}
