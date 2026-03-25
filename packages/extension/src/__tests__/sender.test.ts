import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock, clearStorage } from './helpers/chrome-mock.js';

setupChromeMock();

import { enqueue } from '../transport/queue.js';
import { testConnection } from '../transport/sender.js';

describe('Sender', () => {
  beforeEach(() => {
    clearStorage();
    vi.restoreAllMocks();
  });

  describe('testConnection', () => {
    it('returns true when server responds OK', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch;

      const result = await testConnection({
        serverUrl: 'http://localhost:3000',
        apiKey: 'test',
        profileId: 'p1',
        batchIntervalMs: 30000,
        maxRetries: 3,
      });
      expect(result).toBe(true);

      globalThis.fetch = originalFetch;
    });

    it('returns false when server is unreachable', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused')) as typeof fetch;

      const result = await testConnection({
        serverUrl: 'http://localhost:9999',
        apiKey: 'test',
        profileId: 'p1',
        batchIntervalMs: 30000,
        maxRetries: 3,
      });
      expect(result).toBe(false);

      globalThis.fetch = originalFetch;
    });

    it('calls correct health URL', async () => {
      const originalFetch = globalThis.fetch;
      const mockFetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch;
      globalThis.fetch = mockFetch;

      await testConnection({
        serverUrl: 'http://my-server.com/',
        apiKey: 'my-key',
        profileId: 'p1',
        batchIntervalMs: 30000,
        maxRetries: 3,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://my-server.com/api/v1/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'X-API-Key': 'my-key' }),
        }),
      );

      globalThis.fetch = originalFetch;
    });
  });

  describe('queue integration', () => {
    it('queue is populated before send', async () => {
      await enqueue('account', { accountId: '123' });
      await enqueue('campaign', { campaignId: '456' });

      const { getQueueSize } = await import('../transport/queue.js');
      const size = await getQueueSize();
      expect(size).toBe(2);
    });
  });
});
