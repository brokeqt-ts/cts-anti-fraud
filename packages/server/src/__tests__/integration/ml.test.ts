import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('ML API', () => {
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

  describe('GET /api/v1/ml/training-stats', () => {
    it('returns training statistics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/training-stats',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total_samples).toBeTypeOf('number');
      expect(body.banned_count).toBeTypeOf('number');
      expect(body.active_count).toBeTypeOf('number');
      expect(body.feature_stats).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/v1/ml/summary', () => {
    it('returns prediction summary', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/summary',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeTypeOf('number');
      expect(body.by_risk_level).toBeDefined();
    });
  });

  describe('GET /api/v1/ml/training-export', () => {
    it('returns CSV data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/training-export',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });
});
