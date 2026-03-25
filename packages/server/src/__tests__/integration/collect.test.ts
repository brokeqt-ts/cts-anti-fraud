import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('POST /api/v1/collect', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  const validPayload = {
    profile_id: 'test-profile-001',
    antidetect_browser: 'octium',
    extension_version: '0.1.0',
    batch: [
      {
        type: 'account',
        timestamp: new Date().toISOString(),
        data: {
          accountId: '123-456-7890',
          displayName: 'Test Account',
          status: 'active',
        },
      },
    ],
  };

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

  afterEach(async () => {
    if (hasTestDatabase()) await truncateAll();
  });

  it('accepts valid batch payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.processed).toBeTypeOf('number');
    expect(body.processed).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 without API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 with wrong API key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': 'wrong-key' },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid payload (missing batch)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: { profile_id: 'test', extension_version: '0.1.0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid batch item type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: {
        profile_id: 'test',
        extension_version: '0.1.0',
        batch: [{ type: 'invalid_type', timestamp: new Date().toISOString(), data: {} }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('handles empty batch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/collect',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: { profile_id: 'test', extension_version: '0.1.0', batch: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(0);
  });
});
