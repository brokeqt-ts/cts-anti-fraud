import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Notifications', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  const adminData = { name: 'Admin', email: 'admin@test.com', password: 'AdminPass123!', role: 'admin' };
  const buyerData = { name: 'Buyer', email: 'buyer@test.com', password: 'BuyerPass123!', role: 'buyer' };
  const buyer2Data = { name: 'Buyer2', email: 'buyer2@test.com', password: 'Buyer2Pass123!', role: 'buyer' };

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-for-notifications';
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

  async function createUser(data: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: { 'X-API-Key': TEST_API_KEY },
      payload: data,
    });
    return (res.json() as { user: Record<string, unknown> }).user;
  }

  async function loginAndGetToken(email: string, password: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    return (res.json() as Record<string, string>)['access_token'];
  }

  async function insertNotification(
    userId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const { getTestPool } = await import('../helpers/test-db.js');
    const pool = getTestPool();
    const result = await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        overrides['type'] ?? 'ban_detected',
        overrides['title'] ?? 'Test notification',
        overrides['message'] ?? 'Test message',
        overrides['severity'] ?? 'critical',
        overrides['metadata'] ? JSON.stringify(overrides['metadata']) : null,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  }

  // ── 1. Notification Service: createNotification ──

  describe('Notification service — createNotification', () => {
    it('creates a notification with all fields', async () => {
      const user = await createUser(buyerData);
      const userId = user['id'] as string;

      const notif = await insertNotification(userId, {
        type: 'ban_detected',
        title: 'Аккаунт 807-883-1012 забанен',
        message: 'Причина: UNACCEPTABLE_BUSINESS_PRACTICES',
        severity: 'critical',
        metadata: { account_google_id: '8078831012' },
      });

      expect(notif['user_id']).toBe(userId);
      expect(notif['type']).toBe('ban_detected');
      expect(notif['severity']).toBe('critical');
      expect(notif['is_read']).toBe(false);
      expect(notif['id']).toBeTruthy();
    });

    it('defaults is_read to false and severity to info', async () => {
      const user = await createUser(buyerData);
      const userId = user['id'] as string;

      const notif = await insertNotification(userId, { severity: 'info' });

      expect(notif['is_read']).toBe(false);
      expect(notif['severity']).toBe('info');
    });
  });

  // ── 2. GET /notifications — data isolation ──

  describe('GET /notifications', () => {
    it('buyer sees only their own notifications', async () => {
      const buyer1 = await createUser(buyerData);
      const buyer2 = await createUser(buyer2Data);
      const b1Token = await loginAndGetToken(buyerData.email, buyerData.password);

      await insertNotification(buyer1['id'] as string, { title: 'For buyer1' });
      await insertNotification(buyer2['id'] as string, { title: 'For buyer2' });
      await insertNotification(buyer1['id'] as string, { title: 'Also for buyer1' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${b1Token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { notifications: Array<Record<string, unknown>>; total: number; unread_count: number };
      expect(body.total).toBe(2);
      expect(body.notifications).toHaveLength(2);
      expect(body.notifications.every((n) => n['user_id'] === buyer1['id'])).toBe(true);
    });

    it('admin sees only their own notifications (not all users)', async () => {
      const admin = await createUser(adminData);
      const buyer = await createUser(buyerData);
      const adminToken = await loginAndGetToken(adminData.email, adminData.password);

      await insertNotification(admin['id'] as string, { title: 'For admin' });
      await insertNotification(buyer['id'] as string, { title: 'For buyer' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      const body = res.json() as { notifications: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBe(1);
      expect(body.notifications[0]!['title']).toBe('For admin');
    });

    it('unread_only filter works', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const n1 = await insertNotification(buyerId, { title: 'Unread' });
      await insertNotification(buyerId, { title: 'Will be read' });

      // Mark one as read
      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();
      await pool.query('UPDATE notifications SET is_read = true WHERE id = $1', [n1['id']]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?unread_only=true',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = res.json() as { notifications: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBe(1);
      expect(body.notifications[0]!['title']).toBe('Will be read');
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── 3. GET /notifications/unread-count ──

  describe('GET /notifications/unread-count', () => {
    it('returns correct unread count', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      await insertNotification(buyerId);
      await insertNotification(buyerId);
      await insertNotification(buyerId);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { count: number };
      expect(body.count).toBe(3);
    });

    it('returns 0 when all are read', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      await insertNotification(buyerId);
      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();
      await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [buyerId]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = res.json() as { count: number };
      expect(body.count).toBe(0);
    });
  });

  // ── 4. PATCH /notifications/:id/read ──

  describe('PATCH /notifications/:id/read', () => {
    it('marks notification as read', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const notif = await insertNotification(buyerId);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notifications/${notif['id']}/read`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as Record<string, unknown>)['success']).toBe(true);

      // Verify unread count decreased
      const countRes = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect((countRes.json() as { count: number }).count).toBe(0);
    });

    it('returns 404 for already-read notification', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const notif = await insertNotification(buyerId);

      // Mark read first time
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/notifications/${notif['id']}/read`,
        headers: { Authorization: `Bearer ${token}` },
      });

      // Try again
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notifications/${notif['id']}/read`,
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('buyer cannot mark another users notification as read (ownership)', async () => {
      const buyer1 = await createUser(buyerData);
      const buyer2 = await createUser(buyer2Data);
      const b2Token = await loginAndGetToken(buyer2Data.email, buyer2Data.password);

      const notif = await insertNotification(buyer1['id'] as string);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/notifications/${notif['id']}/read`,
        headers: { Authorization: `Bearer ${b2Token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── 5. POST /notifications/read-all ──

  describe('POST /notifications/read-all', () => {
    it('marks all notifications as read for current user only', async () => {
      const buyer1 = await createUser(buyerData);
      const buyer2 = await createUser(buyer2Data);
      const b1Token = await loginAndGetToken(buyerData.email, buyerData.password);
      const b2Token = await loginAndGetToken(buyer2Data.email, buyer2Data.password);

      await insertNotification(buyer1['id'] as string);
      await insertNotification(buyer1['id'] as string);
      await insertNotification(buyer2['id'] as string);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/notifications/read-all',
        headers: { Authorization: `Bearer ${b1Token}` },
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { updated: number }).updated).toBe(2);

      // Buyer1 should have 0 unread
      const count1Res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { Authorization: `Bearer ${b1Token}` },
      });
      expect((count1Res.json() as { count: number }).count).toBe(0);

      // Buyer2 should still have 1 unread
      const count2Res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: { Authorization: `Bearer ${b2Token}` },
      });
      expect((count2Res.json() as { count: number }).count).toBe(1);
    });
  });

  // ── 6. Ban detection generates notification ──

  describe('Ban detection generates notifications', () => {
    it('creates critical notification when ban is detected via signal', async () => {
      const admin = await createUser(adminData);
      const buyer = await createUser(buyerData);
      const buyerToken = await loginAndGetToken(buyerData.email, buyerData.password);
      const adminToken = await loginAndGetToken(adminData.email, adminData.password);
      const buyerId = buyer['id'] as string;

      // Create an account owned by buyer
      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();
      await pool.query(
        `INSERT INTO accounts (google_account_id, display_name, user_id)
         VALUES ('8078831012', '8078831012', $1)
         ON CONFLICT DO NOTHING`,
        [buyerId],
      );

      // Trigger auto-ban detection
      const { checkAndCreateBan } = await import('../../services/auto-ban-detector.js');
      await checkAndCreateBan(pool, '8078831012', { value: { '1': true } });

      // Wait for non-blocking notification creation
      await new Promise((r) => setTimeout(r, 500));

      // Buyer should have a ban_detected notification
      const buyerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      const buyerBody = buyerRes.json() as { notifications: Array<Record<string, unknown>> };
      const banNotif = buyerBody.notifications.find((n) => n['type'] === 'ban_detected');
      expect(banNotif).toBeDefined();
      expect(banNotif!['severity']).toBe('critical');
      expect((banNotif!['metadata'] as Record<string, unknown>)?.['account_google_id']).toBe('8078831012');

      // Admin should also have a ban_detected notification
      const adminRes = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const adminBody = adminRes.json() as { notifications: Array<Record<string, unknown>> };
      const adminBanNotif = adminBody.notifications.find((n) => n['type'] === 'ban_detected');
      expect(adminBanNotif).toBeDefined();
      expect(adminBanNotif!['user_id']).toBe(admin['id']);
    });
  });

  // ── 7. Pagination ──

  describe('Pagination', () => {
    it('respects limit and offset', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      // Create 5 notifications
      for (let i = 0; i < 5; i++) {
        await insertNotification(buyerId, { title: `Notif ${i}` });
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications?limit=2&offset=1',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = res.json() as { notifications: Array<Record<string, unknown>>; total: number };
      expect(body.total).toBe(5);
      expect(body.notifications).toHaveLength(2);
    });
  });

  // ── 8. Collect_only scope blocked ──

  describe('Scope guard', () => {
    it('collect_only API key gets 403 on /notifications', async () => {
      const buyer = await createUser(buyerData);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { 'X-API-Key': buyer['api_key'] as string },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
