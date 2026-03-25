import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateCost, fetchWithRetry } from './base.js';

// --- estimateCost ---

describe('estimateCost', () => {
  it('calculates Claude cost correctly', () => {
    // 1000 input * $3/1M + 500 output * $15/1M = 0.003 + 0.0075 = 0.0105
    const cost = estimateCost('claude-sonnet-4-20250514', 1000, 500);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('calculates GPT-4o cost correctly', () => {
    // 1000 input * $2.5/1M + 500 output * $10/1M = 0.0025 + 0.005 = 0.0075
    const cost = estimateCost('gpt-4o', 1000, 500);
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('calculates Gemini 2.5 Flash cost correctly', () => {
    // 1000 input * $0.15/1M + 500 output * $0.6/1M = 0.00015 + 0.0003 = 0.00045
    const cost = estimateCost('gemini-2.5-flash', 1000, 500);
    expect(cost).toBeCloseTo(0.00045, 6);
  });

  it('uses fallback pricing for unknown models', () => {
    // 1000 * $1/1M + 500 * $3/1M = 0.001 + 0.0015 = 0.0025
    const cost = estimateCost('unknown-model', 1000, 500);
    expect(cost).toBeCloseTo(0.0025, 6);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('gpt-4o', 0, 0)).toBe(0);
  });
});

// --- fetchWithRetry ---

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns response on 200', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const res = await fetchWithRetry('https://example.com', {}, 0);
    expect(res.status).toBe(200);
  });

  it('returns response immediately on 401 without retry', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', mockFetch);

    const res = await fetchWithRetry('https://example.com', {}, 2);
    expect(res.status).toBe(401);
    // Should NOT retry — only 1 call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns response immediately on 403 without retry', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', mockFetch);

    const res = await fetchWithRetry('https://example.com', {}, 2);
    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const res = await fetchWithRetry('https://example.com', {}, 1);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 500 then succeeds', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const res = await fetchWithRetry('https://example.com', {}, 1);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);

    await expect(fetchWithRetry('https://example.com', {}, 1)).rejects.toThrow('network error');
    expect(mockFetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});
