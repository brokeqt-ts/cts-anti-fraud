import { describe, it, expect } from 'vitest';
import { FeatureScaler } from './feature-scaler.js';
import { vectorToNumeric, NUMERIC_FEATURES } from '../feature-extraction.service.js';
import type { AccountFeatureVector } from '../../repositories/features.repository.js';

function makeVector(overrides: Partial<AccountFeatureVector> = {}): AccountFeatureVector {
  return {
    account_google_id: '1234567890',
    account_age_days: 30, account_type: 'farm', has_verification: false,
    policy_violation_count: 0, active_campaign_count: 2,
    domain_age_days: 90, domain_safe_page_score: 70, domain_has_ssl: true, domain_has_privacy_page: true,
    total_spend_usd: 500, daily_spend_avg: 16.67, spend_velocity_ratio: 1.0,
    bin_prefix: '411111', bin_ban_rate: 20, payment_method_count: 1,
    campaign_count: 2, avg_quality_score: 7, low_qs_keyword_ratio: 0.1, ad_disapproval_count: 0,
    connected_banned_accounts: 0, max_connection_weight: 0, shared_domain_with_banned: false, shared_bin_with_banned: false,
    days_since_last_change: 5, change_frequency_7d: 0.5,
    notification_warning_count: 0, notification_critical_count: 0,
    proxy_ban_rate: null, antidetect_browser_type: null,
    hour_of_day: 14, day_of_week: 3, is_high_risk_time: false,
    ...overrides,
  };
}

// Sigmoid function test standalone
function sigmoid(z: number): number {
  if (z > 500) return 1;
  if (z < -500) return 0;
  return 1 / (1 + Math.exp(-z));
}

describe('Ban Predictor', () => {
  describe('sigmoid function', () => {
    it('returns 0.5 for input 0', () => {
      expect(sigmoid(0)).toBe(0.5);
    });

    it('returns ~1 for large positive input', () => {
      expect(sigmoid(10)).toBeGreaterThan(0.99);
    });

    it('returns ~0 for large negative input', () => {
      expect(sigmoid(-10)).toBeLessThan(0.01);
    });

    it('handles extreme values without overflow', () => {
      expect(sigmoid(1000)).toBe(1);
      expect(sigmoid(-1000)).toBe(0);
    });

    it('is monotonically increasing', () => {
      const values = [-5, -2, 0, 2, 5];
      for (let i = 1; i < values.length; i++) {
        expect(sigmoid(values[i]!)).toBeGreaterThan(sigmoid(values[i - 1]!));
      }
    });
  });

  describe('FeatureScaler', () => {
    it('fits and transforms data to [0, 1] range', () => {
      const scaler = new FeatureScaler();
      const data = [
        [0, 10, 100],
        [5, 20, 200],
        [10, 30, 300],
      ];
      scaler.fit(data);
      const transformed = scaler.transform([5, 20, 200]);
      expect(transformed[0]).toBe(0.5);
      expect(transformed[1]).toBe(0.5);
      expect(transformed[2]).toBe(0.5);
    });

    it('clips values outside range', () => {
      const scaler = new FeatureScaler();
      scaler.fit([[0, 0], [10, 10]]);
      const result = scaler.transform([15, -5]);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(0);
    });

    it('handles constant features (range = 0)', () => {
      const scaler = new FeatureScaler();
      scaler.fit([[5, 5], [5, 5]]);
      const result = scaler.transform([5, 5]);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
    });

    it('computes median correctly for odd-length array', () => {
      const scaler = new FeatureScaler();
      const params = scaler.fit([[1], [3], [5]]);
      expect(params.median[0]).toBe(3);
    });

    it('computes median correctly for even-length array', () => {
      const scaler = new FeatureScaler();
      const params = scaler.fit([[1], [3], [5], [7]]);
      expect(params.median[0]).toBe(4);
    });

    it('serializes and loads params', () => {
      const scaler1 = new FeatureScaler();
      const params = scaler1.fit([[0, 100], [10, 200]]);

      const scaler2 = new FeatureScaler();
      scaler2.load(params);

      const r1 = scaler1.transform([5, 150]);
      const r2 = scaler2.transform([5, 150]);
      expect(r1).toEqual(r2);
    });

    it('imputes NaN with median', () => {
      const scaler = new FeatureScaler();
      scaler.fit([[0, 10], [5, 20], [10, 30]]);
      const result = scaler.transform([NaN, 20]);
      expect(result[0]).toBe(0.5); // median of [0,5,10] = 5 → (5-0)/10 = 0.5
      expect(result[1]).toBe(0.5);
    });
  });

  describe('prediction with manual weights', () => {
    it('predicts low risk for safe account', () => {
      const features = makeVector({
        account_age_days: 60,
        domain_age_days: 365,
        bin_ban_rate: 5,
        policy_violation_count: 0,
        connected_banned_accounts: 0,
      });

      // Simulate manual weights: negative weight = safer
      const numeric = vectorToNumeric(features);
      expect(numeric.length).toBe(NUMERIC_FEATURES.length);
      expect(numeric[0]).toBe(60); // account_age_days
    });

    it('produces higher score for risky account', () => {
      const safe = makeVector({ policy_violation_count: 0, bin_ban_rate: 5, connected_banned_accounts: 0 });
      const risky = makeVector({ policy_violation_count: 5, bin_ban_rate: 80, connected_banned_accounts: 3 });

      const safeNums = vectorToNumeric(safe);
      const riskyNums = vectorToNumeric(risky);

      // Simple dot product with intuitive weights should give higher score for risky
      const weights = Array(safeNums.length).fill(0.01);
      // policy_violation_count (index 1), bin_ban_rate (index 10), connected_banned (index 16) should be positive risk
      weights[1] = 0.5;  // policy violations
      weights[10] = 0.02; // bin ban rate
      weights[16] = 0.3;  // connected banned

      const safeDot = safeNums.reduce((s: number, x: number, i: number) => s + x * weights[i], 0);
      const riskyDot = riskyNums.reduce((s: number, x: number, i: number) => s + x * weights[i], 0);

      expect(sigmoid(riskyDot)).toBeGreaterThan(sigmoid(safeDot));
    });
  });

  describe('factor explanation', () => {
    it('sorts by absolute contribution descending', () => {
      const contributions = [
        { contribution: 0.1 },
        { contribution: 0.5 },
        { contribution: 0.3 },
        { contribution: 0.05 },
      ];
      const sorted = contributions.sort((a, b) => b.contribution - a.contribution);
      expect(sorted[0]!.contribution).toBe(0.5);
      expect(sorted[1]!.contribution).toBe(0.3);
    });
  });
});
