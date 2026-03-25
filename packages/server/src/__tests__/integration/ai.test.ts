import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('AI API', () => {
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

  describe('GET /api/v1/ai/models', () => {
    it('returns configured models list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/models',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.models).toBeInstanceOf(Array);
      expect(body.total).toBeTypeOf('number');
    });
  });

  describe('GET /api/v1/ai/leaderboard', () => {
    it('returns leaderboard data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/leaderboard',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.period).toBeTypeOf('string');
      expect(body.entries).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/v1/ai/history/:accountId', () => {
    it('returns empty history for unknown account', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ai/history/999-999-9999',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.analyses).toBeInstanceOf(Array);
      expect(body.analyses).toHaveLength(0);
    });
  });

  describe('POST /api/v1/ai/analyze/:accountId', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ai/analyze/123-456-7890',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
