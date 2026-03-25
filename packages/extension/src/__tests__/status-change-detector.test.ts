import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock, clearStorage } from './helpers/chrome-mock.js';

// Must be set before importing modules
setupChromeMock();

import { extractAccountStatus, checkForStatusChange } from '../detectors/status-change-detector.js';
import { enqueueUrgent, hasUrgentItems, getQueue } from '../transport/queue.js';

describe('Status Change Detector', () => {
  beforeEach(() => {
    clearStorage();
  });

  // ── extractAccountStatus ──────────────────────────────────────────────────

  describe('extractAccountStatus', () => {
    it('detects suspended status from status field', () => {
      expect(extractAccountStatus({ status: 'SUSPENDED' })).toBe('suspended');
      expect(extractAccountStatus({ status: 'Account Suspended' })).toBe('suspended');
    });

    it('detects suspended status from accountStatus field', () => {
      expect(extractAccountStatus({ accountStatus: 'SUSPENDED' })).toBe('suspended');
    });

    it('detects banned status', () => {
      expect(extractAccountStatus({ status: 'banned' })).toBe('suspended');
    });

    it('detects active status', () => {
      expect(extractAccountStatus({ status: 'active' })).toBe('active');
      expect(extractAccountStatus({ status: 'ENABLED' })).toBe('active');
    });

    it('detects canceled status', () => {
      expect(extractAccountStatus({ status: 'canceled' })).toBe('canceled');
      expect(extractAccountStatus({ status: 'closed' })).toBe('canceled');
    });

    it('returns null for unknown status', () => {
      expect(extractAccountStatus({ status: 'pending_review' })).toBeNull();
    });

    it('returns null for missing status fields', () => {
      expect(extractAccountStatus({ name: 'Test Account' })).toBeNull();
    });

    it('detects suspended from signals array', () => {
      const data = {
        signals: [
          { name: 'account_suspended', value: { '1': true } },
        ],
      };
      expect(extractAccountStatus(data)).toBe('suspended');
    });

    it('ignores non-suspended signal values', () => {
      const data = {
        signals: [
          { name: 'account_suspended', value: { '1': false } },
        ],
      };
      expect(extractAccountStatus(data)).toBeNull();
    });
  });

  // ── checkForStatusChange ──────────────────────────────────────────────────

  describe('checkForStatusChange', () => {
    it('returns null for first status observation (no previous)', async () => {
      const change = await checkForStatusChange('acc-123', 'active');
      expect(change).toBeNull();
    });

    it('returns null when status stays the same', async () => {
      await checkForStatusChange('acc-123', 'active');
      const change = await checkForStatusChange('acc-123', 'active');
      expect(change).toBeNull();
    });

    it('detects active → suspended transition', async () => {
      await checkForStatusChange('acc-123', 'active');
      const change = await checkForStatusChange('acc-123', 'suspended');
      expect(change).not.toBeNull();
      expect(change!.previous_status).toBe('active');
      expect(change!.new_status).toBe('suspended');
      expect(change!.account_id).toBe('acc-123');
    });

    it('detects suspended → active transition', async () => {
      await checkForStatusChange('acc-123', 'suspended');
      const change = await checkForStatusChange('acc-123', 'active');
      expect(change).not.toBeNull();
      expect(change!.previous_status).toBe('suspended');
      expect(change!.new_status).toBe('active');
    });

    it('tracks multiple accounts independently', async () => {
      await checkForStatusChange('acc-1', 'active');
      await checkForStatusChange('acc-2', 'active');

      // Only acc-1 changes
      const change1 = await checkForStatusChange('acc-1', 'suspended');
      const change2 = await checkForStatusChange('acc-2', 'active');

      expect(change1).not.toBeNull();
      expect(change2).toBeNull();
    });

    it('includes detected_at timestamp', async () => {
      await checkForStatusChange('acc-123', 'active');
      const before = new Date().toISOString();
      const change = await checkForStatusChange('acc-123', 'suspended');
      const after = new Date().toISOString();
      expect(change!.detected_at >= before).toBe(true);
      expect(change!.detected_at <= after).toBe(true);
    });
  });

  // ── Priority Queue Integration ────────────────────────────────────────────

  describe('enqueueUrgent', () => {
    it('enqueues items with urgent priority', async () => {
      await enqueueUrgent('status_change', { accountId: '123', newStatus: 'suspended' });
      const queue = await getQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0]!.priority).toBe('urgent');
      expect(queue[0]!.type).toBe('status_change');
    });

    it('hasUrgentItems returns true when urgent items exist', async () => {
      expect(await hasUrgentItems()).toBe(false);
      await enqueueUrgent('status_change', { accountId: '123' });
      expect(await hasUrgentItems()).toBe(true);
    });
  });
});
