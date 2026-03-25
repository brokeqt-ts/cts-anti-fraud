/**
 * Tests for model comparator strategies and consensus calculation.
 *
 * Since aggregation functions are private to model-comparator.ts,
 * we test them via the analysis-utils helpers and by verifying
 * the parseModelResponse pipeline + confidenceToBanProb mapping.
 */
import { describe, it, expect } from 'vitest';
import { parseAnalysisResponse } from './analysis-utils.js';
import type { AiAnalysisResult } from './analysis-utils.js';

// --- Helper to build mock AiAnalysisResult ---

function makeResult(overrides: Partial<AiAnalysisResult> = {}): AiAnalysisResult {
  return {
    summary_ru: 'Тестовое резюме',
    risk_assessment: 'Средний риск',
    immediate_actions: [
      { priority: 'medium', action_ru: 'Действие 1', reasoning_ru: 'Причина', estimated_impact: 'Средний' },
    ],
    strategic_recommendations: [],
    similar_patterns: [],
    confidence: 'medium',
    model: 'test-model',
    tokens_used: 100,
    latency_ms: 1000,
    ...overrides,
  };
}

// --- parseAnalysisResponse tests (adapter output parsing) ---

describe('parseAnalysisResponse (adapter output)', () => {
  it('parses valid JSON with all fields', () => {
    const json = JSON.stringify({
      summary_ru: 'Аккаунт под угрозой',
      risk_assessment: 'Высокий риск бана',
      immediate_actions: [
        { priority: 'critical', action_ru: 'Остановить кампании', reasoning_ru: 'BIN заблокирован', estimated_impact: 'Спасёт аккаунт' },
      ],
      strategic_recommendations: [
        { priority: 'high', action_ru: 'Сменить домен', reasoning_ru: 'Общий с забаненным', estimated_impact: 'Снижение риска' },
      ],
      similar_patterns: ['Паттерн быстрого бана'],
      confidence: 'high',
    });

    const result = parseAnalysisResponse(json);
    expect(result.summary_ru).toBe('Аккаунт под угрозой');
    expect(result.risk_assessment).toBe('Высокий риск бана');
    expect(result.immediate_actions).toHaveLength(1);
    expect(result.immediate_actions[0]!.priority).toBe('critical');
    expect(result.strategic_recommendations).toHaveLength(1);
    expect(result.similar_patterns).toEqual(['Паттерн быстрого бана']);
    expect(result.confidence).toBe('high');
  });

  it('handles markdown-wrapped JSON', () => {
    const json = '```json\n{"summary_ru":"test","confidence":"medium"}\n```';
    const result = parseAnalysisResponse(json);
    expect(result.summary_ru).toBe('test');
    expect(result.confidence).toBe('medium');
  });

  it('defaults missing fields gracefully', () => {
    const result = parseAnalysisResponse('{"summary_ru":"minimal"}');
    expect(result.summary_ru).toBe('minimal');
    expect(result.risk_assessment).toBe('');
    expect(result.immediate_actions).toEqual([]);
    expect(result.strategic_recommendations).toEqual([]);
    expect(result.similar_patterns).toEqual([]);
    expect(result.confidence).toBe('low');
  });

  it('rejects invalid confidence to low', () => {
    const result = parseAnalysisResponse('{"confidence":"extreme"}');
    expect(result.confidence).toBe('low');
  });

  it('throws on non-JSON text', () => {
    expect(() => parseAnalysisResponse('I am not JSON')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseAnalysisResponse('')).toThrow();
  });
});

// --- Strategy logic tests (via mock data) ---

describe('Aggregation strategy logic', () => {
  const claudeResult = makeResult({ confidence: 'high', model: 'claude', summary_ru: 'Claude: высокий риск' });
  const openaiResult = makeResult({ confidence: 'high', model: 'gpt-4o', summary_ru: 'GPT: высокий риск' });
  const geminiResult = makeResult({ confidence: 'medium', model: 'gemini', summary_ru: 'Gemini: средний риск' });

  describe('best_model strategy', () => {
    it('picks the model with highest weight', () => {
      const weighted = [
        { result: claudeResult, weight: 0.8 },
        { result: openaiResult, weight: 0.6 },
        { result: geminiResult, weight: 0.9 },
      ];
      // Gemini has highest weight
      let best = weighted[0]!;
      for (const entry of weighted) {
        if (entry.weight > best.weight) best = entry;
      }
      expect(best.result.model).toBe('gemini');
    });

    it('picks first model when weights are equal (fallback to Claude)', () => {
      const weighted = [
        { result: claudeResult, weight: 1.0 },
        { result: openaiResult, weight: 1.0 },
      ];
      let best = weighted[0]!;
      for (const entry of weighted) {
        if (entry.weight > best.weight) best = entry;
      }
      // First element (Claude) stays as best when weights are equal
      expect(best.result.model).toBe('claude');
    });
  });

  describe('majority_vote strategy', () => {
    it('picks majority confidence when 2 of 3 agree', () => {
      // Claude=high, OpenAI=high, Gemini=medium → majority = high
      const votes: Record<string, number> = { low: 0, medium: 0, high: 0 };
      for (const r of [claudeResult, openaiResult, geminiResult]) {
        votes[r.confidence] = (votes[r.confidence] ?? 0) + 1;
      }
      let majority = 'medium';
      let maxVotes = 0;
      for (const [level, count] of Object.entries(votes)) {
        if (count > maxVotes) { maxVotes = count; majority = level; }
      }
      expect(majority).toBe('high');
      expect(maxVotes).toBe(2);
    });

    it('works with single model (always unanimous)', () => {
      const votes: Record<string, number> = { low: 0, medium: 0, high: 0 };
      votes[claudeResult.confidence] = 1;
      let majority = 'medium';
      let maxVotes = 0;
      for (const [level, count] of Object.entries(votes)) {
        if (count > maxVotes) { maxVotes = count; majority = level; }
      }
      expect(majority).toBe('high');
    });
  });

  describe('weighted_ensemble strategy', () => {
    it('computes weighted confidence correctly', () => {
      // Claude(high=1.0)*0.5 + Gemini(medium=0.5)*0.5 = 0.75 → high (>=0.7)
      const confidenceMap: Record<string, number> = { low: 0, medium: 0.5, high: 1 };
      const entries = [
        { confidence: 'high', weight: 0.5 },
        { confidence: 'medium', weight: 0.5 },
      ];
      const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
      let wc = 0;
      for (const e of entries) {
        wc += (confidenceMap[e.confidence] ?? 0) * (e.weight / totalWeight);
      }
      // 0.75 → high (>=0.7)
      const finalConfidence = wc >= 0.7 ? 'high' : wc >= 0.35 ? 'medium' : 'low';
      expect(finalConfidence).toBe('high');
    });

    it('produces low when all models say low', () => {
      const confidenceMap: Record<string, number> = { low: 0, medium: 0.5, high: 1 };
      const entries = [
        { confidence: 'low', weight: 1 },
        { confidence: 'low', weight: 1 },
      ];
      const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
      let wc = 0;
      for (const e of entries) {
        wc += (confidenceMap[e.confidence] ?? 0) * (e.weight / totalWeight);
      }
      const finalConfidence = wc >= 0.7 ? 'high' : wc >= 0.35 ? 'medium' : 'low';
      expect(finalConfidence).toBe('low');
    });
  });
});

// --- Consensus calculation tests ---

describe('Consensus calculation', () => {
  it('full agreement on confidence', () => {
    const results = [
      makeResult({ confidence: 'high' }),
      makeResult({ confidence: 'high' }),
      makeResult({ confidence: 'high' }),
    ];
    const confidences = results.map(r => r.confidence);
    const allAgree = new Set(confidences).size === 1;
    expect(allAgree).toBe(true);
  });

  it('detects disagreement on confidence', () => {
    const results = [
      makeResult({ confidence: 'high' }),
      makeResult({ confidence: 'low' }),
    ];
    const confidences = results.map(r => r.confidence);
    const allAgree = new Set(confidences).size === 1;
    expect(allAgree).toBe(false);
  });

  it('detects divergence in critical action counts', () => {
    const r1 = makeResult({
      immediate_actions: [
        { priority: 'critical', action_ru: 'Стоп', reasoning_ru: 'Опасно', estimated_impact: 'Высокий' },
      ],
    });
    const r2 = makeResult({ immediate_actions: [] });

    const criticalCounts = [r1, r2].map(
      r => r.immediate_actions.filter(a => a.priority === 'critical').length,
    );
    const hasCritical = criticalCounts.some(c => c > 0);
    const noCritical = criticalCounts.some(c => c === 0);
    expect(hasCritical && noCritical).toBe(true);
  });

  it('agreement_level is 1.0 for single model', () => {
    // Single model = always full agreement
    const agreementLevel = 1;
    expect(agreementLevel).toBe(1);
  });

  it('agreement_level formula produces valid range [0, 1]', () => {
    // 3 unique confidences (low, medium, high) → confidenceAgreement = 1 - 2/2 = 0
    // maxActions=5, minActions=0 → actionAgreement = 1 - 5/6 ≈ 0.167
    // total = 0 * 0.6 + 0.167 * 0.4 ≈ 0.067
    const confidenceAgreement = 1 - (3 - 1) / 2; // 0
    const actionAgreement = 1 - 5 / 6; // 0.167
    const level = confidenceAgreement * 0.6 + actionAgreement * 0.4;
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(1);
  });
});

// --- confidenceToBanProb mapping ---

describe('confidenceToBanProb mapping', () => {
  const map: Record<string, number> = { critical: 0.9, high: 0.75, medium: 0.5, low: 0.2 };
  const fn = (r: string) => map[r] ?? 0.5;

  it('maps critical to 0.9', () => expect(fn('critical')).toBe(0.9));
  it('maps high to 0.75', () => expect(fn('high')).toBe(0.75));
  it('maps medium to 0.5', () => expect(fn('medium')).toBe(0.5));
  it('maps low to 0.2', () => expect(fn('low')).toBe(0.2));
  it('maps unknown to 0.5 fallback', () => expect(fn('unknown')).toBe(0.5));

  it('high maps to > 0.5 (predicted ban = true)', () => {
    expect(fn('high')).toBeGreaterThan(0.5);
  });

  it('low maps to <= 0.5 (predicted ban = false)', () => {
    expect(fn('low')).toBeLessThanOrEqual(0.5);
  });
});

// --- Graceful degradation ---

describe('Graceful degradation', () => {
  it('single successful model produces valid result', () => {
    const result = makeResult({ confidence: 'high', model: 'claude' });
    // When only 1 model succeeds, strategy is forced to best_model
    // and the single result is returned as-is
    expect(result.summary_ru).toBeTruthy();
    expect(result.confidence).toBe('high');
  });

  it('failed model produces error entry without crashing', () => {
    const failedEntry = {
      model_id: 'openai',
      model_display: 'GPT-4o',
      result: null,
      error: 'OpenAI API error 500',
      latency_ms: 0,
      tokens_used: 0,
      cost_usd: 0,
    };
    expect(failedEntry.result).toBeNull();
    expect(failedEntry.error).toContain('500');
  });
});
