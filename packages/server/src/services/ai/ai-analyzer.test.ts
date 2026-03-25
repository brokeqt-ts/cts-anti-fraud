import { describe, it, expect } from 'vitest';
import { parseAnalysisResponse, buildPostMortemFactors } from './analysis-utils.js';
import {
  buildAccountAnalysisPrompt,
  buildBanAnalysisPrompt,
  buildComparisonPrompt,
} from './prompts/account-analysis.prompt.js';
import type { AccountFeatureVector } from '../../repositories/features.repository.js';
import type { PredictionResult } from '../ml/ban-predictor.js';

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

describe('AI Analyzer', () => {
  describe('parseAnalysisResponse', () => {
    it('parses valid JSON response', () => {
      const json = JSON.stringify({
        summary_ru: 'Тестовое резюме',
        risk_assessment: 'Низкий риск',
        immediate_actions: [{ priority: 'low', action_ru: 'Ничего', reasoning_ru: 'Всё ок', estimated_impact: 'Нет' }],
        strategic_recommendations: [],
        similar_patterns: ['Паттерн 1'],
        confidence: 'high',
      });
      const result = parseAnalysisResponse(json);
      expect(result.summary_ru).toBe('Тестовое резюме');
      expect(result.risk_assessment).toBe('Низкий риск');
      expect(result.immediate_actions).toHaveLength(1);
      expect(result.immediate_actions[0]!.priority).toBe('low');
      expect(result.similar_patterns).toEqual(['Паттерн 1']);
      expect(result.confidence).toBe('high');
    });

    it('strips markdown code blocks from response', () => {
      const json = '```json\n{"summary_ru":"test","risk_assessment":"ok","immediate_actions":[],"strategic_recommendations":[],"similar_patterns":[],"confidence":"medium"}\n```';
      const result = parseAnalysisResponse(json);
      expect(result.summary_ru).toBe('test');
      expect(result.confidence).toBe('medium');
    });

    it('handles missing optional fields', () => {
      const json = '{"summary_ru":"test"}';
      const result = parseAnalysisResponse(json);
      expect(result.summary_ru).toBe('test');
      expect(result.risk_assessment).toBe('');
      expect(result.immediate_actions).toEqual([]);
      expect(result.strategic_recommendations).toEqual([]);
      expect(result.similar_patterns).toEqual([]);
      expect(result.confidence).toBe('low');
    });

    it('defaults confidence to low for invalid values', () => {
      const json = '{"summary_ru":"test","confidence":"invalid"}';
      const result = parseAnalysisResponse(json);
      expect(result.confidence).toBe('low');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseAnalysisResponse('not json at all')).toThrow();
    });
  });

  describe('buildPostMortemFactors', () => {
    it('returns empty for safe account', () => {
      const features = makeVector();
      const factors = buildPostMortemFactors(features, 720);
      expect(factors).toEqual([]);
    });

    it('flags short lifetime', () => {
      const features = makeVector();
      const factors = buildPostMortemFactors(features, 4);
      expect(factors.some(f => f.severity === 'critical' && f.factor.includes('4ч'))).toBe(true);
    });

    it('flags policy violations', () => {
      const features = makeVector({ policy_violation_count: 5 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('5 нарушений'))).toBe(true);
      expect(factors.find(f => f.factor.includes('5 нарушений'))!.severity).toBe('critical');
    });

    it('flags moderate policy violations as warning', () => {
      const features = makeVector({ policy_violation_count: 2 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.find(f => f.factor.includes('2 нарушений'))!.severity).toBe('warning');
    });

    it('flags connected banned accounts', () => {
      const features = makeVector({ connected_banned_accounts: 3 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.severity === 'critical' && f.factor.includes('3 забаненными'))).toBe(true);
    });

    it('flags shared domain with banned', () => {
      const features = makeVector({ shared_domain_with_banned: true });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('Общий домен'))).toBe(true);
    });

    it('flags shared BIN with banned', () => {
      const features = makeVector({ shared_bin_with_banned: true });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('Общий BIN'))).toBe(true);
    });

    it('flags high BIN ban rate', () => {
      const features = makeVector({ bin_ban_rate: 80 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('80%'))).toBe(true);
    });

    it('flags ad disapprovals', () => {
      const features = makeVector({ ad_disapproval_count: 5 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('5 отклонённых'))).toBe(true);
    });

    it('flags critical notifications', () => {
      const features = makeVector({ notification_critical_count: 2 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('2 критических'))).toBe(true);
    });

    it('flags high spend velocity', () => {
      const features = makeVector({ spend_velocity_ratio: 5.0 });
      const factors = buildPostMortemFactors(features, 100);
      expect(factors.some(f => f.factor.includes('5x'))).toBe(true);
    });

    it('accumulates multiple factors for risky account', () => {
      const features = makeVector({
        policy_violation_count: 4,
        connected_banned_accounts: 2,
        shared_domain_with_banned: true,
        bin_ban_rate: 70,
        notification_critical_count: 3,
      });
      const factors = buildPostMortemFactors(features, 2);
      expect(factors.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('prompt builders', () => {
    const features = makeVector();
    const prediction: PredictionResult = {
      ban_probability: 0.65,
      risk_level: 'high',
      confidence: 0.8,
      top_factors: [
        { feature: 'bin_ban_rate', label: 'BIN ban rate', contribution: 0.3, value: 20, direction: 'increases_risk' as const },
        { feature: 'policy_violation_count', label: 'Нарушения', contribution: 0.2, value: 0, direction: 'increases_risk' as const },
      ],
      predicted_days_to_ban: 14,
    };

    it('builds account analysis prompt with all sections', () => {
      const prompt = buildAccountAnalysisPrompt(
        features,
        prediction,
        [{ title: 'Policy warning', category: 'policy' }],
        { total: 5, active: 3, paused: 2 },
      );
      expect(prompt).toContain('1234567890');
      expect(prompt).toContain('30 дней');
      expect(prompt).toContain('$500.00');
      expect(prompt).toContain('65.0%');
      expect(prompt).toContain('Policy warning');
      expect(prompt).toContain('Всего: 5');
    });

    it('handles null prediction in account prompt', () => {
      const prompt = buildAccountAnalysisPrompt(
        features,
        null,
        [],
        { total: 0, active: 0, paused: 0 },
      );
      expect(prompt).toContain('модель не обучена');
      expect(prompt).toContain('Нет уведомлений');
    });

    it('builds ban analysis prompt', () => {
      const prompt = buildBanAnalysisPrompt(
        '1234567890',
        'Circumventing systems',
        48,
        features,
        [{ factor: 'Short lifetime', severity: 'critical' }],
      );
      expect(prompt).toContain('1234567890');
      expect(prompt).toContain('Circumventing systems');
      expect(prompt).toContain('48 часов');
      expect(prompt).toContain('Short lifetime');
    });

    it('builds comparison prompt', () => {
      const accounts = [
        { id: 'acc1', features: makeVector({ total_spend_usd: 1000 }), prediction },
        { id: 'acc2', features: makeVector({ total_spend_usd: 200 }), prediction: null },
      ];
      const prompt = buildComparisonPrompt(accounts);
      expect(prompt).toContain('acc1');
      expect(prompt).toContain('acc2');
      expect(prompt).toContain('$1000');
      expect(prompt).toContain('$200');
      expect(prompt).toContain('65%');
    });
  });
});
