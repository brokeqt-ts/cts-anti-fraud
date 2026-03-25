import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('POST /api/v1/assess', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    const { buildApp } = await import('../../index.js');
    app = await buildApp({ databaseUrl: process.env['TEST_DATABASE_URL']!, silent: true });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('accepts valid assessment request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/assess',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: {
        domain: 'example.com',
        vertical: 'nutra',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.risk_score).toBeTypeOf('number');
    expect(body.risk_level).toBeTypeOf('string');
    expect(['low', 'medium', 'high', 'critical']).toContain(body.risk_level);
    expect(body.factors).toBeInstanceOf(Array);
    expect(body.recommendations).toBeInstanceOf(Array);
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/assess',
      payload: { domain: 'example.com' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('handles assessment with all fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/assess',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: {
        domain: 'test-site.com',
        account_google_id: '123-456-7890',
        bin: '411111',
        vertical: 'gambling',
        geo: 'US',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.risk_score).toBeTypeOf('number');
    expect(body.risk_score).toBeGreaterThanOrEqual(0);
    expect(body.risk_score).toBeLessThanOrEqual(100);
  });
});
