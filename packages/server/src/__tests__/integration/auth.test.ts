import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Auth endpoints', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  const adminUser = {
    name: 'Test Admin',
    email: 'admin@test.com',
    password: 'AdminPass123!',
    role: 'admin',
  };

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-for-integration';
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

  // Helper: create a user via admin API (using legacy API key)
  async function createTestUser(data: Record<string, string> = adminUser) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: data,
    });
    return res.json() as { user: Record<string, string> };
  }

  // Helper: login and return tokens
  async function loginAs(email: string, password: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  // ── POST /auth/login ──

  describe('POST /auth/login', () => {
    it('returns tokens on valid credentials', async () => {
      await createTestUser();

      const { status, body } = await loginAs(adminUser.email, adminUser.password);

      expect(status).toBe(200);
      expect(body['access_token']).toBeTypeOf('string');
      expect(body['refresh_token']).toBeTypeOf('string');
      expect(body['user']).toBeDefined();

      const user = body['user'] as Record<string, string>;
      expect(user['email']).toBe(adminUser.email);
      expect(user['name']).toBe(adminUser.name);
      expect(user['role']).toBe('admin');
    });

    it('returns 401 on wrong password', async () => {
      await createTestUser();

      const { status, body } = await loginAs(adminUser.email, 'wrong-password');

      expect(status).toBe(401);
      expect(body['code']).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 on non-existent email', async () => {
      const { status, body } = await loginAs('ghost@test.com', 'whatever');

      expect(status).toBe(401);
      expect(body['code']).toBe('INVALID_CREDENTIALS');
    });

    it('returns 400 on invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'not-an-email', password: 'test' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 401 for deactivated user', async () => {
      const { user } = await createTestUser();

      // Deactivate via admin
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/users/${user['id']}`,
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      const { status } = await loginAs(adminUser.email, adminUser.password);
      expect(status).toBe(401);
    });
  });

  // ── POST /auth/refresh ──

  describe('POST /auth/refresh', () => {
    it('rotates tokens on valid refresh', async () => {
      await createTestUser();
      const { body: loginBody } = await loginAs(adminUser.email, adminUser.password);

      const refreshToken = loginBody['refresh_token'] as string;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: refreshToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, string>;
      expect(body['access_token']).toBeTypeOf('string');
      expect(body['refresh_token']).toBeTypeOf('string');
      // New tokens should differ from original
      expect(body['refresh_token']).not.toBe(refreshToken);
    });

    it('invalidates old refresh token after rotation', async () => {
      await createTestUser();
      const { body: loginBody } = await loginAs(adminUser.email, adminUser.password);
      const oldRefresh = loginBody['refresh_token'] as string;

      // Use refresh token once
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: oldRefresh },
      });

      // Try to use the same refresh token again
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: oldRefresh },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects garbage token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: 'not-a-jwt' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects access token used as refresh token', async () => {
      await createTestUser();
      const { body } = await loginAs(adminUser.email, adminUser.password);
      const accessToken = body['access_token'] as string;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: accessToken },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /auth/logout ──

  describe('POST /auth/logout', () => {
    it('revokes specific refresh token', async () => {
      await createTestUser();
      const { body: loginBody } = await loginAs(adminUser.email, adminUser.password);
      const accessToken = loginBody['access_token'] as string;
      const refreshToken = loginBody['refresh_token'] as string;

      // Logout with specific token
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { Authorization: `Bearer ${accessToken}` },
        payload: { refresh_token: refreshToken },
      });

      expect(logoutRes.statusCode).toBe(200);
      expect(logoutRes.json().status).toBe('ok');

      // Refresh should fail now
      const refreshRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: refreshToken },
      });

      expect(refreshRes.statusCode).toBe(401);
    });

    it('requires authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /auth/me ──

  describe('GET /auth/me', () => {
    it('returns user profile for JWT auth', async () => {
      await createTestUser();
      const { body: loginBody } = await loginAs(adminUser.email, adminUser.password);
      const accessToken = loginBody['access_token'] as string;

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['name']).toBe(adminUser.name);
      expect(body['email']).toBe(adminUser.email);
      expect(body['role']).toBe('admin');
      // API key should be masked
      expect((body['api_key'] as string)?.endsWith('***')).toBe(true);
    });

    it('returns legacy info for API key auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(body['id']).toBe('legacy');
      expect(body['role']).toBe('admin');
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── Scope guard: collect_only ──

  describe('Scope guard (collect_only)', () => {
    it('allows collect_only key to POST /collect', async () => {
      const { user } = await createTestUser({
        name: 'Buyer',
        email: 'buyer@test.com',
        password: 'BuyerPass123!',
        role: 'buyer',
      });

      const apiKey = user['api_key'] as string;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/collect',
        headers: { 'X-API-Key': apiKey },
        payload: {
          profile_id: 'test',
          extension_version: '0.1.0',
          batch: [],
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('blocks collect_only key from GET /accounts', async () => {
      const { user } = await createTestUser({
        name: 'Buyer',
        email: 'buyer@test.com',
        password: 'BuyerPass123!',
        role: 'buyer',
      });

      const apiKey = user['api_key'] as string;

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'X-API-Key': apiKey },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('SCOPE_INSUFFICIENT');
    });

    it('allows full scope key to GET /accounts', async () => {
      // Legacy key has full scope
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'X-API-Key': TEST_API_KEY },
      });

      // Should not be 403 (could be 200 or empty result)
      expect(res.statusCode).not.toBe(403);
    });
  });
});
