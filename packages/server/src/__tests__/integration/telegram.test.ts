import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for telegram-bot.service.ts
 *
 * These tests mock global fetch so they run without a real Telegram bot token.
 */

describe('telegram-bot.service', () => {
  let sendMessage: typeof import('../../services/telegram-bot.service.js').sendMessage;
  let sendBanAlert: typeof import('../../services/telegram-bot.service.js').sendBanAlert;
  let sendTestMessage: typeof import('../../services/telegram-bot.service.js').sendTestMessage;

  beforeEach(async () => {
    // Reset module state between tests
    vi.resetModules();

    // Set required env vars
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token-123';
    process.env['TELEGRAM_CHAT_ID'] = '-100123456789';
    process.env['TELEGRAM_ENABLED'] = 'true';
    process.env['DASHBOARD_URL'] = 'http://localhost:5173';

    // Re-import env + service after env changes
    const { env } = await import('../../config/env.js');
    // Patch env directly since it's already loaded as a singleton
    Object.assign(env, {
      TELEGRAM_BOT_TOKEN: 'test-token-123',
      TELEGRAM_CHAT_ID: '-100123456789',
      TELEGRAM_ENABLED: true,
      DASHBOARD_URL: 'http://localhost:5173',
    });

    const svc = await import('../../services/telegram-bot.service.js');
    sendMessage = svc.sendMessage;
    sendBanAlert = svc.sendBanAlert;
    sendTestMessage = svc.sendTestMessage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── sendMessage ────────────────────────────────────────────────────────────

  it('sendMessage returns true on successful 200 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test message');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.telegram.org');
    expect(url).toContain('test-token-123');
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body['chat_id']).toBe('-100123456789');
    expect(body['text']).toBe('Test message');
    expect(body['parse_mode']).toBe('HTML');
  });

  it('sendMessage returns false when TELEGRAM_ENABLED is false', async () => {
    const { env } = await import('../../config/env.js');
    Object.assign(env, { TELEGRAM_ENABLED: false });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sendMessage returns false when BOT_TOKEN is null', async () => {
    const { env } = await import('../../config/env.js');
    Object.assign(env, { TELEGRAM_BOT_TOKEN: null });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test');
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sendMessage retries on 429 rate limit response', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ parameters: { retry_after: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test');
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sendMessage returns false after 3 failed attempts with network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test');
    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('sendMessage returns false immediately on 403 (non-retryable)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendMessage('-100123456789', 'Test');
    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ─── sendBanAlert ───────────────────────────────────────────────────────────

  it('sendBanAlert formats message correctly', async () => {
    const capturedBody: Record<string, unknown>[] = [];
    const mockFetch = vi.fn().mockImplementation((_url: unknown, options: RequestInit) => {
      capturedBody.push(JSON.parse(options.body as string) as Record<string, unknown>);
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    await sendBanAlert({
      accountGoogleId: '1234567890',
      banReason: 'UNACCEPTABLE_BUSINESS_PRACTICES',
      domain: 'example.com',
      offerVertical: 'nutra',
      lifetimeHours: 72,
      totalSpend: 1500.50,
      lastRiskScore: 85,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = capturedBody[0]!;
    expect(body['chat_id']).toBe('-100123456789');
    const text = body['text'] as string;
    expect(text).toContain('БАН АККАУНТА');
    expect(text).toContain('123-456-7890');
    expect(text).toContain('UNACCEPTABLE_BUSINESS_PRACTICES');
    expect(text).toContain('72ч');
    expect(text).toContain('85/100');
  });

  it('sendBanAlert skips send when TELEGRAM_CHAT_ID is null', async () => {
    const { env } = await import('../../config/env.js');
    Object.assign(env, { TELEGRAM_CHAT_ID: null });

    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await sendBanAlert({
      accountGoogleId: '1234567890',
      banReason: null,
      domain: null,
      offerVertical: null,
      lifetimeHours: null,
      totalSpend: null,
      lastRiskScore: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── sendTestMessage ────────────────────────────────────────────────────────

  it('sendTestMessage sends to specified chat ID', async () => {
    const capturedBody: Record<string, unknown>[] = [];
    const mockFetch = vi.fn().mockImplementation((_url: unknown, options: RequestInit) => {
      capturedBody.push(JSON.parse(options.body as string) as Record<string, unknown>);
      return Promise.resolve({ ok: true, status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await sendTestMessage('-9999999');
    expect(result).toBe(true);
    expect(capturedBody[0]?.['chat_id']).toBe('-9999999');
    const text = capturedBody[0]?.['text'] as string;
    expect(text).toContain('тест уведомления');
  });
});
