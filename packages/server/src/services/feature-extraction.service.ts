import type pg from 'pg';
import {
  extractFeatures,
  extractBulkFeatures,
  extractTrainingData,
  type AccountFeatureVector,
  type TrainingRow,
} from '../repositories/features.repository.js';

// ─── Numeric feature names (for ML model input) ────────────────────────────

export const NUMERIC_FEATURES = [
  'account_age_days',
  'policy_violation_count',
  'active_campaign_count',
  'domain_age_days',
  'domain_safe_page_score',
  'domain_has_ssl',
  'domain_has_privacy_page',
  'total_spend_usd',
  'daily_spend_avg',
  'spend_velocity_ratio',
  'bin_ban_rate',
  'payment_method_count',
  'campaign_count',
  'avg_quality_score',
  'low_qs_keyword_ratio',
  'ad_disapproval_count',
  'connected_banned_accounts',
  'max_connection_weight',
  'shared_domain_with_banned',
  'shared_bin_with_banned',
  'change_frequency_7d',
  'notification_warning_count',
  'notification_critical_count',
  'hour_of_day',
  'day_of_week',
  'is_high_risk_time',
] as const;

export type NumericFeatureName = (typeof NUMERIC_FEATURES)[number];

/**
 * Convert a feature vector to a numeric array for ML model input.
 * Booleans become 0/1, nulls become 0 (default imputation).
 */
export function vectorToNumeric(v: AccountFeatureVector): number[] {
  return NUMERIC_FEATURES.map((name) => {
    const raw = v[name as keyof AccountFeatureVector];
    if (raw === true) return 1;
    if (raw === false || raw == null) return 0;
    return Number(raw);
  });
}

export const FEATURE_LABELS: Record<string, string> = {
  account_age_days: 'Возраст аккаунта',
  policy_violation_count: 'Нарушения политики',
  active_campaign_count: 'Активные кампании',
  domain_age_days: 'Возраст домена',
  domain_safe_page_score: 'Score safe page',
  domain_has_ssl: 'SSL сертификат',
  domain_has_privacy_page: 'Privacy page',
  total_spend_usd: 'Общий расход',
  daily_spend_avg: 'Средний дневной расход',
  spend_velocity_ratio: 'Скорость расхода',
  bin_ban_rate: 'BIN ban rate',
  payment_method_count: 'Кол-во платёжных методов',
  campaign_count: 'Кол-во кампаний',
  avg_quality_score: 'Средний QS',
  low_qs_keyword_ratio: 'Доля низких QS',
  ad_disapproval_count: 'Отклонённые объявления',
  connected_banned_accounts: 'Связанные забаненные',
  max_connection_weight: 'Вес связи с баном',
  shared_domain_with_banned: 'Общий домен с баном',
  shared_bin_with_banned: 'Общий BIN с баном',
  change_frequency_7d: 'Частота изменений (7д)',
  notification_warning_count: 'Предупреждения',
  notification_critical_count: 'Критические уведомления',
  hour_of_day: 'Час дня',
  day_of_week: 'День недели',
  is_high_risk_time: 'Высокорисковое время',
};

// ─── Service API ────────────────────────────────────────────────────────────

export async function getAccountFeatures(
  pool: pg.Pool,
  accountGoogleId: string,
): Promise<AccountFeatureVector | null> {
  return extractFeatures(pool, accountGoogleId);
}

export async function getAllActiveFeatures(
  pool: pg.Pool,
  userId?: string,
): Promise<AccountFeatureVector[]> {
  return extractBulkFeatures(pool, userId);
}

export async function getTrainingDataset(
  pool: pg.Pool,
): Promise<TrainingRow[]> {
  return extractTrainingData(pool);
}
