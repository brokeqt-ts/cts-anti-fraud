import { describe, it, expect } from 'vitest';
import { calculateHealthScore } from '../health-score.service.js';

const healthy = {
  status: 'active',
  banCount: 0,
  recentBanDays: null,
  hasSuspendedSignal: false,
  policyViolationCount: 0,
  accountAgeDays: 365,
  verificationStatus: 'verified',
  campaignCount: 5,
  offerVertical: 'ecom',
};

describe('Health Score Calculation', () => {
  it('healthy account scores 100', () => {
    expect(calculateHealthScore(healthy)).toBe(100);
  });

  it('banned account scores very low', () => {
    const score = calculateHealthScore({ ...healthy, status: 'banned' });
    expect(score).toBeLessThanOrEqual(20);
  });

  it('suspended account scores low', () => {
    const score = calculateHealthScore({ ...healthy, status: 'suspended' });
    expect(score).toBeLessThanOrEqual(40);
  });

  it('under_review has moderate penalty', () => {
    const score = calculateHealthScore({ ...healthy, status: 'under_review' });
    expect(score).toBe(80);
  });

  it('suspended signal on active account adds penalty', () => {
    const score = calculateHealthScore({ ...healthy, hasSuspendedSignal: true });
    expect(score).toBe(70);
  });

  it('each ban reduces score', () => {
    const score1 = calculateHealthScore({ ...healthy, banCount: 1, recentBanDays: 60 });
    const score2 = calculateHealthScore({ ...healthy, banCount: 3, recentBanDays: 60 });
    expect(score1).toBeGreaterThan(score2);
    expect(score1).toBe(85); // -15
    expect(score2).toBe(55); // -45
  });

  it('recent ban adds extra penalty', () => {
    const old = calculateHealthScore({ ...healthy, banCount: 1, recentBanDays: 60 });
    const recent = calculateHealthScore({ ...healthy, banCount: 1, recentBanDays: 3 });
    expect(recent).toBeLessThan(old);
    expect(old - recent).toBe(15); // extra -15 for <7 days
  });

  it('policy violations reduce score', () => {
    const score = calculateHealthScore({ ...healthy, policyViolationCount: 3 });
    expect(score).toBe(85); // -15 (3 * 5)
  });

  it('policy violations capped at -25', () => {
    const score = calculateHealthScore({ ...healthy, policyViolationCount: 10 });
    expect(score).toBe(75); // max -25
  });

  it('young account (<3 days) penalized', () => {
    const score = calculateHealthScore({ ...healthy, accountAgeDays: 1 });
    expect(score).toBe(85); // -15
  });

  it('gambling vertical penalized', () => {
    const score = calculateHealthScore({ ...healthy, offerVertical: 'gambling' });
    expect(score).toBe(90); // -10
  });

  it('ecom vertical not penalized', () => {
    const score = calculateHealthScore({ ...healthy, offerVertical: 'ecom' });
    expect(score).toBe(100);
  });

  it('no verification penalized', () => {
    const score = calculateHealthScore({ ...healthy, verificationStatus: 'not_started' });
    expect(score).toBe(95); // -5
  });

  it('failed verification heavily penalized', () => {
    const score = calculateHealthScore({ ...healthy, verificationStatus: 'failed' });
    expect(score).toBe(85); // -15
  });

  it('no campaigns penalized', () => {
    const score = calculateHealthScore({ ...healthy, campaignCount: 0 });
    expect(score).toBe(95); // -5
  });

  it('score never goes below 0', () => {
    const worst = calculateHealthScore({
      status: 'banned',
      banCount: 10,
      recentBanDays: 1,
      hasSuspendedSignal: true,
      policyViolationCount: 20,
      accountAgeDays: 0,
      verificationStatus: 'failed',
      campaignCount: 0,
      offerVertical: 'gambling',
    });
    expect(worst).toBe(0);
  });

  it('multiple factors compound correctly', () => {
    const score = calculateHealthScore({
      ...healthy,
      banCount: 1,
      recentBanDays: 60,
      policyViolationCount: 2,
      offerVertical: 'gambling',
    });
    // -15 (ban) -10 (violation) -10 (vertical) = 65
    expect(score).toBe(65);
  });

  it('clear separation between safe and risky accounts', () => {
    const safe = calculateHealthScore(healthy);
    const risky = calculateHealthScore({
      status: 'active',
      banCount: 2,
      recentBanDays: 5,
      hasSuspendedSignal: true,
      policyViolationCount: 3,
      accountAgeDays: 10,
      verificationStatus: 'not_started',
      campaignCount: 1,
      offerVertical: 'gambling',
    });
    expect(safe).toBe(100);
    expect(risky).toBeLessThan(30);
    expect(safe - risky).toBeGreaterThan(70);
  });
});
