import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockCTSAdapter, CTSService, type CTSAdapter, type CTSSiteExternal, type CTSEvent, type TrafficData } from './cts.service.js';
import type pg from 'pg';

describe('MockCTSAdapter', () => {
  const adapter = new MockCTSAdapter();

  it('fetchSites returns realistic mock sites', async () => {
    const sites = await adapter.fetchSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.externalId).toBeDefined();
      expect(site.domain).toBeDefined();
      expect(site.domain.length).toBeGreaterThan(0);
    }
  });

  it('pushEvent does not throw', async () => {
    await expect(adapter.pushEvent({
      type: 'ban',
      domain: 'test.com',
      timestamp: new Date(),
    })).resolves.not.toThrow();
  });

  it('fetchTraffic returns data for the requested period', async () => {
    const from = new Date('2026-02-01');
    const to = new Date('2026-02-07');
    const data = await adapter.fetchTraffic('cts-001', from, to);

    expect(data.siteId).toBe('cts-001');
    expect(data.period.from).toBe('2026-02-01');
    expect(data.period.to).toBe('2026-02-07');
    expect(data.daily.length).toBe(7);
    expect(data.totals.visits).toBeGreaterThan(0);
  });

  it('fetchTraffic daily entries have correct structure', async () => {
    const from = new Date('2026-02-10');
    const to = new Date('2026-02-12');
    const data = await adapter.fetchTraffic('cts-002', from, to);

    for (const day of data.daily) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.visits).toBeGreaterThan(0);
      expect(day.unique_visitors).toBeLessThanOrEqual(day.visits);
      expect(day.bounce_rate).toBeGreaterThanOrEqual(0);
      expect(day.bounce_rate).toBeLessThanOrEqual(100);
    }
  });
});

describe('CTSService', () => {
  let mockAdapter: CTSAdapter;
  let mockPool: pg.Pool;

  beforeEach(() => {
    mockAdapter = {
      fetchSites: vi.fn(async (): Promise<CTSSiteExternal[]> => [
        { externalId: 'ext-1', domain: 'example.com', name: 'Example' },
        { externalId: 'ext-2', domain: 'test.org', name: 'Test' },
      ]),
      pushEvent: vi.fn(async (_event: CTSEvent): Promise<void> => {}),
      fetchTraffic: vi.fn(async (_sid: string, _from: Date, _to: Date): Promise<TrafficData> => ({
        siteId: 'ext-1',
        period: { from: '2026-02-01', to: '2026-02-07' },
        daily: [],
        totals: { visits: 100, unique_visitors: 70, page_views: 200, bounce_rate: 40, avg_duration_seconds: 60 },
      })),
    };

    mockPool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as pg.Pool;
  });

  it('syncSitesFromCTS calls adapter and upserts sites', async () => {
    const service = new CTSService(mockPool, mockAdapter);
    const result = await service.syncSitesFromCTS();

    expect(result.total).toBe(2);
    expect(result.synced).toBe(2);
    expect(mockAdapter.fetchSites).toHaveBeenCalledOnce();
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });

  it('pushBanEvent calls adapter with correct event', async () => {
    const service = new CTSService(mockPool, mockAdapter);
    await service.pushBanEvent('example.com', '123456', 'policy violation');

    expect(mockAdapter.pushEvent).toHaveBeenCalledOnce();
    const event = vi.mocked(mockAdapter.pushEvent).mock.calls[0]![0];
    expect(event.type).toBe('ban');
    expect(event.domain).toBe('example.com');
    expect(event.accountGoogleId).toBe('123456');
    expect(event.details).toEqual({ reason: 'policy violation' });
  });

  it('getTrafficData delegates to adapter', async () => {
    const service = new CTSService(mockPool, mockAdapter);
    const from = new Date('2026-02-01');
    const to = new Date('2026-02-07');

    const data = await service.getTrafficData('ext-1', from, to);

    expect(data.totals.visits).toBe(100);
    expect(mockAdapter.fetchTraffic).toHaveBeenCalledWith('ext-1', from, to);
  });
});
