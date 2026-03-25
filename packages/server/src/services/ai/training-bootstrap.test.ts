import { describe, it, expect } from 'vitest';
import { generateSyntheticSamples } from './training-bootstrap.js';
import { NUMERIC_FEATURES } from '../feature-extraction.service.js';

describe('Training Bootstrap', () => {
  describe('generateSyntheticSamples', () => {
    it('generates the requested number of samples', () => {
      const samples = generateSyntheticSamples(100);
      expect(samples).toHaveLength(100);
    });

    it('each sample has correct feature count', () => {
      const samples = generateSyntheticSamples(50);
      for (const sample of samples) {
        expect(sample.features).toHaveLength(NUMERIC_FEATURES.length);
      }
    });

    it('labels are binary (0 or 1)', () => {
      const samples = generateSyntheticSamples(200);
      for (const sample of samples) {
        expect([0, 1]).toContain(sample.label);
      }
    });

    it('produces roughly 30% ban rate', () => {
      const samples = generateSyntheticSamples(1000);
      const bannedCount = samples.filter(s => s.label === 1).length;
      const banRate = bannedCount / samples.length;
      // Allow for randomness: 20% to 40%
      expect(banRate).toBeGreaterThan(0.2);
      expect(banRate).toBeLessThan(0.4);
    });

    it('banned accounts have days_to_ban, active do not', () => {
      const samples = generateSyntheticSamples(200);
      for (const sample of samples) {
        if (sample.label === 1) {
          expect(sample.days_to_ban).toBeTypeOf('number');
          expect(sample.days_to_ban).toBeGreaterThan(0);
        } else {
          expect(sample.days_to_ban).toBeNull();
        }
      }
    });

    it('all features are numbers (no NaN)', () => {
      const samples = generateSyntheticSamples(100);
      for (const sample of samples) {
        for (const val of sample.features) {
          expect(typeof val).toBe('number');
          expect(isNaN(val)).toBe(false);
        }
      }
    });

    it('banned accounts tend to have more violations', () => {
      const samples = generateSyntheticSamples(500);
      const banned = samples.filter(s => s.label === 1);
      const active = samples.filter(s => s.label === 0);

      const avgBannedViolations = banned.reduce((s, b) => s + b.features[1]!, 0) / banned.length;
      const avgActiveViolations = active.reduce((s, a) => s + a.features[1]!, 0) / active.length;

      expect(avgBannedViolations).toBeGreaterThan(avgActiveViolations);
    });

    it('banned accounts tend to have higher BIN ban rate', () => {
      const samples = generateSyntheticSamples(500);
      const banned = samples.filter(s => s.label === 1);
      const active = samples.filter(s => s.label === 0);

      const binBanRateIdx = 10; // bin_ban_rate index
      const avgBannedBinRate = banned.reduce((s, b) => s + b.features[binBanRateIdx]!, 0) / banned.length;
      const avgActiveBinRate = active.reduce((s, a) => s + a.features[binBanRateIdx]!, 0) / active.length;

      expect(avgBannedBinRate).toBeGreaterThan(avgActiveBinRate);
    });

    it('handles zero count', () => {
      const samples = generateSyntheticSamples(0);
      expect(samples).toHaveLength(0);
    });
  });
});
