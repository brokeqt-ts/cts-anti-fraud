import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Admin /admin/rules endpoints (role protection + CRUD)', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-rules';
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

  // ── Helpers ──

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

  const adminCreds = { name: 'Admin', email: 'admin@rules.test', password: 'AdminPass123!', role: 'admin' };
  const buyerCreds = { name: 'Buyer', email: 'buyer@rules.test', password: 'BuyerPass123!', role: 'buyer' };

  const validRule = {
    name: 'Test BIN rule',
    category: 'bin',
    condition: { field: 'binBanRate', operator: '>', value: 50 },
    message_template: 'BIN {bin} имеет высокий ban rate',
    priority: 0,
  };

  // ─── Role protection ────────────────────────────────────────────────────────

  describe('Role protection', () => {
    it('GET /admin/rules — unauthenticated returns 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/rules' });
      expect(res.statusCode).toBe(401);
    });

    it('GET /admin/rules — buyer returns 403', async () => {
      await createUser(buyerCreds);
      const token = await loginToken(buyerCreds.email, buyerCreds.password);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('POST /admin/rules — buyer returns 403', async () => {
      await createUser(buyerCreds);
      const token = await loginToken(buyerCreds.email, buyerCreds.password);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
        payload: validRule,
      });
      expect(res.statusCode).toBe(403);
    });

    it('GET /admin/rules — admin returns 200', async () => {
      await createUser(adminCreds);
      const token = await loginToken(adminCreds.email, adminCreds.password);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('rules');
    });
  });

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  describe('CRUD operations (admin)', () => {
    let adminToken: string;

    beforeAll(async () => {
      await createUser(adminCreds);
      adminToken = await loginToken(adminCreds.email, adminCreds.password);
    });

    it('creates a rule and returns it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: validRule,
      });
      expect(res.statusCode).toBe(201);
      const { rule } = res.json() as { rule: Record<string, unknown> };
      expect(rule['name']).toBe(validRule.name);
      expect(rule['category']).toBe('bin');
      expect(rule['is_active']).toBe(true);
      expect(rule).not.toHaveProperty('severity'); // severity removed from response shape check
    });

    it('lists created rule', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: validRule,
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const { rules } = res.json() as { rules: unknown[] };
      expect(rules.length).toBeGreaterThanOrEqual(1);
    });

    it('updates a rule', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: validRule,
      });
      const id = (create.json() as { rule: { id: string } }).rule.id;

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/rules/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: 'Updated rule name' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { rule: { name: string } }).rule.name).toBe('Updated rule name');
    });

    it('toggles a rule off then on', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: validRule,
      });
      const id = (create.json() as { rule: { id: string } }).rule.id;

      const off = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/rules/${id}/toggle`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { is_active: false },
      });
      expect((off.json() as { rule: { is_active: boolean } }).rule.is_active).toBe(false);

      const on = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/rules/${id}/toggle`,
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { is_active: true },
      });
      expect((on.json() as { rule: { is_active: boolean } }).rule.is_active).toBe(true);
    });

    it('deletes a rule', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: validRule,
      });
      const id = (create.json() as { rule: { id: string } }).rule.id;

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/rules/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(del.statusCode).toBe(204);
    });

    it('rejects rule creation without required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { name: 'Missing fields' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid category', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${adminToken}` },
        payload: { ...validRule, category: 'invalid_category' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
