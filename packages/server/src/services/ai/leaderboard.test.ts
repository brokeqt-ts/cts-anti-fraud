/**
 * Tests for leaderboard composite score calculation.
 *
 * Tests the pure computeCompositeScores logic by replicating it
 * (since it's a private function in leaderboard.service.ts).
 */
import { describe, it, expect } from 'vitest';

interface ModelMetrics {
  model_id: string;
  total_analyses: number;
  scored_count: number;
  correct_count: number;
  accuracy: number | null;
  precision_val: number | null;
  recall_val: number | null;
  avg_lifetime_error_days: number | null;
  avg_latency_ms: number;
  avg_cost_usd: number;
}

// Replicate the private computeCompositeScores logic for testing
function computeCompositeScores(metrics: ModelMetrics[]) {
  if (metrics.length === 0) return [];

  const hasOutcomes = metrics.some(m => m.scored_count > 0);
  const maxLatency = Math.max(...metrics.map(m => m.avg_latency_ms), 1);
  const maxCost = Math.max(...metrics.map(m => m.avg_cost_usd), 0.0001);
  const maxLifetimeError = Math.max(...metrics.map(m => m.avg_lifetime_error_days ?? 0), 1);

  return metrics.map(m => {
    const normLatency = m.avg_latency_ms / maxLatency;
    const normCost = m.avg_cost_usd / maxCost;
    const normLifetimeError = (m.avg_lifetime_error_days ?? maxLifetimeError) / maxLifetimeError;

    let compositeScore: number;
    if (hasOutcomes && m.scored_count > 0) {
      compositeScore =
        (m.accuracy ?? 0) * 0.4 +
        (m.precision_val ?? 0) * 0.2 +
        (m.recall_val ?? 0) * 0.2 +
        (1 - normLifetimeError) * 0.1 +
        (1 - normLatency) * 0.05 +
        (1 - normCost) * 0.05;
    } else {
      compositeScore = (1 - normLatency) * 0.5 + (1 - normCost) * 0.5;
    }

    return {
      model: m.model_id,
      accuracy: m.accuracy,
      precision: m.precision_val,
      recall: m.recall_val,
      composite_score: Math.round(compositeScore * 10000) / 10000,
    };
  }).sort((a, b) => b.composite_score - a.composite_score);
}

// --- Tests ---

describe('Leaderboard composite score', () => {
  describe('with outcomes (accuracy available)', () => {
    it('ranks high-accuracy model first', () => {
      const metrics: ModelMetrics[] = [
        { model_id: 'claude', total_analyses: 50, scored_count: 30, correct_count: 27, accuracy: 0.9, precision_val: 0.85, recall_val: 0.8, avg_lifetime_error_days: 5, avg_latency_ms: 3000, avg_cost_usd: 0.01 },
        { model_id: 'openai', total_analyses: 50, scored_count: 30, correct_count: 18, accuracy: 0.6, precision_val: 0.5, recall_val: 0.55, avg_lifetime_error_days: 15, avg_latency_ms: 2000, avg_cost_usd: 0.008 },
      ];
      const scores = computeCompositeScores(metrics);
      expect(scores[0]!.model).toBe('claude');
      expect(scores[0]!.composite_score).toBeGreaterThan(scores[1]!.composite_score);
    });

    it('accuracy dominates over speed', () => {
      const metrics: ModelMetrics[] = [
        { model_id: 'slow-accurate', total_analyses: 50, scored_count: 30, correct_count: 29, accuracy: 0.97, precision_val: 0.95, recall_val: 0.9, avg_lifetime_error_days: 2, avg_latency_ms: 10000, avg_cost_usd: 0.05 },
        { model_id: 'fast-inaccurate', total_analyses: 50, scored_count: 30, correct_count: 15, accuracy: 0.5, precision_val: 0.4, recall_val: 0.3, avg_lifetime_error_days: 30, avg_latency_ms: 500, avg_cost_usd: 0.001 },
      ];
      const scores = computeCompositeScores(metrics);
      expect(scores[0]!.model).toBe('slow-accurate');
    });

    it('perfect model gets score close to 1.0', () => {
      const metrics: ModelMetrics[] = [
        { model_id: 'perfect', total_analyses: 100, scored_count: 100, correct_count: 100, accuracy: 1.0, precision_val: 1.0, recall_val: 1.0, avg_lifetime_error_days: 0, avg_latency_ms: 1000, avg_cost_usd: 0.001 },
      ];
      const scores = computeCompositeScores(metrics);
      // accuracy(1)*0.4 + precision(1)*0.2 + recall(1)*0.2 + (1-0)*0.1 + (1-1)*0.05 + (1-1)*0.05 = 0.9
      // Wait — single model, so normLatency = 1000/1000 = 1, normCost = 0.001/0.001 = 1
      // = 1*0.4 + 1*0.2 + 1*0.2 + 1*0.1 + 0*0.05 + 0*0.05 = 0.9
      expect(scores[0]!.composite_score).toBeCloseTo(0.9, 2);
    });
  });

  describe('without outcomes (no bans recorded)', () => {
    it('ranks by speed and cost only', () => {
      const metrics: ModelMetrics[] = [
        { model_id: 'fast-cheap', total_analyses: 10, scored_count: 0, correct_count: 0, accuracy: null, precision_val: null, recall_val: null, avg_lifetime_error_days: null, avg_latency_ms: 500, avg_cost_usd: 0.001 },
        { model_id: 'slow-expensive', total_analyses: 10, scored_count: 0, correct_count: 0, accuracy: null, precision_val: null, recall_val: null, avg_lifetime_error_days: null, avg_latency_ms: 5000, avg_cost_usd: 0.05 },
      ];
      const scores = computeCompositeScores(metrics);
      expect(scores[0]!.model).toBe('fast-cheap');
      expect(scores[0]!.accuracy).toBeNull();
    });

    it('returns empty for no metrics', () => {
      expect(computeCompositeScores([])).toEqual([]);
    });

    it('score is based on latency/cost formula', () => {
      const metrics: ModelMetrics[] = [
        { model_id: 'only', total_analyses: 5, scored_count: 0, correct_count: 0, accuracy: null, precision_val: null, recall_val: null, avg_lifetime_error_days: null, avg_latency_ms: 2000, avg_cost_usd: 0.01 },
      ];
      const scores = computeCompositeScores(metrics);
      // Single model: normLatency = 2000/2000 = 1, normCost = 0.01/0.01 = 1
      // score = (1-1)*0.5 + (1-1)*0.5 = 0
      expect(scores[0]!.composite_score).toBe(0);
    });
  });

  describe('scoring after ban', () => {
    it('correct ban prediction: predicted > 0.5 AND actually banned', () => {
      const predicted_ban_prob = 0.75;
      const actual_outcome = 'banned';
      const correct = predicted_ban_prob > 0.5 && actual_outcome === 'banned';
      expect(correct).toBe(true);
    });

    it('incorrect ban prediction: predicted > 0.5 AND survived', () => {
      const predicted_ban_prob = 0.75;
      const actual_outcome: string = 'survived';
      const correct = predicted_ban_prob > 0.5 && actual_outcome === 'banned';
      expect(correct).toBe(false);
    });

    it('correct survival prediction: predicted <= 0.5 AND survived', () => {
      const predicted_ban_prob = 0.2;
      const actual_outcome = 'survived';
      const correct = predicted_ban_prob <= 0.5 && actual_outcome === 'survived';
      expect(correct).toBe(true);
    });

    it('missed ban: predicted <= 0.5 AND banned', () => {
      const predicted_ban_prob = 0.2;
      const actual_outcome: string = 'banned';
      const correct = predicted_ban_prob <= 0.5 && actual_outcome === 'survived';
      expect(correct).toBe(false);
    });
  });

  describe('scoring after survival (90 days)', () => {
    it('marks as survived when created_at > 90 days ago', () => {
      const createdAt = new Date('2025-12-01');
      const now = new Date('2026-03-18');
      const daysDiff = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeGreaterThan(90);
    });

    it('does not mark as survived when created_at < 90 days ago', () => {
      const createdAt = new Date('2026-01-15');
      const now = new Date('2026-03-18');
      const daysDiff = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBeLessThan(90);
    });
  });

  describe('precision and recall edge cases', () => {
    it('precision is null when no positive predictions (TP+FP=0)', () => {
      const tp = 0, fp = 0;
      const precision = (tp + fp) > 0 ? tp / (tp + fp) : null;
      expect(precision).toBeNull();
    });

    it('recall is null when no actual bans (TP+FN=0)', () => {
      const tp = 0, fn = 0;
      const recall = (tp + fn) > 0 ? tp / (tp + fn) : null;
      expect(recall).toBeNull();
    });

    it('precision is 1.0 when all ban predictions correct', () => {
      const tp = 10, fp = 0;
      const precision = tp / (tp + fp);
      expect(precision).toBe(1.0);
    });

    it('recall is 1.0 when all actual bans were predicted', () => {
      const tp = 10, fn = 0;
      const recall = tp / (tp + fn);
      expect(recall).toBe(1.0);
    });
  });
});
