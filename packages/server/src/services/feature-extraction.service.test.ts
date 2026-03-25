import { describe, it, expect } from 'vitest';
import { vectorToNumeric, NUMERIC_FEATURES, type NumericFeatureName } from './feature-extraction.service.js';
import type { AccountFeatureVector } from '../repositories/features.repository.js';

function makeVector(overrides: Partial<AccountFeatureVector> = {}): AccountFeatureVector {
  return {
    account_google_id: '1234567890',
    account_age_days: 30,
    account_type: 'farm',
    has_verification: false,
    policy_violation_count: 2,
    active_campaign_count: 3,
    domain_age_days: 90,
    domain_safe_page_score: 75,
    domain_has_ssl: true,
    domain_has_privacy_page: true,
    total_spend_usd: 500,
    daily_spend_avg: 16.67,
    spend_velocity_ratio: 1.2,
    bin_prefix: '411111',
    bin_ban_rate: 25,
    payment_method_count: 1,
    campaign_count: 3,
    avg_quality_score: 6.5,
    low_qs_keyword_ratio: 0.15,
    ad_disapproval_count: 1,
    connected_banned_accounts: 0,
    max_connection_weight: 0,
    shared_domain_with_banned: false,
    shared_bin_with_banned: false,
    days_since_last_change: 2,
    change_frequency_7d: 1.5,
    notification_warning_count: 1,
    notification_critical_count: 0,
    proxy_ban_rate: null,
    antidetect_browser_type: 'dolphin',
    hour_of_day: 14,
    day_of_week: 3,
    is_high_risk_time: false,
    ...overrides,
  };
}

describe('Feature Extraction Service', () => {
  describe('vectorToNumeric', () => {
    it('converts a full feature vector to numeric array', () => {
      const v = makeVector();
      const nums = vectorToNumeric(v);
      expect(nums.length).toBe(NUMERIC_FEATURES.length);
      expect(nums[0]).toBe(30); // account_age_days
      expect(nums[1]).toBe(2);  // policy_violation_count
    });

    it('converts booleans to 0/1', () => {
      const v = makeVector({ domain_has_ssl: true, domain_has_privacy_page: false });
      const nums = vectorToNumeric(v);
      const sslIdx = NUMERIC_FEATURES.indexOf('domain_has_ssl' as NumericFeatureName);
      const privIdx = NUMERIC_FEATURES.indexOf('domain_has_privacy_page' as NumericFeatureName);
      expect(nums[sslIdx]).toBe(1);
      expect(nums[privIdx]).toBe(0);
    });

    it('converts null values to 0', () => {
      const v = makeVector({ domain_age_days: null, avg_quality_score: null, bin_ban_rate: null });
      const nums = vectorToNumeric(v);
      const domainIdx = NUMERIC_FEATURES.indexOf('domain_age_days' as NumericFeatureName);
      expect(nums[domainIdx]).toBe(0);
    });

    it('handles edge case: brand new account with no data', () => {
      const v = makeVector({
        account_age_days: 0,
        active_campaign_count: 0,
        domain_age_days: null,
        domain_safe_page_score: null,
        total_spend_usd: 0,
        daily_spend_avg: 0,
        avg_quality_score: null,
        campaign_count: 0,
      });
      const nums = vectorToNumeric(v);
      expect(nums[0]).toBe(0); // account_age_days
      expect(nums.every(n => !isNaN(n))).toBe(true);
    });

    it('handles edge case: account with high risk indicators', () => {
      const v = makeVector({
        policy_violation_count: 5,
        bin_ban_rate: 80,
        connected_banned_accounts: 3,
        shared_domain_with_banned: true,
        shared_bin_with_banned: true,
        notification_critical_count: 4,
        is_high_risk_time: true,
      });
      const nums = vectorToNumeric(v);
      const sharedDomainIdx = NUMERIC_FEATURES.indexOf('shared_domain_with_banned' as NumericFeatureName);
      const highRiskIdx = NUMERIC_FEATURES.indexOf('is_high_risk_time' as NumericFeatureName);
      expect(nums[sharedDomainIdx]).toBe(1);
      expect(nums[highRiskIdx]).toBe(1);
    });
  });

  describe('NUMERIC_FEATURES', () => {
    it('contains the expected number of features', () => {
      expect(NUMERIC_FEATURES.length).toBe(26);
    });

    it('does not contain string-only fields', () => {
      const stringOnly = ['account_google_id', 'account_type', 'bin_prefix', 'antidetect_browser_type'];
      for (const s of stringOnly) {
        expect(NUMERIC_FEATURES).not.toContain(s);
      }
    });
  });
});
