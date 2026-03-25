import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Admin /admin/users endpoints', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-for-admin';
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

  // Helper: create user via API
  async function createUser(data: Record<string, string>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: data,
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  // Helper: login and return access token
  async function loginAndGetToken(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return (res.json() as Record<string, string>)['access_token'];
  }

  const adminData = { name: 'Admin', email: 'admin@test.com', password: 'AdminPass123!', role: 'admin' };
  const buyerData = { name: 'Buyer', email: 'buyer@test.com', password: 'BuyerPass123!', role: 'buyer' };

  // ── POST /admin/users (create) ──

  describe('POST /admin/users', () => {
    it('creates a user with auto-generated API key', async () => {
      const { status, body } = await createUser(adminData);

      expect(status).toBe(201);
      const user = body['user'] as Record<string, unknown>;
      expect(user['name']).toBe('Admin');
      expect(user['email']).toBe('admin@test.com');
      expect(user['role']).toBe('admin');
      expect(user['api_key']).toBeTypeOf('string');
      expect((user['api_key'] as string).startsWith('cts_')).toBe(true);
      expect(user['api_key_scope']).toBe('full'); // admin gets full
    });

    it('buyer gets collect_only scope', async () => {
      const { body } = await createUser(buyerData);
      const user = body['user'] as Record<string, unknown>;

      expect(user['role']).toBe('buyer');
      expect(user['api_key_scope']).toBe('collect_only');
    });

    it('rejects duplicate email', async () => {
      await createUser(adminData);
      const { status, body } = await createUser({ ...adminData, name: 'Duplicate' });

      expect(status).toBe(409);
      expect(body['code']).toBe('EMAIL_EXISTS');
    });

    it('rejects short password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: { 'X-API-Key': TEST_API_KEY },
        payload: { name: 'X', email: 'short@test.com', password: 'short' },
      });

      expect(res.statusCode).toBe(400); // schema validation
    });

    it('requires admin role', async () => {
      await createUser(buyerData);
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/users',
        headers: { Authorization: `Bearer ${token}` },
        payload: { name: 'New', email: 'new@test.com', password: 'NewPass123!' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /admin/users (list) ──

  describe('GET /admin/users', () => {
    it('lists all users', async () => {
      await createUser(adminData);
      await createUser(buyerData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { users: unknown[] };
      expect(body.users.length).toBe(2);
    });

    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/users',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── PATCH /admin/users/:id (update) ──

  describe('PATCH /admin/users/:id', () => {
    it('updates user fields', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}`,
        headers: { 'X-API-Key': TEST_API_KEY },
        payload: { name: 'Updated Admin' },
      });

      expect(res.statusCode).toBe(200);
      const user = (res.json() as Record<string, Record<string, string>>)['user'];
      expect(user['name']).toBe('Updated Admin');
    });

    it('auto-syncs scope when role changes', async () => {
      const { body: createBody } = await createUser(buyerData);
      const userId = (createBody['user'] as Record<string, string>)['id'];

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}`,
        headers: { 'X-API-Key': TEST_API_KEY },
        payload: { role: 'admin' },
      });

      expect(res.statusCode).toBe(200);
      const user = (res.json() as Record<string, Record<string, string>>)['user'];
      expect(user['role']).toBe('admin');
      expect(user['api_key_scope']).toBe('full');
    });

    it('prevents self-deactivation', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { is_active: false },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SELF_DEACTIVATE');
    });

    it('prevents self-demotion', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}`,
        headers: { Authorization: `Bearer ${token}` },
        payload: { role: 'buyer' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SELF_DEMOTE');
    });
  });

  // ── DELETE /admin/users/:id (soft delete) ──

  describe('DELETE /admin/users/:id', () => {
    it('soft-deletes a user', async () => {
      await createUser(adminData);
      const { body: createBody } = await createUser(buyerData);
      const buyerId = (createBody['user'] as Record<string, string>)['id'];
      const adminToken = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/users/${buyerId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);

      // Verify user can no longer login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: buyerData.email, password: buyerData.password },
      });

      expect(loginRes.statusCode).toBe(401);
    });

    it('prevents self-deletion', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/users/${userId}`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SELF_DEACTIVATE');
    });
  });

  // ── POST /admin/users/:id/reset-api-key ──

  describe('POST /admin/users/:id/reset-api-key', () => {
    it('generates a new API key', async () => {
      const { body: createBody } = await createUser(adminData);
      const user = createBody['user'] as Record<string, string>;
      const oldKey = user['api_key'];

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${user['id']}/reset-api-key`,
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, string>;
      expect(body['api_key']).toBeTypeOf('string');
      expect(body['api_key'].startsWith('cts_')).toBe(true);
      expect(body['api_key']).not.toBe(oldKey);
    });
  });

  // ── PATCH /admin/users/:id/password ──

  describe('PATCH /admin/users/:id/password', () => {
    it('changes password and revokes sessions', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];

      // Login to get refresh token
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: adminData.email, password: adminData.password },
      });
      const oldRefresh = (loginRes.json() as Record<string, string>)['refresh_token'];

      // Change password via admin
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}/password`,
        headers: { 'X-API-Key': TEST_API_KEY },
        payload: { password: 'NewPassword456!' },
      });

      expect(res.statusCode).toBe(200);

      // Old refresh token should be revoked
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: oldRefresh },
      });

      expect(refreshRes.statusCode).toBe(401);

      // New password should work
      const newLoginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: adminData.email, password: 'NewPassword456!' },
      });

      expect(newLoginRes.statusCode).toBe(200);
    });

    it('rejects short password', async () => {
      const { body: createBody } = await createUser(adminData);
      const userId = (createBody['user'] as Record<string, string>)['id'];

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${userId}/password`,
        headers: { 'X-API-Key': TEST_API_KEY },
        payload: { password: 'short' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
