import { describe, it, expect } from 'vitest';
import { evaluateRules, getBudgetRecommendation, type AssessmentContext } from './rules-engine.js';

describe('rules-engine', () => {
  describe('evaluateRules', () => {
    it('returns empty array when no rules match', () => {
      const ctx: AssessmentContext = {
        domainAgeDays: 90,
        domainSafePageScore: 80,
        accountAgeDays: 60,
        accountHasActiveViolations: false,
        binBanRate: 10,
        verticalBanRate: 10,
        geoBanRate: 10,
      };
      const results = evaluateRules(ctx);
      expect(results).toEqual([]);
    });

    it('detects risky BIN prefix', () => {
      const ctx: AssessmentContext = { bin: '404038123456' };
      const results = evaluateRules(ctx);
      const binRule = results.find(r => r.ruleId === 'bin_risky_prefix');
      expect(binRule).toBeDefined();
      expect(binRule!.severity).toBe('warning');
      expect(binRule!.category).toBe('bin');
    });

    it('detects high BIN ban rate', () => {
      const ctx: AssessmentContext = { bin: '999999', binBanRate: 60 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'bin_high_ban_rate');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('warning');
    });

    it('detects critical BIN ban rate', () => {
      const ctx: AssessmentContext = { bin: '999999', binBanRate: 90 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'bin_critical_ban_rate');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('block');
    });

    it('detects domain too young for gambling vertical', () => {
      const ctx: AssessmentContext = {
        domain: 'example.com',
        domainAgeDays: 15,
        vertical: 'gambling',
      };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'domain_too_young');
      expect(rule).toBeDefined();
      expect(rule!.message).toContain('30');
    });

    it('does not flag domain age when sufficient for ecom', () => {
      const ctx: AssessmentContext = {
        domain: 'shop.com',
        domainAgeDays: 10,
        vertical: 'ecom',
      };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'domain_too_young');
      expect(rule).toBeUndefined();
    });

    it('detects unknown domain age', () => {
      const ctx: AssessmentContext = { domain: 'unknown.com', domainAgeDays: null };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'domain_no_age');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('info');
    });

    it('detects low safe page score', () => {
      const ctx: AssessmentContext = { domainSafePageScore: 30 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'domain_low_safe_score');
      expect(rule).toBeDefined();
    });

    it('detects critical safe page score', () => {
      const ctx: AssessmentContext = { domainSafePageScore: 10 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'domain_critical_safe_score');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('block');
    });

    it('detects active account violations as block', () => {
      const ctx: AssessmentContext = { accountHasActiveViolations: true };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'account_active_violations');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('block');
    });

    it('detects very new account', () => {
      const ctx: AssessmentContext = { accountAgeDays: 1 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'account_very_new');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('warning');
    });

    it('detects high-risk geo+vertical combo', () => {
      const ctx: AssessmentContext = { geo: 'IN', vertical: 'nutra' };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'geo_high_risk_combo');
      expect(rule).toBeDefined();
    });

    it('does not flag safe geo+vertical combo', () => {
      const ctx: AssessmentContext = { geo: 'US', vertical: 'ecom' };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'geo_high_risk_combo');
      expect(rule).toBeUndefined();
    });

    it('detects high geo ban rate', () => {
      const ctx: AssessmentContext = { geo: 'XX', geoBanRate: 55 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'geo_high_ban_rate');
      expect(rule).toBeDefined();
    });

    it('detects high vertical ban rate', () => {
      const ctx: AssessmentContext = { vertical: 'nutra', verticalBanRate: 60 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'vertical_high_ban_rate');
      expect(rule).toBeDefined();
    });

    it('recommends budget for new accounts (<7 days)', () => {
      const ctx: AssessmentContext = { accountAgeDays: 3 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'spend_new_account_budget');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('info');
      expect(rule!.message).toContain('$30');
    });

    it('recommends budget for medium accounts (7-30 days)', () => {
      const ctx: AssessmentContext = { accountAgeDays: 15 };
      const results = evaluateRules(ctx);
      const rule = results.find(r => r.ruleId === 'spend_medium_account_budget');
      expect(rule).toBeDefined();
      expect(rule!.message).toContain('$100');
    });

    it('messages are in Russian', () => {
      const ctx: AssessmentContext = { accountHasActiveViolations: true };
      const results = evaluateRules(ctx);
      // All messages should contain Russian characters
      for (const r of results) {
        expect(r.message).toMatch(/[а-яА-ЯёЁ]/);
      }
    });
  });

  describe('getBudgetRecommendation', () => {
    it('returns $30 for accounts under 7 days', () => {
      expect(getBudgetRecommendation(3)).toBe(30);
    });

    it('returns $100 for accounts between 7 and 30 days', () => {
      expect(getBudgetRecommendation(15)).toBe(100);
    });

    it('returns null for aged accounts (30+ days)', () => {
      expect(getBudgetRecommendation(60)).toBeNull();
    });

    it('returns null when account age is unknown', () => {
      expect(getBudgetRecommendation(null)).toBeNull();
    });
  });
});
