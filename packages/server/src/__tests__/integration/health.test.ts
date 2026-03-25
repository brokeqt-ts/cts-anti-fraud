import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, TEST_API_KEY } from '../helpers/test-db.js';

// Skip if no test DB available
const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('GET /api/v1/health', () => {
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

  it('returns 200 with status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBeDefined();
    expect(body.uptime).toBeTypeOf('number');
    expect(body.database).toBeDefined();
    expect(body.database.connected).toBe(true);
    expect(body.database.latency_ms).toBeTypeOf('number');
  });

  it('does not require authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
  });
});
