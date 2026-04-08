import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Admin /admin/rules endpoints', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-rules';
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

  async function adminToken(): Promise<string> {
    await createUser(adminCreds);
    return loginToken(adminCreds.email, adminCreds.password);
  }

  async function buyerToken(): Promise<string> {
    await createUser(buyerCreds);
    return loginToken(buyerCreds.email, buyerCreds.password);
  }

  const adminCreds = { name: 'Admin', email: 'admin@rules.test', password: 'AdminPass123!', role: 'admin' };
  const buyerCreds = { name: 'Buyer', email: 'buyer@rules.test', password: 'BuyerPass123!', role: 'buyer' };

  const validRule = {
    name: 'BIN ban rate high',
    category: 'bin',
    condition: { field: 'binBanRate', operator: '>', value: 50 },
    message_template: 'BIN {bin} имеет высокий ban rate',
    priority: 0,
  };

  async function createRule(token: string, rule = validRule) {
    return app.inject({
      method: 'POST', url: '/api/v1/admin/rules',
      headers: { Authorization: `Bearer ${token}` }, payload: rule,
    });
  }

  // ── Role protection ─────────────────────────────────────────────────────────

  describe('Role protection', () => {
    it('GET — unauthenticated → 401', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/rules' });
      expect(res.statusCode).toBe(401);
    });

    it('GET — buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('POST — buyer → 403', async () => {
      const token = await buyerToken();
      const res = await createRule(token);
      expect(res.statusCode).toBe(403);
    });

    it('PATCH — buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'PATCH', url: '/api/v1/admin/rules/00000000-0000-0000-0000-000000000001',
        headers: { Authorization: `Bearer ${token}` }, payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('DELETE — buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'DELETE', url: '/api/v1/admin/rules/00000000-0000-0000-0000-000000000001',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('GET — admin → 200', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('rules');
      expect(Array.isArray((res.json() as { rules: unknown[] }).rules)).toBe(true);
    });
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  describe('POST /admin/rules', () => {
    it('creates rule with correct fields', async () => {
      const token = await adminToken();
      const res = await createRule(token);
      expect(res.statusCode).toBe(201);
      const { rule } = res.json() as { rule: Record<string, unknown> };
      expect(rule['name']).toBe(validRule.name);
      expect(rule['category']).toBe('bin');
      expect(rule['is_active']).toBe(true);
      expect(rule['id']).toBeTypeOf('string');
      expect(rule['created_at']).toBeTypeOf('string');
    });

    it('creates rule without optional description', async () => {
      const token = await adminToken();
      const res = await createRule(token);
      expect(res.statusCode).toBe(201);
      const { rule } = res.json() as { rule: Record<string, unknown> };
      expect(rule['description']).toBeNull();
    });

    it('creates rule with compound AND condition', async () => {
      const token = await adminToken();
      const res = await createRule(token, {
        ...validRule,
        name: 'Compound rule',
        condition: {
          logic: 'AND',
          conditions: [
            { field: 'binBanRate', operator: '>', value: 50 },
            { field: 'domainAgeDays', operator: '<', value: 14 },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects duplicate rule name → 409', async () => {
      const token = await adminToken();
      await createRule(token);
      const res = await createRule(token);
      expect(res.statusCode).toBe(409);
    });

    it('rejects missing required field: name', async () => {
      const token = await adminToken();
      const { name: _, ...noName } = validRule;
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` }, payload: noName,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing required field: condition', async () => {
      const token = await adminToken();
      const { condition: _, ...noCondition } = validRule;
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` }, payload: noCondition,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects missing required field: message_template', async () => {
      const token = await adminToken();
      const { message_template: _, ...noMsg } = validRule;
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` }, payload: noMsg,
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid category', async () => {
      const token = await adminToken();
      const res = await createRule(token, { ...validRule, category: 'invalid' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty name', async () => {
      const token = await adminToken();
      const res = await createRule(token, { ...validRule, name: '' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects extra unknown fields (additionalProperties: false)', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
        payload: { ...validRule, severity: 'block', unknown_field: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── List ────────────────────────────────────────────────────────────────────

  describe('GET /admin/rules', () => {
    it('returns empty list initially (after truncate)', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { rules } = res.json() as { rules: unknown[] };
      expect(rules).toBeInstanceOf(Array);
    });

    it('returns created rules', async () => {
      const token = await adminToken();
      await createRule(token, { ...validRule, name: 'Rule A' });
      await createRule(token, { ...validRule, name: 'Rule B' });
      const res = await app.inject({
        method: 'GET', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { rules } = res.json() as { rules: unknown[] };
      expect(rules.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  describe('PATCH /admin/rules/:id', () => {
    it('updates name', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}`,
        headers: { Authorization: `Bearer ${token}` }, payload: { name: 'Updated name' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { rule: { name: string } }).rule.name).toBe('Updated name');
    });

    it('updates message_template', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { message_template: 'Новое сообщение {bin}' },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { rule: { message_template: string } }).rule.message_template)
        .toBe('Новое сообщение {bin}');
    });

    it('returns 404 for non-existent rule', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'PATCH', url: '/api/v1/admin/rules/00000000-0000-0000-0000-000000000099',
        headers: { Authorization: `Bearer ${token}` }, payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid UUID format', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'PATCH', url: '/api/v1/admin/rules/not-a-uuid',
        headers: { Authorization: `Bearer ${token}` }, payload: { name: 'X' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects empty body (minProperties: 1)', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}`,
        headers: { Authorization: `Bearer ${token}` }, payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Delete ──────────────────────────────────────────────────────────────────

  describe('DELETE /admin/rules/:id', () => {
    it('deletes existing rule → 204', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      const res = await app.inject({
        method: 'DELETE', url: `/api/v1/admin/rules/${rule.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it('rule no longer appears in list after delete', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      await app.inject({
        method: 'DELETE', url: `/api/v1/admin/rules/${rule.id}`,
        headers: { Authorization: `Bearer ${token}` },
      });
      const list = await app.inject({
        method: 'GET', url: '/api/v1/admin/rules',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { rules } = list.json() as { rules: Array<{ id: string }> };
      expect(rules.find(r => r.id === rule.id)).toBeUndefined();
    });

    it('returns 404 for non-existent rule', async () => {
      const token = await adminToken();
      const res = await app.inject({
        method: 'DELETE', url: '/api/v1/admin/rules/00000000-0000-0000-0000-000000000099',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Toggle ──────────────────────────────────────────────────────────────────

  describe('PATCH /admin/rules/:id/toggle', () => {
    it('disables an active rule', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string; is_active: boolean } };
      expect(rule.is_active).toBe(true);
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}/toggle`,
        headers: { Authorization: `Bearer ${token}` }, payload: { is_active: false },
      });
      expect((res.json() as { rule: { is_active: boolean } }).rule.is_active).toBe(false);
    });

    it('re-enables a disabled rule', async () => {
      const token = await adminToken();
      const { rule } = (await createRule(token)).json() as { rule: { id: string } };
      await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}/toggle`,
        headers: { Authorization: `Bearer ${token}` }, payload: { is_active: false },
      });
      const res = await app.inject({
        method: 'PATCH', url: `/api/v1/admin/rules/${rule.id}/toggle`,
        headers: { Authorization: `Bearer ${token}` }, payload: { is_active: true },
      });
      expect((res.json() as { rule: { is_active: boolean } }).rule.is_active).toBe(true);
    });
  });

  // ── Reorder ─────────────────────────────────────────────────────────────────

  describe('POST /admin/rules/reorder', () => {
    it('buyer → 403', async () => {
      const token = await buyerToken();
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules/reorder',
        headers: { Authorization: `Bearer ${token}` }, payload: { updates: [] },
      });
      expect(res.statusCode).toBe(403);
    });

    it('updates rule priorities', async () => {
      const token = await adminToken();
      const r1 = (await createRule(token, { ...validRule, name: 'Rule 1', priority: 1 })).json() as { rule: { id: string } };
      const r2 = (await createRule(token, { ...validRule, name: 'Rule 2', priority: 2 })).json() as { rule: { id: string } };
      const res = await app.inject({
        method: 'POST', url: '/api/v1/admin/rules/reorder',
        headers: { Authorization: `Bearer ${token}` },
        payload: { updates: [{ id: r1.rule.id, priority: 10 }, { id: r2.rule.id, priority: 20 }] },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── All categories ──────────────────────────────────────────────────────────

  describe('All valid categories', () => {
    it.each(['bin', 'domain', 'account', 'geo', 'vertical', 'spend'])(
      'accepts category: %s', async (category) => {
        const token = await adminToken();
        const res = await createRule(token, { ...validRule, name: `Rule ${category}`, category });
        expect(res.statusCode).toBe(201);
      },
    );
  });
});
