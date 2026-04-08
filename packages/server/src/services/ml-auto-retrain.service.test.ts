import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

const { mockTrain } = vi.hoisted(() => ({
  mockTrain: vi.fn().mockResolvedValue({}),
}));

vi.mock('./ml/ml-client.js', () => ({ getMlClient: vi.fn(() => null) }));
vi.mock('../config/env.js', () => ({ env: { ML_SERVICE_URL: null } }));
vi.mock('./ml/ban-predictor.js', () => ({
  // Must use regular function — arrow functions cannot be called with `new`
  BanPredictor: vi.fn(function () { return { train: mockTrain }; }),
}));

import { recordBanForRetrain, runMlRetrain } from './ml-auto-retrain.service.js';
import { getMlClient } from './ml/ml-client.js';

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** Pool that returns a fixed counter value from _meta */
function makePool(counterValue: number | null = null): pg.Pool {
  return {
    query: vi.fn().mockImplementation((...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.includes('SELECT value FROM _meta')) {
        return Promise.resolve({
          rows: counterValue !== null ? [{ value: JSON.stringify(counterValue) }] : [],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as pg.Pool;
}

/** Pool that always rejects */
function brokenPool(): pg.Pool {
  return { query: vi.fn().mockRejectedValue(new Error('connection lost')) } as unknown as pg.Pool;
}

describe('ml-auto-retrain.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrain.mockResolvedValue({});
  });

  // ── runMlRetrain ─────────────────────────────────────────────────────────────

  describe('runMlRetrain', () => {
    it('logs the trigger reason', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await runMlRetrain(makePool(), mockLog, 'weekly_schedule');
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('weekly_schedule'));
    });

    it('resolves without throwing on success', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await expect(runMlRetrain(makePool(), mockLog, 'test')).resolves.toBeUndefined();
    });

    it('logs success message after TS predictor runs', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await runMlRetrain(makePool(), mockLog, 'test');
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('TS logistic regression retrain complete'));
      expect(mockLog.error).not.toHaveBeenCalled();
    });

    it('resolves without throwing when retrain fails', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await expect(runMlRetrain(brokenPool(), mockLog, 'test')).resolves.toBeUndefined();
    });

    it('logs error when retrain fails', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await runMlRetrain(brokenPool(), mockLog, 'test');
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Retrain failed'));
    });

    it('tries XGBoost client when available, falls back on error', async () => {
      const mockClient = { train: vi.fn().mockRejectedValue(new Error('XGBoost down')) };
      vi.mocked(getMlClient).mockReturnValue(mockClient as never);
      await runMlRetrain(makePool(), mockLog, 'test');
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('XGBoost retrain failed'));
      // Still completed via TS fallback
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('TS logistic regression retrain complete'));
    });

    it('succeeds via XGBoost when client returns result', async () => {
      const mockClient = {
        train: vi.fn().mockResolvedValue({ sample_count: 120, model_version: 'xgb_v1_123' }),
      };
      vi.mocked(getMlClient).mockReturnValue(mockClient as never);
      await runMlRetrain(makePool(), mockLog, 'test');
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('XGBoost retrain complete'));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('TS logistic'));
    });
  });

  // ── recordBanForRetrain ──────────────────────────────────────────────────────

  describe('recordBanForRetrain — counter increments', () => {
    it('increments from 0 when no _meta row exists', async () => {
      recordBanForRetrain(makePool(null), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('1/50'));
    });

    it('increments from existing value', async () => {
      recordBanForRetrain(makePool(10), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('11/50'));
    });

    it('increments correctly from 1', async () => {
      recordBanForRetrain(makePool(1), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('2/50'));
    });
  });

  describe('recordBanForRetrain — threshold logic', () => {
    it('does NOT trigger retrain at 49 bans', async () => {
      recordBanForRetrain(makePool(48), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
    });

    it('triggers retrain exactly at 50 (49 → 50)', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      recordBanForRetrain(makePool(49), mockLog);
      await new Promise(r => setTimeout(r, 100));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('50'));
    });

    it('triggers retrain when already over threshold (55 → 56)', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      recordBanForRetrain(makePool(55), mockLog);
      await new Promise(r => setTimeout(r, 100));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
    });

    it('does NOT trigger retrain at 24 bans', async () => {
      recordBanForRetrain(makePool(23), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
    });
  });

  describe('recordBanForRetrain — error handling', () => {
    it('logs warn on pool query failure, does not throw', async () => {
      recordBanForRetrain(brokenPool(), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Counter update failed'));
    });

    it('does not propagate errors to caller (fire-and-forget)', () => {
      // recordBanForRetrain is void — should never throw synchronously
      expect(() => recordBanForRetrain(brokenPool(), mockLog)).not.toThrow();
    });
  });
});
