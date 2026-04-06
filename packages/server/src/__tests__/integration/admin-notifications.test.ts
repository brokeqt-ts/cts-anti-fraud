import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { hasTestDatabase, truncateAll, TEST_API_KEY } from '../helpers/test-db.js';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('Admin Notifications', () => {
  let app: Awaited<ReturnType<typeof import('../../index.js').buildApp>>;

  const adminData = { name: 'Admin', email: 'admin@test.com', password: 'AdminPass123!', role: 'admin' };
  const buyerData = { name: 'Buyer', email: 'buyer@test.com', password: 'BuyerPass123!', role: 'buyer' };
  const buyer2Data = { name: 'Buyer2', email: 'buyer2@test.com', password: 'Buyer2Pass123!', role: 'buyer' };

  beforeAll(async () => {
    process.env['DATABASE_URL'] = process.env['TEST_DATABASE_URL']!;
    process.env['API_KEY'] = TEST_API_KEY;
    process.env['JWT_SECRET'] = 'test-jwt-secret-for-admin-notifications';
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

  async function seedSettings(): Promise<void> {
    const { getTestPool } = await import('../helpers/test-db.js');
    const pool = getTestPool();
    await pool.query(`
      INSERT INTO notification_settings (key, enabled, label, description, severity, notify_owner, notify_admins, cooldown_minutes)
      VALUES
        ('auto_ban_detected', true, 'Аккаунт забанен', 'Уведомлять при обнаружении бана', 'critical', true, true, 0),
        ('auto_ban_resolved', false, 'Бан снят', 'Уведомлять когда бан снят', 'success', true, true, 0),
        ('auto_risk_elevated', true, 'Риск повышен', 'Уведомлять о повышении риска', 'warning', true, true, 60),
        ('auto_account_connected', false, 'Новый аккаунт', 'Уведомлять о подключении', 'success', true, false, 0)
      ON CONFLICT (key) DO NOTHING
    `);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. GET /admin/notification-settings
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /admin/notification-settings', () => {
    it('returns all settings for admin', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notification-settings',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { settings: Array<Record<string, unknown>> };
      expect(body.settings).toHaveLength(4);
      expect(body.settings.map((s) => s['key'])).toContain('auto_ban_detected');
      expect(body.settings.map((s) => s['key'])).toContain('auto_ban_resolved');
    });

    it('returns 403 for buyer', async () => {
      await createUser(buyerData);
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notification-settings',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notification-settings',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. PATCH /admin/notification-settings/:key
  // ═══════════════════════════════════════════════════════════════════════════

  describe('PATCH /admin/notification-settings/:key', () => {
    it('toggles enabled', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_ban_detected',
        headers: { Authorization: `Bearer ${token}` },
        payload: { enabled: false },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { setting: Record<string, unknown> };
      expect(body.setting['enabled']).toBe(false);
      expect(body.setting['key']).toBe('auto_ban_detected');
    });

    it('updates severity', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_ban_detected',
        headers: { Authorization: `Bearer ${token}` },
        payload: { severity: 'warning' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { setting: Record<string, unknown> };
      expect(body.setting['severity']).toBe('warning');
    });

    it('updates cooldown_minutes', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_risk_elevated',
        headers: { Authorization: `Bearer ${token}` },
        payload: { cooldown_minutes: 120 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { setting: Record<string, unknown> };
      expect(body.setting['cooldown_minutes']).toBe(120);
    });

    it('updates notify_owner and notify_admins', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_account_connected',
        headers: { Authorization: `Bearer ${token}` },
        payload: { notify_owner: false, notify_admins: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { setting: Record<string, unknown> };
      expect(body.setting['notify_owner']).toBe(false);
      expect(body.setting['notify_admins']).toBe(true);
    });

    it('returns 404 for non-existent key', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/non_existent_key',
        headers: { Authorization: `Bearer ${token}` },
        payload: { enabled: true },
      });

      expect(res.statusCode).toBe(404);
    });

    it('rejects invalid severity value', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_ban_detected',
        headers: { Authorization: `Bearer ${token}` },
        payload: { severity: 'hacker' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects empty body', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);
      await seedSettings();

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_ban_detected',
        headers: { Authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for buyer', async () => {
      await createUser(buyerData);
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/notification-settings/auto_ban_detected',
        headers: { Authorization: `Bearer ${token}` },
        payload: { enabled: true },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. POST /admin/notifications/send
  // ═══════════════════════════════════════════════════════════════════════════

  describe('POST /admin/notifications/send', () => {
    it('sends notification to all users', async () => {
      await createUser(adminData);
      await createUser(buyerData);
      await createUser(buyer2Data);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'all',
          title: 'Обновите расширение',
          message: 'Доступна версия 2.0',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sent_to: number };
      expect(body.sent_to).toBe(3); // admin + 2 buyers
    });

    it('sends notification to buyers only', async () => {
      await createUser(adminData);
      await createUser(buyerData);
      await createUser(buyer2Data);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'buyers',
          title: 'Новые аккаунты',
          message: 'Готовы 10 аккаунтов',
          severity: 'success',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sent_to: number };
      expect(body.sent_to).toBe(2); // only 2 buyers
    });

    it('sends notification to admins only', async () => {
      await createUser(adminData);
      await createUser(buyerData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'admins',
          title: 'Серверный апдейт',
          message: 'Миграции прошли',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sent_to: number };
      expect(body.sent_to).toBe(1); // 1 admin
    });

    it('sends notification to specific user', async () => {
      await createUser(adminData);
      const buyer = await createUser(buyerData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'user_id',
          user_id: buyer['id'] as string,
          title: 'Персональное',
          message: 'Только для тебя',
          severity: 'warning',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sent_to: number };
      expect(body.sent_to).toBe(1);

      // Verify buyer received it
      const buyerToken = await loginAndGetToken(buyerData.email, buyerData.password);
      const notifRes = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      const notifBody = notifRes.json() as { notifications: Array<Record<string, unknown>> };
      expect(notifBody.notifications).toHaveLength(1);
      expect(notifBody.notifications[0]!['title']).toBe('Персональное');
      expect(notifBody.notifications[0]!['type']).toBe('system');
    });

    it('returns 400 when target=user_id without user_id', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'user_id',
          title: 'Test',
          message: 'Test',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for non-existent user_id', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'user_id',
          user_id: '00000000-0000-0000-0000-000000000000',
          title: 'Test',
          message: 'Test',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns { sent_to: 0 } when target=buyers but no buyers exist', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'buyers',
          title: 'Никому',
          message: 'Нет байеров',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { sent_to: number };
      expect(body.sent_to).toBe(0);
    });

    it('rejects empty title', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'all',
          title: '',
          message: 'Something',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid severity', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'all',
          title: 'Test',
          message: 'Test',
          severity: 'hacker',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 403 for buyer', async () => {
      await createUser(buyerData);
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'all',
          title: 'Test',
          message: 'Test',
          severity: 'info',
        },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. GET /admin/notifications/history
  // ═══════════════════════════════════════════════════════════════════════════

  describe('GET /admin/notifications/history', () => {
    it('returns grouped history for system notifications', async () => {
      await createUser(adminData);
      await createUser(buyerData);
      await createUser(buyer2Data);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      // Send to all (3 users)
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: {
          target: 'all',
          title: 'Обновление v2.0',
          message: 'Обновите расширение',
          severity: 'info',
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications/history',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { history: Array<Record<string, unknown>> };
      expect(body.history).toHaveLength(1);
      expect(body.history[0]!['title']).toBe('Обновление v2.0');
      expect(body.history[0]!['target_count']).toBe(3);
      expect(body.history[0]!['severity']).toBe('info');
    });

    it('respects limit parameter', async () => {
      await createUser(adminData);
      const token = await loginAndGetToken(adminData.email, adminData.password);

      // Send two separate notifications
      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: { target: 'admins', title: 'First', message: 'msg', severity: 'info' },
      });

      // Small delay to ensure different created_at second
      await new Promise((r) => setTimeout(r, 1100));

      await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/send',
        headers: { Authorization: `Bearer ${token}` },
        payload: { target: 'admins', title: 'Second', message: 'msg2', severity: 'warning' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications/history?limit=1',
        headers: { Authorization: `Bearer ${token}` },
      });

      const body = res.json() as { history: Array<Record<string, unknown>> };
      expect(body.history).toHaveLength(1);
      expect(body.history[0]!['title']).toBe('Second'); // most recent first
    });

    it('returns 403 for buyer', async () => {
      await createUser(buyerData);
      const token = await loginAndGetToken(buyerData.email, buyerData.password);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications/history',
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Settings integration — notifyOwnerAndAdmins respects settings
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Settings integration with notifyOwnerAndAdmins', () => {
    it('skips notification when setting is disabled', async () => {
      await createUser(adminData);
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      await seedSettings();

      // auto_ban_resolved is disabled in seed
      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      // Create account
      await pool.query(
        `INSERT INTO accounts (google_account_id, display_name, user_id)
         VALUES ('1234567890', '1234567890', $1)`,
        [buyerId],
      );

      const { notifyOwnerAndAdmins } = await import('../../services/notification.service.js');
      const result = await notifyOwnerAndAdmins(pool, buyerId, {
        type: 'ban_resolved',
        title: 'Бан снят',
        message: 'Аккаунт разбанен',
        severity: 'success',
        metadata: { account_google_id: '1234567890' },
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('disabled');
      expect(result.sent).toBe(0);
    });

    it('sends notification when setting is enabled', async () => {
      await createUser(adminData);
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      await seedSettings();

      // auto_ban_detected is enabled in seed
      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      await pool.query(
        `INSERT INTO accounts (google_account_id, display_name, user_id)
         VALUES ('1234567890', '1234567890', $1)`,
        [buyerId],
      );

      const { notifyOwnerAndAdmins } = await import('../../services/notification.service.js');
      const result = await notifyOwnerAndAdmins(pool, buyerId, {
        type: 'ban_detected',
        title: 'Аккаунт забанен',
        message: 'Причина: test',
        severity: 'critical',
        metadata: { account_google_id: '1234567890' },
      });

      expect(result.skipped).toBe(false);
      expect(result.sent).toBe(2); // owner + admin
    });

    it('overrides severity from settings', async () => {
      await createUser(adminData);
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      const buyerToken = await loginAndGetToken(buyerData.email, buyerData.password);
      await seedSettings();

      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      // Set severity to 'info' for auto_ban_detected (normally critical)
      await pool.query(
        `UPDATE notification_settings SET severity = 'info' WHERE key = 'auto_ban_detected'`,
      );

      // Invalidate cache
      const { invalidateCache } = await import('../../services/notification-settings.service.js');
      invalidateCache('auto_ban_detected');

      await pool.query(
        `INSERT INTO accounts (google_account_id, display_name, user_id)
         VALUES ('9999999999', '9999999999', $1)`,
        [buyerId],
      );

      const { notifyOwnerAndAdmins } = await import('../../services/notification.service.js');
      await notifyOwnerAndAdmins(pool, buyerId, {
        type: 'ban_detected',
        title: 'Test severity override',
        message: 'Should be info',
        severity: 'critical', // code says critical
        metadata: { account_google_id: '9999999999' },
      });

      // Check buyer's notification — should have 'info' not 'critical'
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: { Authorization: `Bearer ${buyerToken}` },
      });
      const body = res.json() as { notifications: Array<Record<string, unknown>> };
      const notif = body.notifications.find((n) => n['title'] === 'Test severity override');
      expect(notif).toBeDefined();
      expect(notif!['severity']).toBe('info'); // settings override wins
    });

    it('respects cooldown — skips duplicate within window', async () => {
      await createUser(adminData);
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      await seedSettings();

      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      // auto_risk_elevated has cooldown_minutes=60
      await pool.query(
        `INSERT INTO accounts (google_account_id, display_name, user_id)
         VALUES ('5555555555', '5555555555', $1)`,
        [buyerId],
      );

      const { notifyOwnerAndAdmins } = await import('../../services/notification.service.js');

      // First call — should send
      const first = await notifyOwnerAndAdmins(pool, buyerId, {
        type: 'risk_elevated',
        title: 'Risk elevated',
        message: 'First',
        severity: 'warning',
        metadata: { account_google_id: '5555555555' },
      });
      expect(first.skipped).toBe(false);
      expect(first.sent).toBeGreaterThan(0);

      // Second call immediately — should be on cooldown
      const second = await notifyOwnerAndAdmins(pool, buyerId, {
        type: 'risk_elevated',
        title: 'Risk elevated again',
        message: 'Second',
        severity: 'warning',
        metadata: { account_google_id: '5555555555' },
      });
      expect(second.skipped).toBe(true);
      expect(second.reason).toBe('cooldown');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. createNotificationChecked — respects settings
  // ═══════════════════════════════════════════════════════════════════════════

  describe('createNotificationChecked', () => {
    it('returns null when setting is disabled', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      await seedSettings();

      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      const { createNotificationChecked } = await import('../../services/notification.service.js');
      const result = await createNotificationChecked(pool, {
        userId: buyerId,
        type: 'account_connected', // disabled in seed
        title: 'Test',
        message: 'msg',
        severity: 'success',
      });

      expect(result).toBeNull();
    });

    it('creates notification when setting is enabled', async () => {
      const buyer = await createUser(buyerData);
      const buyerId = buyer['id'] as string;
      await seedSettings();

      const { getTestPool } = await import('../helpers/test-db.js');
      const pool = getTestPool();

      const { createNotificationChecked } = await import('../../services/notification.service.js');
      const result = await createNotificationChecked(pool, {
        userId: buyerId,
        type: 'ban_detected', // enabled in seed
        title: 'Test checked',
        message: 'msg',
        severity: 'warning',
      });

      expect(result).not.toBeNull();
      expect(result!['severity']).toBe('critical'); // overridden by settings
    });
  });
});
