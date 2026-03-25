import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDatabase, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Accounts API', () => {
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

  describe('GET /api/v1/accounts', () => {
    it('returns list with pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accounts).toBeInstanceOf(Array);
      expect(body.total).toBeTypeOf('number');
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/accounts' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/accounts/:id', () => {
    it('returns 404 for non-existent account', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts/999-999-9999',
        headers: { 'X-API-Key': TEST_API_KEY },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
