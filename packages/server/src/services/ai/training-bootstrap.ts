import type pg from 'pg';
import { getTrainingDataset } from '../feature-extraction.service.js';
import { vectorToNumeric, NUMERIC_FEATURES } from '../feature-extraction.service.js';
import { BanPredictor } from '../ml/ban-predictor.js';

export interface TrainingStats {
  total_samples: number;
  banned_count: number;
  active_count: number;
  class_ratio: number;
  feature_stats: Array<{
    feature: string;
    min: number;
    max: number;
    mean: number;
    missing_count: number;
  }>;
}

export interface BootstrapResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  sample_count: number;
  positive_count: number;
  negative_count: number;
  model_version: string;
  warnings: string[];
}

export interface CSVExportResult {
  csv: string;
  rows: number;
  columns: number;
}

/**
 * Compute statistics about the training dataset.
 */
export async function getTrainingStats(pool: pg.Pool): Promise<TrainingStats> {
  const data = await getTrainingDataset(pool);

  const bannedCount = data.filter(r => r.is_banned).length;
  const activeCount = data.length - bannedCount;

  // Compute per-feature stats
  const featureStats = NUMERIC_FEATURES.map((name, idx) => {
    const values = data.map(r => {
      const nums = vectorToNumeric(r);
      return nums[idx]!;
    });

    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const mean = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

    // Count values that are 0 and the feature allows nulls
    const nullableFeatures = new Set([
      'domain_age_days', 'domain_safe_page_score', 'bin_ban_rate',
      'avg_quality_score', 'proxy_ban_rate',
    ]);
    const missingCount = nullableFeatures.has(name) ? values.filter(v => v === 0).length : 0;

    return {
      feature: name,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      missing_count: missingCount,
    };
  });

  return {
    total_samples: data.length,
    banned_count: bannedCount,
    active_count: activeCount,
    class_ratio: data.length > 0 ? bannedCount / data.length : 0,
    feature_stats: featureStats,
  };
}

/**
 * Export training data as CSV for external analysis.
 */
export async function exportTrainingCSV(pool: pg.Pool): Promise<CSVExportResult> {
  const data = await getTrainingDataset(pool);

  const headers = ['account_google_id', ...NUMERIC_FEATURES, 'is_banned', 'days_to_ban'];
  const rows = data.map(row => {
    const nums = vectorToNumeric(row);
    return [
      row.account_google_id,
      ...nums.map(n => String(n)),
      row.is_banned ? '1' : '0',
      row.days_to_ban != null ? String(row.days_to_ban) : '',
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  return {
    csv,
    rows: data.length,
    columns: headers.length,
  };
}

/**
 * Bootstrap training: gather data, handle class imbalance, train, save.
 */
export async function bootstrapTraining(pool: pg.Pool): Promise<BootstrapResult> {
  const predictor = new BanPredictor();
  const result = await predictor.train(pool);
  return result;
}

/**
 * Generate synthetic training samples for testing when real data is scarce.
 * Creates realistic-looking feature vectors with known labels.
 */
export function generateSyntheticSamples(count: number): Array<{
  features: number[];
  label: number;
  days_to_ban: number | null;
}> {
  const samples: Array<{ features: number[]; label: number; days_to_ban: number | null }> = [];

  for (let i = 0; i < count; i++) {
    const isBanned = Math.random() < 0.3; // 30% ban rate

    const accountAge = isBanned
      ? Math.floor(Math.random() * 30) + 1  // Banned: 1-30 days
      : Math.floor(Math.random() * 180) + 10; // Active: 10-190 days

    const violations = isBanned
      ? Math.floor(Math.random() * 5) + 1
      : Math.floor(Math.random() * 2);

    const binBanRate = isBanned
      ? Math.random() * 60 + 20 // 20-80%
      : Math.random() * 30; // 0-30%

    const connectedBanned = isBanned
      ? Math.floor(Math.random() * 3)
      : Math.random() < 0.1 ? 1 : 0;

    const totalSpend = isBanned
      ? Math.random() * 500
      : Math.random() * 2000 + 100;

    const features = [
      accountAge,                              // account_age_days
      violations,                              // policy_violation_count
      Math.floor(Math.random() * 5) + 1,      // active_campaign_count
      Math.floor(Math.random() * 365) + 30,   // domain_age_days
      Math.floor(Math.random() * 100),         // domain_safe_page_score
      Math.random() > 0.2 ? 1 : 0,            // domain_has_ssl
      Math.random() > 0.3 ? 1 : 0,            // domain_has_privacy_page
      totalSpend,                              // total_spend_usd
      totalSpend / Math.max(accountAge, 1),    // daily_spend_avg
      isBanned ? Math.random() * 3 + 1 : Math.random() * 1.5, // spend_velocity_ratio
      binBanRate,                              // bin_ban_rate
      Math.floor(Math.random() * 3) + 1,      // payment_method_count
      Math.floor(Math.random() * 5) + 1,      // campaign_count
      isBanned ? Math.random() * 4 + 3 : Math.random() * 4 + 5, // avg_quality_score
      isBanned ? Math.random() * 0.4 : Math.random() * 0.15, // low_qs_keyword_ratio
      isBanned ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 1), // ad_disapproval_count
      connectedBanned,                         // connected_banned_accounts
      connectedBanned > 0 ? Math.random() * 0.8 : 0, // max_connection_weight
      isBanned && Math.random() > 0.6 ? 1 : 0, // shared_domain_with_banned
      isBanned && Math.random() > 0.7 ? 1 : 0, // shared_bin_with_banned
      Math.random() * 3,                       // change_frequency_7d
      isBanned ? Math.floor(Math.random() * 3) : Math.floor(Math.random() * 1), // notification_warning_count
      isBanned ? Math.floor(Math.random() * 2) : 0, // notification_critical_count
      Math.floor(Math.random() * 24),          // hour_of_day
      Math.floor(Math.random() * 7),           // day_of_week
      isBanned && Math.random() > 0.7 ? 1 : 0, // is_high_risk_time
    ];

    const daysToBan = isBanned ? Math.floor(Math.random() * 30) + 1 : null;

    samples.push({ features, label: isBanned ? 1 : 0, days_to_ban: daysToBan });
  }

  return samples;
}
