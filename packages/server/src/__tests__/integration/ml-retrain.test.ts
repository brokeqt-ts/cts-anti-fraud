import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('ML retrain endpoints (role protection)', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-ml-retrain';
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

  async function createUser(data: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: data,
    });
  }

  async function loginToken(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return (res.json() as Record<string, string>)['access_token'];
  }

  const adminCreds = { name: 'Admin', email: 'admin@ml.test', password: 'AdminPass123!', role: 'admin' };
  const buyerCreds = { name: 'Buyer', email: 'buyer@ml.test', password: 'BuyerPass123!', role: 'buyer' };

  // ─── POST /ml/train ─────────────────────────────────────────────────────────

  describe('POST /ml/train', () => {
    it('unauthenticated returns 401', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/ml/train' });
      expect(res.statusCode).toBe(401);
    });

    it('buyer returns 403', async () => {
      await createUser(buyerCreds);
      const token = await loginToken(buyerCreds.email, buyerCreds.password);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin returns 200 (even with no training data)', async () => {
      await createUser(adminCreds);
      const token = await loginToken(adminCreds.email, adminCreds.password);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      // Either 200 (TS fallback trained) or 503 (both services unavailable) are acceptable
      expect([200, 503]).toContain(res.statusCode);
    });
  });

  // ─── GET /ml/xgboost-status ─────────────────────────────────────────────────

  describe('GET /ml/xgboost-status', () => {
    it('unauthenticated returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/ml/xgboost-status' });
      expect(res.statusCode).toBe(401);
    });

    it('buyer returns 403', async () => {
      await createUser(buyerCreds);
      const token = await loginToken(buyerCreds.email, buyerCreds.password);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/xgboost-status',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin returns 200 with status info', async () => {
      await createUser(adminCreds);
      const token = await loginToken(adminCreds.email, adminCreds.password);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/xgboost-status',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('available');
    });
  });

  // ─── GET /ml/training-stats ─────────────────────────────────────────────────

  describe('GET /ml/training-stats', () => {
    it('buyer returns 403', async () => {
      await createUser(buyerCreds);
      const token = await loginToken(buyerCreds.email, buyerCreds.password);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ml/training-stats',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
