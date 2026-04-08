import { describe, it, expect, vi, beforeEach } from 'vitest';
import type pg from 'pg';

// vi.hoisted ensures these are defined before mock factories run (vi.mock is hoisted)
const { mockTrain } = vi.hoisted(() => ({
  mockTrain: vi.fn().mockResolvedValue({}),
}));

vi.mock('./ml/ml-client.js', () => ({ getMlClient: vi.fn(() => null) }));
vi.mock('../config/env.js', () => ({ env: { ML_SERVICE_URL: null } }));
vi.mock('./ml/ban-predictor.js', () => ({
  // Must use a regular function — arrow functions cannot be called with `new`
  BanPredictor: vi.fn(function () { return { train: mockTrain }; }),
}));

import { recordBanForRetrain, runMlRetrain } from './ml-auto-retrain.service.js';
import { getMlClient } from './ml/ml-client.js';

const mockLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

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

describe('ml-auto-retrain.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTrain.mockResolvedValue({});
  });

  describe('runMlRetrain', () => {
    it('starts retrain and logs reason', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await runMlRetrain(makePool(), mockLog, 'weekly_schedule');
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('weekly_schedule'));
    });

    it('resolves without throwing (success path)', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      await expect(runMlRetrain(makePool(), mockLog, 'test')).resolves.toBeUndefined();
      // No error logged on success path
      expect(mockLog.error).not.toHaveBeenCalled();
    });

    it('resolves without throwing even when retrain fails', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      // Corrupt pool to force failure
      const brokenPool = { query: vi.fn().mockRejectedValue(new Error('no connection')) } as unknown as pg.Pool;
      await expect(runMlRetrain(brokenPool, mockLog, 'test')).resolves.toBeUndefined();
      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('recordBanForRetrain', () => {
    it('increments counter from zero (no existing row)', async () => {
      recordBanForRetrain(makePool(null), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('1/50'));
    });

    it('increments counter from existing value', async () => {
      recordBanForRetrain(makePool(10), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.debug).toHaveBeenCalledWith(expect.stringContaining('11/50'));
    });

    it('does not trigger retrain when below threshold', async () => {
      recordBanForRetrain(makePool(10), mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
    });

    it('triggers retrain when counter reaches 50', async () => {
      vi.mocked(getMlClient).mockReturnValue(null);
      recordBanForRetrain(makePool(49), mockLog);
      await new Promise(r => setTimeout(r, 100));
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Threshold reached'));
    });

    it('logs warn if pool.query throws', async () => {
      const pool = { query: vi.fn().mockRejectedValue(new Error('conn lost')) } as unknown as pg.Pool;
      recordBanForRetrain(pool, mockLog);
      await new Promise(r => setTimeout(r, 20));
      expect(mockLog.warn).toHaveBeenCalled();
    });
  });
});
