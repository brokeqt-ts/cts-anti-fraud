import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaterializedViewService } from './materialized-view.service.js';

function createMockPool() {
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql.trim());
      // pg_matviews check — view exists
      if (sql.includes('pg_matviews')) {
        return { rowCount: 1, rows: [{ '1': 1 }] };
      }
      // REFRESH command
      if (sql.includes('REFRESH')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    }),
  };
  return { pool: pool as unknown as import('pg').Pool, queries };
}

describe('MaterializedViewService', () => {
  let service: MaterializedViewService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    mockPool = createMockPool();
    service = new MaterializedViewService(mockPool.pool);
  });

  it('refreshAll refreshes all 4 materialized views', async () => {
    const results = await service.refreshAll();

    expect(results).toHaveLength(4);
    expect(results.every(r => r.success)).toBe(true);

    // Verify each view was checked for existence and refreshed
    const refreshCalls = mockPool.queries.filter(q => q.includes('REFRESH'));
    expect(refreshCalls).toHaveLength(4);
    expect(refreshCalls[0]).toContain('mv_ban_timing_heatmap');
    expect(refreshCalls[1]).toContain('mv_consumable_scores');
    expect(refreshCalls[2]).toContain('mv_competitive_intelligence');
    expect(refreshCalls[3]).toContain('mv_account_risk_summary');
  });

  it('refreshAll uses CONCURRENTLY for non-blocking refresh', async () => {
    await service.refreshAll();

    const refreshCalls = mockPool.queries.filter(q => q.includes('REFRESH'));
    for (const sql of refreshCalls) {
      expect(sql).toContain('CONCURRENTLY');
    }
  });

  it('refreshView returns error when view does not exist', async () => {
    const missingPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('pg_matviews')) {
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      }),
    } as unknown as import('pg').Pool;

    const svc = new MaterializedViewService(missingPool);
    const result = await svc.refreshView('mv_nonexistent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('refreshView records duration', async () => {
    const result = await service.refreshView('mv_ban_timing_heatmap');

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.viewName).toBe('mv_ban_timing_heatmap');
  });

  it('refreshView handles query errors gracefully', async () => {
    const errorPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('pg_matviews')) {
          return { rowCount: 1, rows: [{ '1': 1 }] };
        }
        throw new Error('database connection lost');
      }),
    } as unknown as import('pg').Pool;

    const svc = new MaterializedViewService(errorPool);
    const result = await svc.refreshView('mv_ban_timing_heatmap');

    expect(result.success).toBe(false);
    expect(result.error).toContain('database connection lost');
  });
});
