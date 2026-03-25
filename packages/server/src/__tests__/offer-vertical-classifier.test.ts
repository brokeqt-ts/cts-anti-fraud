import { describe, it, expect } from 'vitest';
import { classifyText, classifyDomain, resolveVertical } from '../services/offer-vertical-classifier.js';

describe('Offer Vertical Classifier', () => {
  // ── classifyText ──────────────────────────────────────────────────────────

  describe('classifyText', () => {
    it('detects gambling keywords', () => {
      const signals = classifyText('Win Big at Casino Slots Online');
      expect(signals.some(s => s.vertical === 'gambling')).toBe(true);
    });

    it('detects nutra keywords', () => {
      const signals = classifyText('Best Weight Loss Supplement - Keto Diet Pills');
      expect(signals.some(s => s.vertical === 'nutra')).toBe(true);
    });

    it('detects crypto keywords', () => {
      const signals = classifyText('Bitcoin Trading Platform - Buy Crypto');
      expect(signals.some(s => s.vertical === 'crypto')).toBe(true);
    });

    it('detects dating keywords', () => {
      const signals = classifyText('Meet Singles Near You - Dating Online');
      expect(signals.some(s => s.vertical === 'dating')).toBe(true);
    });

    it('detects sweepstakes keywords', () => {
      const signals = classifyText('Congratulations! You Won a Prize - Sweepstake');
      expect(signals.some(s => s.vertical === 'sweepstakes')).toBe(true);
    });

    it('detects ecom keywords', () => {
      const signals = classifyText('Shop Now - Free Shipping on All Orders');
      expect(signals.some(s => s.vertical === 'ecom')).toBe(true);
    });

    it('detects finance keywords', () => {
      const signals = classifyText('Get a Personal Loan - Low Interest Mortgage Rates');
      expect(signals.some(s => s.vertical === 'finance')).toBe(true);
    });

    it('returns empty for generic text', () => {
      const signals = classifyText('Welcome to our website');
      expect(signals).toHaveLength(0);
    });

    it('handles multiple matches increasing confidence', () => {
      const signals = classifyText('Casino Poker Roulette Gambling Slots');
      const gamblingSignals = signals.filter(s => s.vertical === 'gambling');
      expect(gamblingSignals.length).toBeGreaterThan(0);
      expect(gamblingSignals[0]!.confidence).toBeGreaterThan(0.5);
    });
  });

  // ── classifyDomain ────────────────────────────────────────────────────────

  describe('classifyDomain', () => {
    it('detects gambling from domain', () => {
      const signals = classifyDomain('best-casino-online.com');
      expect(signals.some(s => s.vertical === 'gambling')).toBe(true);
    });

    it('detects crypto from domain', () => {
      const signals = classifyDomain('https://crypto-trade-platform.io/signup');
      expect(signals.some(s => s.vertical === 'crypto')).toBe(true);
    });

    it('detects dating from domain', () => {
      const signals = classifyDomain('dating-singles-near-you.com');
      expect(signals.some(s => s.vertical === 'dating')).toBe(true);
    });

    it('returns empty for generic domain', () => {
      const signals = classifyDomain('example.com');
      expect(signals).toHaveLength(0);
    });
  });

  // ── resolveVertical ───────────────────────────────────────────────────────

  describe('resolveVertical', () => {
    it('returns other with 0 confidence for no signals', () => {
      const result = resolveVertical([]);
      expect(result.vertical).toBe('other');
      expect(result.confidence).toBe(0);
    });

    it('picks the vertical with highest total confidence', () => {
      const result = resolveVertical([
        { source: 'text', vertical: 'gambling', confidence: 0.5, detail: 'casino' },
        { source: 'text', vertical: 'gambling', confidence: 0.4, detail: 'slots' },
        { source: 'text', vertical: 'nutra', confidence: 0.3, detail: 'supplement' },
      ]);
      expect(result.vertical).toBe('gambling');
    });

    it('returns other when all confidence is too low', () => {
      const result = resolveVertical([
        { source: 'text', vertical: 'gambling', confidence: 0.1, detail: 'casino' },
      ]);
      // 0.1 / 2 = 0.05, below 0.3 threshold
      expect(result.vertical).toBe('other');
    });

    it('caps confidence at 1.0', () => {
      const result = resolveVertical([
        { source: 'text', vertical: 'gambling', confidence: 0.9, detail: 'casino' },
        { source: 'text', vertical: 'gambling', confidence: 0.9, detail: 'slots' },
        { source: 'text', vertical: 'gambling', confidence: 0.9, detail: 'poker' },
      ]);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('preserves all signals in result', () => {
      const signals = [
        { source: 'text', vertical: 'crypto' as const, confidence: 0.5, detail: 'bitcoin' },
        { source: 'domain', vertical: 'crypto' as const, confidence: 0.6, detail: 'crypto domain' },
      ];
      const result = resolveVertical(signals);
      expect(result.signals).toHaveLength(2);
    });
  });
});
