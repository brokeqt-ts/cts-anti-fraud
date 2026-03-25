import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg pool
function createMockPool(rows: Record<string, unknown>[] = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
  } as unknown as import('pg').Pool;
}

describe('notification-settings.service', () => {
  beforeEach(async () => {
    // Reset module cache to clear the in-memory Map between tests
    vi.resetModules();
  });

  describe('getSettingCached', () => {
    it('fetches from DB on cache miss', async () => {
      const { getSettingCached } = await import('./notification-settings.service.js');
      const row = { id: '1', key: 'auto_ban_detected', enabled: true, label: 'Test', description: null, severity: 'critical', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const pool = createMockPool([row]);

      const result = await getSettingCached(pool, 'auto_ban_detected');

      expect(result).toEqual(row);
      expect(pool.query).toHaveBeenCalledOnce();
    });

    it('returns cached value on second call', async () => {
      const { getSettingCached } = await import('./notification-settings.service.js');
      const row = { id: '1', key: 'auto_ban_detected', enabled: true, label: 'Test', description: null, severity: 'critical', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const pool = createMockPool([row]);

      await getSettingCached(pool, 'auto_ban_detected');
      const result = await getSettingCached(pool, 'auto_ban_detected');

      expect(result).toEqual(row);
      expect(pool.query).toHaveBeenCalledOnce(); // only 1 DB call, second was cache hit
    });

    it('returns null for missing key and does not cache null', async () => {
      const { getSettingCached } = await import('./notification-settings.service.js');
      const pool = createMockPool([]);

      const result1 = await getSettingCached(pool, 'missing_key');
      expect(result1).toBeNull();

      const result2 = await getSettingCached(pool, 'missing_key');
      expect(result2).toBeNull();
      expect(pool.query).toHaveBeenCalledTimes(2); // both went to DB since null not cached
    });
  });

  describe('invalidateCache', () => {
    it('forces re-fetch after invalidation', async () => {
      const { getSettingCached, invalidateCache } = await import('./notification-settings.service.js');
      const row = { id: '1', key: 'auto_ban_detected', enabled: true, label: 'Test', description: null, severity: 'critical', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const pool = createMockPool([row]);

      await getSettingCached(pool, 'auto_ban_detected');
      invalidateCache('auto_ban_detected');
      await getSettingCached(pool, 'auto_ban_detected');

      expect(pool.query).toHaveBeenCalledTimes(2); // invalidation caused re-fetch
    });
  });

  describe('invalidateAllCache', () => {
    it('clears all cached entries', async () => {
      const { getSettingCached, invalidateAllCache } = await import('./notification-settings.service.js');
      const row1 = { id: '1', key: 'key1', enabled: true, label: 'L1', description: null, severity: 'info', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const row2 = { id: '2', key: 'key2', enabled: false, label: 'L2', description: null, severity: 'warning', notify_owner: false, notify_admins: false, cooldown_minutes: 30, created_at: '', updated_at: '' };

      const pool1 = createMockPool([row1]);
      const pool2 = createMockPool([row2]);

      await getSettingCached(pool1, 'key1');
      await getSettingCached(pool2, 'key2');

      invalidateAllCache();

      // After clearing, both keys should re-fetch
      const pool3 = createMockPool([row1]);
      await getSettingCached(pool3, 'key1');
      expect(pool3.query).toHaveBeenCalledOnce();
    });
  });

  describe('isEnabled', () => {
    it('returns true when setting is enabled', async () => {
      const { isEnabled } = await import('./notification-settings.service.js');
      const row = { id: '1', key: 'auto_ban_detected', enabled: true, label: 'Test', description: null, severity: 'critical', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const pool = createMockPool([row]);

      const result = await isEnabled(pool, 'auto_ban_detected');
      expect(result).toBe(true);
    });

    it('returns false when setting is disabled', async () => {
      const { isEnabled } = await import('./notification-settings.service.js');
      const row = { id: '1', key: 'auto_ban_resolved', enabled: false, label: 'Test', description: null, severity: 'success', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const pool = createMockPool([row]);

      const result = await isEnabled(pool, 'auto_ban_resolved');
      expect(result).toBe(false);
    });

    it('returns false when setting does not exist', async () => {
      const { isEnabled } = await import('./notification-settings.service.js');
      const pool = createMockPool([]);

      const result = await isEnabled(pool, 'non_existent');
      expect(result).toBe(false);
    });
  });

  describe('updateSetting', () => {
    it('invalidates cache after update', async () => {
      const { getSettingCached, updateSetting } = await import('./notification-settings.service.js');
      const originalRow = { id: '1', key: 'auto_ban_detected', enabled: true, label: 'Test', description: null, severity: 'critical', notify_owner: true, notify_admins: true, cooldown_minutes: 0, created_at: '', updated_at: '' };
      const updatedRow = { ...originalRow, enabled: false };

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [originalRow], rowCount: 1 }) // getSettingCached
          .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 }) // updateSetting
          .mockResolvedValueOnce({ rows: [updatedRow], rowCount: 1 }), // getSettingCached after invalidation
      } as unknown as import('pg').Pool;

      // Populate cache
      await getSettingCached(pool, 'auto_ban_detected');

      // Update
      const result = await updateSetting(pool, 'auto_ban_detected', { enabled: false });
      expect(result).toEqual(updatedRow);

      // Next getSettingCached should re-fetch (cache invalidated)
      await getSettingCached(pool, 'auto_ban_detected');
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('returns null for non-existent key', async () => {
      const { updateSetting } = await import('./notification-settings.service.js');
      const pool = createMockPool([]); // UPDATE returns 0 rows

      const result = await updateSetting(pool, 'missing', { enabled: true });
      expect(result).toBeNull();
    });
  });

  describe('isCooldownActive', () => {
    it('returns false when cooldownMinutes is 0', async () => {
      const { isCooldownActive } = await import('./notification-settings.service.js');
      const pool = createMockPool();

      const result = await isCooldownActive(pool, 'ban_detected', '12345', 0);
      expect(result).toBe(false);
      expect(pool.query).not.toHaveBeenCalled(); // no DB query needed
    });

    it('returns true when recent notification exists', async () => {
      const { isCooldownActive } = await import('./notification-settings.service.js');
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '1': 1 }], rowCount: 1 }),
      } as unknown as import('pg').Pool;

      const result = await isCooldownActive(pool, 'risk_elevated', '5555555555', 60);
      expect(result).toBe(true);
    });

    it('returns false when no recent notification', async () => {
      const { isCooldownActive } = await import('./notification-settings.service.js');
      const pool = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      } as unknown as import('pg').Pool;

      const result = await isCooldownActive(pool, 'risk_elevated', '5555555555', 60);
      expect(result).toBe(false);
    });
  });
});
