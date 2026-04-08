import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

vi.mock('../repositories/assessment.repository.js', () => ({
  getDomainInfo: vi.fn(),
  getAccountInfo: vi.fn(),
  getBinStats: vi.fn(),
  getVerticalStats: vi.fn(),
  getGeoStats: vi.fn(),
  getComparableAccounts: vi.fn(),
}));

// Rules engine v2 queries the DB for expert_rules — mock to avoid real pool
vi.mock('./rules-engine-v2.js', () => ({
  evaluateRulesV2: vi.fn().mockResolvedValue([]),
  invalidateRulesCache: vi.fn(),
}));

import * as assessmentRepo from '../repositories/assessment.repository.js';
import { assess } from './assessment.service.js';

const mockPool = {} as pg.Pool;

const mockDomainInfo   = vi.mocked(assessmentRepo.getDomainInfo);
const mockAccountInfo  = vi.mocked(assessmentRepo.getAccountInfo);
const mockBinStats     = vi.mocked(assessmentRepo.getBinStats);
const mockVertical     = vi.mocked(assessmentRepo.getVerticalStats);
const mockGeo          = vi.mocked(assessmentRepo.getGeoStats);
const mockComparable   = vi.mocked(assessmentRepo.getComparableAccounts);

const ZERO_DOMAIN   = { domainAgeDays: null, safePageQualityScore: null };
const ZERO_ACCOUNT  = null;
const ZERO_BIN      = { total: 0, banned: 0, banRate: 0, avgLifetimeHours: 0 };
const ZERO_VERTICAL = { banCount: 0, totalAccounts: 0, banRate: 0, avgLifetimeHours: 0 };
const ZERO_GEO      = { banCount: 0, totalAccounts: 0, banRate: 0 };
const ZERO_COMP     = { total: 0, banned: 0, avgLifetimeDays: 0 };

describe('assessment.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDomainInfo.mockResolvedValue(ZERO_DOMAIN);
    mockAccountInfo.mockResolvedValue(ZERO_ACCOUNT);
    mockBinStats.mockResolvedValue(ZERO_BIN);
    mockVertical.mockResolvedValue(ZERO_VERTICAL);
    mockGeo.mockResolvedValue(ZERO_GEO);
    mockComparable.mockResolvedValue(ZERO_COMP);
  });

  // ── Output shape ─────────────────────────────────────────────────────────────

  describe('Response structure', () => {
    it('returns all required top-level fields', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result).toHaveProperty('risk_score');
      expect(result).toHaveProperty('risk_level');
      expect(result).toHaveProperty('factors');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('comparable_accounts');
      expect(result).toHaveProperty('budget_recommendation');
    });

    it('risk_score is always between 0 and 100', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
      expect(result.risk_score).toBeLessThanOrEqual(100);
    });

    it('risk_level is always a valid enum value', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(['low', 'medium', 'high', 'critical']).toContain(result.risk_level);
    });

    it('factors is an array', async () => {
      const result = await assess(mockPool, {});
      expect(result.factors).toBeInstanceOf(Array);
    });

    it('recommendations are plain strings without severity emoji prefixes', async () => {
      const result = await assess(mockPool, { account_google_id: 'acc-1' });
      for (const rec of result.recommendations) {
        expect(rec).not.toMatch(/^[🚫⚠️ℹ️]/u);
      }
    });
  });

  // ── Risk levels ──────────────────────────────────────────────────────────────

  describe('Risk level thresholds', () => {
    it('low risk for healthy domain (old domain, high score)', async () => {
      mockDomainInfo.mockResolvedValue({ domainAgeDays: 365, safePageQualityScore: 90 });
      mockBinStats.mockResolvedValue({ total: 100, banned: 2, banRate: 2, avgLifetimeHours: 800 });
      const result = await assess(mockPool, { domain: 'old-site.com', bin: '411111' });
      expect(result.risk_level).toBe('low');
      expect(result.risk_score).toBeLessThan(30);
    });

    it('critical risk for account with active violations', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 30, hasActiveViolations: true });
      const result = await assess(mockPool, { account_google_id: 'acc-bad' });
      expect(result.risk_score).toBeGreaterThanOrEqual(80);
      expect(result.risk_level).toBe('critical');
    });

    it('high risk for very high BIN ban rate', async () => {
      mockBinStats.mockResolvedValue({ total: 50, banned: 45, banRate: 90, avgLifetimeHours: 12 });
      const result = await assess(mockPool, { bin: '516732' });
      expect(result.risk_score).toBeGreaterThanOrEqual(70);
      expect(['high', 'critical']).toContain(result.risk_level);
    });
  });

  // ── Factors ──────────────────────────────────────────────────────────────────

  describe('Factor inclusion', () => {
    it('only domain factor when only domain provided', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.factors).toHaveLength(1);
      expect(result.factors[0]!.category).toBe('domain');
    });

    it('domain + account factors when both provided', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 30, hasActiveViolations: false });
      const result = await assess(mockPool, { domain: 'test.com', account_google_id: 'acc-1' });
      const categories = result.factors.map(f => f.category);
      expect(categories).toContain('domain');
      expect(categories).toContain('account');
    });

    it('all five factors for full request', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 30, hasActiveViolations: false });
      mockBinStats.mockResolvedValue({ ...ZERO_BIN, total: 10 });
      mockVertical.mockResolvedValue({ ...ZERO_VERTICAL, totalAccounts: 10 });
      mockGeo.mockResolvedValue({ ...ZERO_GEO, totalAccounts: 10 });
      const result = await assess(mockPool, {
        domain: 'test.com', account_google_id: 'acc-1',
        bin: '411111', vertical: 'ecom', geo: 'US',
      });
      const cats = result.factors.map(f => f.category);
      expect(cats).toContain('domain');
      expect(cats).toContain('account');
      expect(cats).toContain('bin');
      expect(cats).toContain('vertical');
      expect(cats).toContain('geo');
    });

    it('no factors for empty request', async () => {
      const result = await assess(mockPool, {});
      expect(result.factors).toHaveLength(0);
    });

    it('each factor has score, weight, and detail', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      for (const factor of result.factors) {
        expect(factor.score).toBeTypeOf('number');
        expect(factor.weight).toBeTypeOf('number');
        expect(factor.detail).toBeTypeOf('string');
      }
    });

    it('factor scores are between 0 and 100', async () => {
      mockBinStats.mockResolvedValue({ total: 100, banned: 90, banRate: 90, avgLifetimeHours: 10 });
      const result = await assess(mockPool, { bin: '516732' });
      for (const factor of result.factors) {
        expect(factor.score).toBeGreaterThanOrEqual(0);
        expect(factor.score).toBeLessThanOrEqual(100);
      }
    });
  });

  // ── Repository call patterns ─────────────────────────────────────────────────

  describe('Repository calls', () => {
    it('calls all repos in parallel for full request', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 30, hasActiveViolations: false });
      await assess(mockPool, {
        domain: 'test.com', account_google_id: 'acc-1',
        bin: '411111', vertical: 'ecom', geo: 'US',
      });
      expect(mockDomainInfo).toHaveBeenCalledOnce();
      expect(mockAccountInfo).toHaveBeenCalledOnce();
      expect(mockBinStats).toHaveBeenCalledOnce();
      expect(mockVertical).toHaveBeenCalledOnce();
      expect(mockGeo).toHaveBeenCalledOnce();
      expect(mockComparable).toHaveBeenCalledOnce();
    });

    it('skips account/bin/vertical/geo repos when not provided', async () => {
      await assess(mockPool, { domain: 'test.com' });
      expect(mockDomainInfo).toHaveBeenCalledOnce();
      expect(mockAccountInfo).not.toHaveBeenCalled();
      expect(mockBinStats).not.toHaveBeenCalled();
      expect(mockVertical).not.toHaveBeenCalled();
      expect(mockGeo).not.toHaveBeenCalled();
    });

    it('always calls comparable even for empty request', async () => {
      await assess(mockPool, {});
      expect(mockComparable).toHaveBeenCalledOnce();
    });
  });

  // ── Budget recommendations ────────────────────────────────────────────────────

  describe('Budget recommendations', () => {
    it('returns 30 for account aged 3 days', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 3, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-new' });
      expect(result.budget_recommendation).toBe(30);
    });

    it('returns 30 for account aged exactly 6 days (just before boundary)', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 6, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-6d' });
      expect(result.budget_recommendation).toBe(30);
    });

    it('returns 100 for account aged exactly 7 days (boundary — enters next tier)', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 7, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-7d' });
      expect(result.budget_recommendation).toBe(100);
    });

    it('returns higher budget for account aged 8 days', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 8, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-8d' });
      expect(result.budget_recommendation).toBeGreaterThan(30);
    });

    it('returns null for mature account (90 days)', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 90, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-old' });
      expect(result.budget_recommendation).toBeNull();
    });

    it('returns null when no account provided', async () => {
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.budget_recommendation).toBeNull();
    });
  });

  // ── Comparable accounts ───────────────────────────────────────────────────────

  describe('Comparable accounts', () => {
    it('computes ban_rate correctly', async () => {
      mockComparable.mockResolvedValue({ total: 50, banned: 10, avgLifetimeDays: 45 });
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.comparable_accounts.ban_rate).toBe(20); // 10/50 * 100
    });

    it('ban_rate is 0 when total is 0 (no division by zero)', async () => {
      mockComparable.mockResolvedValue({ total: 0, banned: 0, avgLifetimeDays: 0 });
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.comparable_accounts.ban_rate).toBe(0);
    });

    it('passes through total, banned, avg_lifetime_days', async () => {
      mockComparable.mockResolvedValue({ total: 100, banned: 25, avgLifetimeDays: 14 });
      const result = await assess(mockPool, { domain: 'test.com' });
      expect(result.comparable_accounts.total).toBe(100);
      expect(result.comparable_accounts.banned).toBe(25);
      expect(result.comparable_accounts.avg_lifetime_days).toBe(14);
    });
  });

  // ── Recommendations ────────────────────────────────────────────────────────────

  describe('Recommendations', () => {
    it('suggests adding domain when no domain and no rules', async () => {
      const result = await assess(mockPool, { account_google_id: 'acc-1' });
      // no domain provided, rules engine returns [] → should suggest domain
      expect(result.recommendations.some(r => r.toLowerCase().includes('домен'))).toBe(true);
    });

    it('shows clean message when no risks found with domain', async () => {
      const result = await assess(mockPool, { domain: 'safe.com' });
      expect(result.recommendations.some(r => r.includes('рисков'))).toBe(true);
    });

    it('recommendations are an array', async () => {
      const result = await assess(mockPool, {});
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('recommendations contain no severity emoji prefixes', async () => {
      const result = await assess(mockPool, { domain: 'test.com', bin: '411111' });
      for (const rec of result.recommendations) {
        expect(rec).not.toMatch(/^[🚫⚠️ℹ️✅]/u);
      }
    });
  });

  // ── Extreme / edge values ────────────────────────────────────────────────────

  describe('Extreme input values', () => {
    it('handles domain age = 0 without error', async () => {
      mockDomainInfo.mockResolvedValue({ domainAgeDays: 0, safePageQualityScore: 0 });
      await expect(assess(mockPool, { domain: 'brand-new.com' })).resolves.toBeDefined();
    });

    it('handles ban rate = 100% without score exceeding 100', async () => {
      mockBinStats.mockResolvedValue({ total: 10, banned: 10, banRate: 100, avgLifetimeHours: 1 });
      const result = await assess(mockPool, { bin: '411111' });
      expect(result.risk_score).toBeLessThanOrEqual(100);
    });

    it('handles ban rate = 0% without score going below 0', async () => {
      mockBinStats.mockResolvedValue({ total: 1000, banned: 0, banRate: 0, avgLifetimeHours: 5000 });
      const result = await assess(mockPool, { bin: '411111' });
      expect(result.risk_score).toBeGreaterThanOrEqual(0);
    });

    it('handles null domain age gracefully', async () => {
      mockDomainInfo.mockResolvedValue({ domainAgeDays: null, safePageQualityScore: null });
      await expect(assess(mockPool, { domain: 'unknown-age.com' })).resolves.toBeDefined();
    });

    it('handles account age = 0 days (brand new)', async () => {
      mockAccountInfo.mockResolvedValue({ accountAgeDays: 0, hasActiveViolations: false });
      const result = await assess(mockPool, { account_google_id: 'acc-zero' });
      expect(result.risk_score).toBeLessThanOrEqual(100);
      expect(result.budget_recommendation).toBe(30);
    });

    it('handles geo-only assessment', async () => {
      mockGeo.mockResolvedValue({ banCount: 100, totalAccounts: 200, banRate: 50 });
      const result = await assess(mockPool, { geo: 'UA' });
      expect(result.factors.some(f => f.category === 'geo')).toBe(true);
    });

    it('handles vertical-only assessment', async () => {
      mockVertical.mockResolvedValue({ banCount: 80, totalAccounts: 100, banRate: 80, avgLifetimeHours: 10 });
      const result = await assess(mockPool, { vertical: 'gambling' });
      expect(result.factors.some(f => f.category === 'vertical')).toBe(true);
      expect(['high', 'critical']).toContain(result.risk_level);
    });
  });
});
