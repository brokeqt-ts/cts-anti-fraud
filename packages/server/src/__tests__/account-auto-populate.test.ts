import { describe, it, expect, vi } from 'vitest';
import { updateAccountAge, updatePaymentLimits } from '../services/account-auto-populate.js';

// Mock pg.Pool
function createMockPool(queryResults: Record<string, { rows: Record<string, unknown>[]; rowCount: number }>) {
  const queryFn = vi.fn(async (sql: string) => {
    // Match by first keyword in SQL
    for (const [key, value] of Object.entries(queryResults)) {
      if (sql.includes(key)) return value;
    }
    return { rows: [], rowCount: 0 };
  });
  return { query: queryFn } as unknown as import('pg').Pool;
}

describe('Account Auto-Populate', () => {
  // ── updateAccountAge ──────────────────────────────────────────────────────

  describe('updateAccountAge', () => {
    it('calculates age from first_seen timestamp', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const pool = createMockPool({
        'MIN(created_at)': { rows: [{ first_seen: threeDaysAgo }], rowCount: 1 },
        'UPDATE accounts': { rows: [], rowCount: 1 },
      });

      const age = await updateAccountAge(pool, 'acc-123');
      expect(age).toBe(3);
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('returns null when no raw_payloads exist', async () => {
      const pool = createMockPool({
        'MIN(created_at)': { rows: [{ first_seen: null }], rowCount: 1 },
      });

      const age = await updateAccountAge(pool, 'acc-123');
      expect(age).toBeNull();
    });

    it('handles zero-day account', async () => {
      const now = new Date().toISOString();
      const pool = createMockPool({
        'MIN(created_at)': { rows: [{ first_seen: now }], rowCount: 1 },
        'UPDATE accounts': { rows: [], rowCount: 1 },
      });

      const age = await updateAccountAge(pool, 'acc-123');
      expect(age).toBe(0);
    });
  });

  // ── updatePaymentLimits ───────────────────────────────────────────────────

  describe('updatePaymentLimits', () => {
    it('extracts threshold_micros and converts to currency units', async () => {
      const pool = createMockPool({
        'threshold_micros': { rows: [{ threshold_micros: '50000000' }], rowCount: 1 },
        'UPDATE accounts': { rows: [], rowCount: 1 },
      });

      const limit = await updatePaymentLimits(pool, 'acc-123');
      expect(limit).toBe(50); // 50000000 / 1000000
    });

    it('handles numeric threshold_micros value', async () => {
      const pool = createMockPool({
        'threshold_micros': { rows: [{ threshold_micros: 100000000 }], rowCount: 1 },
        'UPDATE accounts': { rows: [], rowCount: 1 },
      });

      const limit = await updatePaymentLimits(pool, 'acc-123');
      expect(limit).toBe(100);
    });

    it('returns null when no billing info exists', async () => {
      const pool = createMockPool({
        'threshold_micros': { rows: [], rowCount: 0 },
      });

      const limit = await updatePaymentLimits(pool, 'acc-123');
      expect(limit).toBeNull();
    });

    it('returns null for zero threshold', async () => {
      const pool = createMockPool({
        'threshold_micros': { rows: [{ threshold_micros: 0 }], rowCount: 1 },
      });

      const limit = await updatePaymentLimits(pool, 'acc-123');
      expect(limit).toBeNull();
    });

    it('returns null for null threshold', async () => {
      const pool = createMockPool({
        'threshold_micros': { rows: [{ threshold_micros: null }], rowCount: 1 },
      });

      const limit = await updatePaymentLimits(pool, 'acc-123');
      expect(limit).toBeNull();
    });
  });
});
