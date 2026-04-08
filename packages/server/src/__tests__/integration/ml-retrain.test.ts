import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('ML retrain endpoints', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-ml-retrain';
    const { buildApp } = await import('../../index.js');
    app = await buildApp({ databaseUrl: process.env['TEST_DATABASE_URL']!, silent: true });
    await app.ready();
  });

  afterAll(async () => { if (app) await app.close(); });
  afterEach(async () => { if (hasTestDatabase()) await truncateAll(); });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async function createUser(data: Record<string, string>) {
    return app.inject({
      method: 'POST', url: '/api/v1/admin/users',
      headers: { 'X-API-Key': TEST_API_KEY }, payload: data,
    });
  }

  async function loginToken(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password },
    });
    return (res.json() as Record<string, string>)['access_token'];
  }

  const adminCreds = { name: 'Admin', email: 'admin@ml.test', password: 'AdminPass123!', role: 'admin' };
  const buyerCreds = { name: 'Buyer', email: 'buyer@ml.test', password: 'BuyerPass123!', role: 'buyer' };

  async function adminToken() {
    await createUser(adminCreds);
    return loginToken(adminCreds.email, adminCreds.password);
  }

  async function buyerToken() {
    await createUser(buyerCreds);
    return loginToken(buyerCreds.email, buyerCreds.password);
  }

  // ── POST /ml/train ───────────────────────────────────────────────────────────

  describe('POST /ml/train', () => {
    it('unauthenticated → 401', async () => {
      expect((await app.inject({ method: 'POST', url: '/api/v1/ml/train' })).statusCode).toBe(401);
    });

    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200 or 503 (no XGBoost in test env)', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([200, 503]).toContain(res.statusCode);
    });

    it('admin → response has engine field', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.statusCode === 200) {
        const body = res.json() as Record<string, unknown>;
        expect(body).toHaveProperty('engine');
        expect(['xgboost', 'typescript']).toContain(body['engine']);
      }
    });

    it('admin → training result has sample_count when successful', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/train',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.statusCode === 200) {
        const body = res.json() as Record<string, unknown>;
        expect(body['sample_count']).toBeTypeOf('number');
        expect(body['warnings']).toBeInstanceOf(Array);
      }
    });
  });

  // ── GET /ml/xgboost-status ───────────────────────────────────────────────────

  describe('GET /ml/xgboost-status', () => {
    it('unauthenticated → 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/ml/xgboost-status' })).statusCode).toBe(401);
    });

    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/xgboost-status',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200 with required fields', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/xgboost-status',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('available');
      expect(typeof body['available']).toBe('boolean');
    });

    it('admin → unavailable path has reason field', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/xgboost-status',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = res.json() as Record<string, unknown>;
      // In test env XGBoost is not running, so should be unavailable
      if (!body['available']) {
        expect(body).toHaveProperty('reason');
      }
    });
  });

  // ── GET /ml/training-stats ───────────────────────────────────────────────────

  describe('GET /ml/training-stats', () => {
    it('unauthenticated → 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/ml/training-stats' })).statusCode).toBe(401);
    });

    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/training-stats',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → 200 with expected schema', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/training-stats',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['total_samples']).toBeTypeOf('number');
      expect(body['banned_count']).toBeTypeOf('number');
      expect(body['active_count']).toBeTypeOf('number');
      expect(body['feature_stats']).toBeInstanceOf(Array);
    });
  });

  // ── POST /ml/bootstrap ───────────────────────────────────────────────────────

  describe('POST /ml/bootstrap', () => {
    it('unauthenticated → 401', async () => {
      expect((await app.inject({ method: 'POST', url: '/api/v1/ml/bootstrap' })).statusCode).toBe(401);
    });

    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/bootstrap',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin can call bootstrap', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/ml/bootstrap',
        headers: { Authorization: `Bearer ${token}` },
      });
      // 200 = success, 422 = insufficient data — both are acceptable
      expect([200, 422, 503]).toContain(res.statusCode);
    });
  });

  // ── GET /ml/training-export ──────────────────────────────────────────────────

  describe('GET /ml/training-export', () => {
    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/training-export',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin → CSV content-type', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/training-export',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
    });
  });

  // ── User-scoped prediction endpoints ────────────────────────────────────────

  describe('Prediction endpoints (authenticated, any role)', () => {
    it('GET /ml/summary — unauthenticated → 401', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/ml/summary' })).statusCode).toBe(401);
    });

    it('GET /ml/summary — buyer → 200', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/ml/summary',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['total']).toBeTypeOf('number');
    });
  });
});
