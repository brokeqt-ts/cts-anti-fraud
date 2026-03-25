/**
 * E2E Smoke Test — validates the core data pipeline end-to-end.
 *
 * Requires: TEST_DATABASE_URL env var pointing to a test Postgres DB.
 * This test is slow (DB, migrations) — skip in fast unit test runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const hasTestDb = !!process.env['TEST_DATABASE_URL'];
const describeIf = hasTestDb ? describe : describe.skip;

const TEST_API_KEY = 'e2e-smoke-test-key';

describeIf('E2E Smoke Test', () => {
  let app: Awaited<ReturnType<typeof import('../packages/server/src/index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    const { buildApp } = await import('../packages/server/src/index.js');
    app = await buildApp({ databaseUrl: process.env['TEST_DATABASE_URL']!, silent: true });
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('Step 1: Health check passes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().database.connected).toBe(true);
  });

  it('Step 2: Collect data ingestion', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: {
        profile_id: 'smoke-test-profile',
        antidetect_browser: 'octium',
        extension_version: '0.1.0',
        batch: [
          {
            type: 'account',
            timestamp: new Date().toISOString(),
            data: {
              accountId: '111-222-3333',
              displayName: 'Smoke Test Account',
              status: 'active',
            },
          },
          {
            type: 'campaign',
            timestamp: new Date().toISOString(),
            data: {
              accountId: '111-222-3333',
              campaignId: 'campaign-001',
              campaignName: 'Test Campaign',
              status: 'ENABLED',
              budget: 50,
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBeGreaterThanOrEqual(1);
  });

  it('Step 3: Account appears in list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: { 'X-API-Key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accounts.length).toBeGreaterThanOrEqual(1);
  });

  it('Step 4: Risk assessment works', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/assess',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: {
        domain: 'smoke-test.example.com',
        vertical: 'ecom',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.risk_score).toBeTypeOf('number');
    expect(body.risk_level).toBeDefined();
  });

  it('Step 5: ML training stats available', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ml/training-stats',
      headers: { 'X-API-Key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total_samples).toBeTypeOf('number');
  });

  it('Step 6: AI models endpoint responds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/ai/models',
      headers: { 'X-API-Key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().models).toBeInstanceOf(Array);
  });
});
