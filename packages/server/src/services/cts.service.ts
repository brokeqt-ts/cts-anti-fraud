import type pg from 'pg';

// ─── Adapter interfaces ─────────────────────────────────────────────────────

/**
 * External CTS system adapter interface.
 *
 * Implement this interface to integrate with a specific CTS backend.
 * Default implementation: MockCTSAdapter (returns realistic data for development).
 * Swap in a real adapter by setting CTS_API_URL and CTS_API_KEY env vars.
 */
export interface CTSAdapter {
  fetchSites(): Promise<CTSSiteExternal[]>;
  pushEvent(event: CTSEvent): Promise<void>;
  fetchTraffic(siteId: string, from: Date, to: Date): Promise<TrafficData>;
}

export interface CTSSiteExternal {
  externalId: string;
  domain: string;
  name?: string;
  status?: string;
}

export interface CTSEvent {
  type: 'ban' | 'warning' | 'account_linked' | 'account_unlinked';
  domain: string;
  accountGoogleId?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

export interface TrafficData {
  siteId: string;
  period: { from: string; to: string };
  daily: TrafficDayEntry[];
  totals: {
    visits: number;
    unique_visitors: number;
    page_views: number;
    bounce_rate: number;
    avg_duration_seconds: number;
  };
}

export interface TrafficDayEntry {
  date: string;
  visits: number;
  unique_visitors: number;
  page_views: number;
  bounce_rate: number;
}

// ─── Mock adapter ───────────────────────────────────────────────────────────

/**
 * Mock CTS adapter for development.
 *
 * Returns realistic data when the real CTS API is not configured.
 * Replace with a real adapter when CTS_API_URL/CTS_API_KEY are set.
 */
export class MockCTSAdapter implements CTSAdapter {
  async fetchSites(): Promise<CTSSiteExternal[]> {
    return [
      { externalId: 'cts-001', domain: 'lucky-spin.bet', name: 'Lucky Spin', status: 'active' },
      { externalId: 'cts-002', domain: 'slim-fast-now.com', name: 'Slim Fast', status: 'active' },
      { externalId: 'cts-003', domain: 'crypto-gains.io', name: 'CryptoGains', status: 'paused' },
    ];
  }

  async pushEvent(_event: CTSEvent): Promise<void> {
    console.log('[cts-adapter-mock] pushEvent called (no-op in mock)');
  }

  async fetchTraffic(siteId: string, from: Date, to: Date): Promise<TrafficData> {
    const days: TrafficDayEntry[] = [];
    const current = new Date(from);
    let totalVisits = 0;
    let totalUnique = 0;
    let totalPageViews = 0;

    while (current <= to) {
      const visits = 100 + Math.floor(Math.random() * 500);
      const unique = Math.floor(visits * 0.7);
      const pv = visits * (2 + Math.floor(Math.random() * 3));
      totalVisits += visits;
      totalUnique += unique;
      totalPageViews += pv;
      days.push({
        date: current.toISOString().slice(0, 10),
        visits,
        unique_visitors: unique,
        page_views: pv,
        bounce_rate: 30 + Math.floor(Math.random() * 40),
      });
      current.setDate(current.getDate() + 1);
    }

    return {
      siteId,
      period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      daily: days,
      totals: {
        visits: totalVisits,
        unique_visitors: totalUnique,
        page_views: totalPageViews,
        bounce_rate: days.length > 0 ? Math.round(days.reduce((s, d) => s + d.bounce_rate, 0) / days.length) : 0,
        avg_duration_seconds: 45 + Math.floor(Math.random() * 120),
      },
    };
  }
}

// ─── HTTP adapter (real CTS API) ────────────────────────────────────────────

/**
 * Real CTS adapter that communicates with an external CTS API.
 *
 * Requires CTS_API_URL and CTS_API_KEY environment variables.
 * Expected API format: JSON REST.
 *
 * GET  /api/sites              → list sites
 * POST /api/events             → push event
 * GET  /api/sites/:id/traffic  → get traffic data
 */
export class HttpCTSAdapter implements CTSAdapter {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async request(path: string, options?: RequestInit): Promise<unknown> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`CTS API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async fetchSites(): Promise<CTSSiteExternal[]> {
    const data = await this.request('/api/sites') as { sites?: CTSSiteExternal[] };
    return data.sites ?? [];
  }

  async pushEvent(event: CTSEvent): Promise<void> {
    await this.request('/api/events', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async fetchTraffic(siteId: string, from: Date, to: Date): Promise<TrafficData> {
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    return await this.request(`/api/sites/${siteId}/traffic?from=${fromStr}&to=${toStr}`) as TrafficData;
  }
}

// ─── Adapter factory ────────────────────────────────────────────────────────

/**
 * Create the appropriate CTS adapter based on environment configuration.
 */
export function createCTSAdapter(): CTSAdapter {
  const url = process.env['CTS_API_URL'];
  const key = process.env['CTS_API_KEY'];

  if (url && key) {
    console.log(`[cts-service] Using HTTP adapter: ${url}`);
    return new HttpCTSAdapter(url, key);
  }

  console.log('[cts-service] CTS_API_URL not set — using mock adapter');
  return new MockCTSAdapter();
}

// ─── CTS service (orchestration) ────────────────────────────────────────────

export class CTSService {
  private adapter: CTSAdapter;

  constructor(
    private pool: pg.Pool,
    adapter?: CTSAdapter,
  ) {
    this.adapter = adapter ?? createCTSAdapter();
  }

  /**
   * Sync sites from external CTS system into local cts_sites table.
   * Uses upsert to avoid duplicates.
   */
  async syncSitesFromCTS(): Promise<{ synced: number; total: number }> {
    const remoteSites = await this.adapter.fetchSites();
    let synced = 0;

    for (const site of remoteSites) {
      try {
        await this.pool.query(
          `INSERT INTO cts_sites (domain, external_cts_id)
           VALUES ($1, $2)
           ON CONFLICT (domain) WHERE domain IS NOT NULL
           DO UPDATE SET external_cts_id = COALESCE(EXCLUDED.external_cts_id, cts_sites.external_cts_id),
                         updated_at = NOW()`,
          [site.domain, site.externalId],
        );
        synced++;
      } catch (err) {
        console.error(`[cts-service] Failed to sync site ${site.domain}:`, err instanceof Error ? err.message : err);
      }
    }

    return { synced, total: remoteSites.length };
  }

  /**
   * Push a ban event to the external CTS system.
   */
  async pushBanEvent(domain: string, accountGoogleId: string, reason?: string): Promise<void> {
    await this.adapter.pushEvent({
      type: 'ban',
      domain,
      accountGoogleId,
      details: reason ? { reason } : undefined,
      timestamp: new Date(),
    });
  }

  /**
   * Get traffic data for a CTS site.
   */
  async getTrafficData(externalCtsId: string, from: Date, to: Date): Promise<TrafficData> {
    return this.adapter.fetchTraffic(externalCtsId, from, to);
  }
}
