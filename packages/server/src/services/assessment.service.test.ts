import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

// Mock the assessment repository
vi.mock('../repositories/assessment.repository.js', () => ({
  getDomainInfo: vi.fn(),
  getAccountInfo: vi.fn(),
  getBinStats: vi.fn(),
  getVerticalStats: vi.fn(),
  getGeoStats: vi.fn(),
  getComparableAccounts: vi.fn(),
}));

import * as assessmentRepo from '../repositories/assessment.repository.js';
import { assess } from './assessment.service.js';

const mockPool = {} as pg.Pool;

const mockGetDomainInfo = vi.mocked(assessmentRepo.getDomainInfo);
const mockGetAccountInfo = vi.mocked(assessmentRepo.getAccountInfo);
const mockGetBinStats = vi.mocked(assessmentRepo.getBinStats);
const mockGetVerticalStats = vi.mocked(assessmentRepo.getVerticalStats);
const mockGetGeoStats = vi.mocked(assessmentRepo.getGeoStats);
const mockGetComparableAccounts = vi.mocked(assessmentRepo.getComparableAccounts);

describe('assessment.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: return empty/zero data
    mockGetDomainInfo.mockResolvedValue({ domainAgeDays: null, safePageQualityScore: null });
    mockGetAccountInfo.mockResolvedValue(null);
    mockGetBinStats.mockResolvedValue({ total: 0, banned: 0, banRate: 0, avgLifetimeHours: 0 });
    mockGetVerticalStats.mockResolvedValue({ banCount: 0, totalAccounts: 0, banRate: 0, avgLifetimeHours: 0 });
    mockGetGeoStats.mockResolvedValue({ banCount: 0, totalAccounts: 0, banRate: 0 });
    mockGetComparableAccounts.mockResolvedValue({ total: 0, banned: 0, avgLifetimeDays: 0 });
  });

  it('returns a valid assessment structure', async () => {
    const result = await assess(mockPool, { domain: 'test.com' });

    expect(result).toHaveProperty('risk_score');
    expect(result).toHaveProperty('risk_level');
    expect(result).toHaveProperty('factors');
    expect(result).toHaveProperty('recommendations');
    expect(result).toHaveProperty('comparable_accounts');
    expect(result).toHaveProperty('budget_recommendation');
    expect(['low', 'medium', 'high', 'critical']).toContain(result.risk_level);
    expect(result.risk_score).toBeGreaterThanOrEqual(0);
    expect(result.risk_score).toBeLessThanOrEqual(100);
  });

  it('returns low risk for a healthy domain + account', async () => {
    mockGetDomainInfo.mockResolvedValue({ domainAgeDays: 90, safePageQualityScore: 85 });
    mockGetAccountInfo.mockResolvedValue({ accountAgeDays: 60, hasActiveViolations: false });
    mockGetBinStats.mockResolvedValue({ total: 50, banned: 2, banRate: 4, avgLifetimeHours: 500 });
    mockGetVerticalStats.mockResolvedValue({ banCount: 5, totalAccounts: 100, banRate: 5, avgLifetimeHours: 400 });
    mockGetGeoStats.mockResolvedValue({ banCount: 3, totalAccounts: 80, banRate: 3.8 });

    const result = await assess(mockPool, {
      domain: 'good-site.com',
      account_google_id: 'acc-123',
      bin: '411111',
      vertical: 'ecom',
      geo: 'US',
    });

    expect(result.risk_level).toBe('low');
    expect(result.risk_score).toBeLessThan(35);
  });

  it('returns critical risk when account has active violations', async () => {
    mockGetAccountInfo.mockResolvedValue({ accountAgeDays: 30, hasActiveViolations: true });

    const result = await assess(mockPool, { account_google_id: 'acc-bad' });

    expect(result.risk_score).toBeGreaterThanOrEqual(80);
    expect(result.risk_level).toBe('critical');
    expect(result.recommendations.some(r => r.includes('нарушения'))).toBe(true);
  });

  it('includes domain factor when domain is provided', async () => {
    mockGetDomainInfo.mockResolvedValue({ domainAgeDays: 5, safePageQualityScore: 30 });

    const result = await assess(mockPool, { domain: 'new-site.com', vertical: 'nutra' });

    const domainFactor = result.factors.find(f => f.category === 'domain');
    expect(domainFactor).toBeDefined();
    expect(domainFactor!.score).toBeGreaterThan(0);
  });

  it('includes bin factor when bin is provided', async () => {
    mockGetBinStats.mockResolvedValue({ total: 20, banned: 15, banRate: 75, avgLifetimeHours: 24 });

    const result = await assess(mockPool, { bin: '516732' });

    const binFactor = result.factors.find(f => f.category === 'bin');
    expect(binFactor).toBeDefined();
    expect(binFactor!.score).toBeGreaterThanOrEqual(75);
  });

  it('normalizes weights when only some factors are present', async () => {
    const result = await assess(mockPool, { domain: 'test.com' });

    // Only domain factor should be present
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0]!.category).toBe('domain');
  });

  it('returns budget recommendation for new accounts', async () => {
    mockGetAccountInfo.mockResolvedValue({ accountAgeDays: 3, hasActiveViolations: false });

    const result = await assess(mockPool, { account_google_id: 'acc-new' });

    expect(result.budget_recommendation).toBe(30);
  });

  it('returns null budget recommendation for mature accounts', async () => {
    mockGetAccountInfo.mockResolvedValue({ accountAgeDays: 90, hasActiveViolations: false });

    const result = await assess(mockPool, { account_google_id: 'acc-old' });

    expect(result.budget_recommendation).toBeNull();
  });

  it('populates comparable_accounts from repository data', async () => {
    mockGetComparableAccounts.mockResolvedValue({ total: 50, banned: 10, avgLifetimeDays: 45 });

    const result = await assess(mockPool, { domain: 'test.com', vertical: 'ecom' });

    expect(result.comparable_accounts.total).toBe(50);
    expect(result.comparable_accounts.banned).toBe(10);
    expect(result.comparable_accounts.ban_rate).toBe(20);
    expect(result.comparable_accounts.avg_lifetime_days).toBe(45);
  });

  it('bumps risk score to 80 when a block rule triggers', async () => {
    // Very low safe page score triggers block
    mockGetDomainInfo.mockResolvedValue({ domainAgeDays: 90, safePageQualityScore: 10 });

    const result = await assess(mockPool, { domain: 'sketchy.com' });

    expect(result.risk_score).toBeGreaterThanOrEqual(80);
    expect(result.risk_level).toBe('critical');
  });

  it('calls all repo functions in parallel for full request', async () => {
    await assess(mockPool, {
      domain: 'test.com',
      account_google_id: 'acc-1',
      bin: '411111',
      vertical: 'ecom',
      geo: 'US',
    });

    expect(mockGetDomainInfo).toHaveBeenCalledOnce();
    expect(mockGetAccountInfo).toHaveBeenCalledOnce();
    expect(mockGetBinStats).toHaveBeenCalledOnce();
    expect(mockGetVerticalStats).toHaveBeenCalledOnce();
    expect(mockGetGeoStats).toHaveBeenCalledOnce();
    expect(mockGetComparableAccounts).toHaveBeenCalledOnce();
  });

  it('skips repo calls for missing inputs', async () => {
    await assess(mockPool, { domain: 'test.com' });

    expect(mockGetDomainInfo).toHaveBeenCalledOnce();
    expect(mockGetAccountInfo).not.toHaveBeenCalled();
    expect(mockGetBinStats).not.toHaveBeenCalled();
    expect(mockGetVerticalStats).not.toHaveBeenCalled();
    expect(mockGetGeoStats).not.toHaveBeenCalled();
    expect(mockGetComparableAccounts).toHaveBeenCalledOnce();
  });
});
