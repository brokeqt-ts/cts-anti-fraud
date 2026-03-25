import type pg from 'pg';

const VIEW_NAMES = [
  'mv_ban_timing_heatmap',
  'mv_consumable_scores',
  'mv_competitive_intelligence',
  'mv_account_risk_summary',
] as const;

export interface RefreshResult {
  viewName: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

export class MaterializedViewService {
  constructor(private pool: pg.Pool) {}

  /**
   * Refresh all materialized views concurrently.
   * Logs duration and errors for each view.
   */
  async refreshAll(): Promise<RefreshResult[]> {
    const results: RefreshResult[] = [];

    for (const viewName of VIEW_NAMES) {
      const result = await this.refreshView(viewName);
      results.push(result);
    }

    return results;
  }

  /**
   * Refresh a single materialized view.
   * Uses CONCURRENTLY to avoid blocking reads during refresh.
   */
  async refreshView(viewName: string): Promise<RefreshResult> {
    const start = Date.now();

    try {
      // Check if the view exists before attempting refresh
      const exists = await this.viewExists(viewName);
      if (!exists) {
        return {
          viewName,
          durationMs: Date.now() - start,
          success: false,
          error: `Materialized view ${viewName} does not exist`,
        };
      }

      await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
      const durationMs = Date.now() - start;

      console.log(`[mv-service] Refreshed ${viewName} in ${durationMs}ms`);

      return { viewName, durationMs, success: true };
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[mv-service] Failed to refresh ${viewName}: ${error}`);

      return { viewName, durationMs, success: false, error };
    }
  }

  /**
   * Get the approximate last refresh time for a view.
   * PostgreSQL doesn't track this natively, so we check pg_stat_user_tables.
   */
  async getLastRefreshTime(viewName: string): Promise<Date | null> {
    try {
      const result = await this.pool.query(
        `SELECT last_autovacuum AS last_refresh
         FROM pg_stat_user_tables
         WHERE relname = $1`,
        [viewName],
      );

      if (result.rows.length > 0 && result.rows[0]!['last_refresh']) {
        return new Date(result.rows[0]!['last_refresh'] as string);
      }
      return null;
    } catch {
      return null;
    }
  }

  private async viewExists(viewName: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM pg_matviews WHERE matviewname = $1`,
      [viewName],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
