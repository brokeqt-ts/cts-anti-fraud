import { describe, it, expect } from 'vitest';

// We can't import the actual collector (needs DOM/chrome APIs),
// so we test the hash computation logic independently.

describe('Fingerprint Hash', () => {
  // Replicate computeFingerprintHash logic for testing
  async function computeFingerprintHash(data: Record<string, unknown>): Promise<string> {
    const normalized = JSON.stringify(data, Object.keys(data).sort());
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
    return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const baseFingerprintData = {
    screen_width: 1920,
    screen_height: 1080,
    device_pixel_ratio: 1,
    color_depth: 24,
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    language: 'en-US',
    languages: ['en-US', 'en'],
    platform: 'Win32',
    hardware_concurrency: 8,
    device_memory: 8,
    webgl_vendor: 'Google Inc.',
    webgl_renderer: 'ANGLE (Intel HD Graphics)',
    timezone: 'America/New_York',
    timezone_offset: 300,
    canvas_hash: 'abc123def456',
    detected_font_count: 12,
  };

  it('produces consistent hash for same input', async () => {
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(baseFingerprintData);
    expect(hash1).toBe(hash2);
  });

  it('produces 64-character hex hash', async () => {
    const hash = await computeFingerprintHash(baseFingerprintData);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when screen resolution changes', async () => {
    const modified = { ...baseFingerprintData, screen_width: 2560 };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('changes when user agent changes', async () => {
    const modified = { ...baseFingerprintData, user_agent: 'Mozilla/5.0 (Macintosh)' };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('changes when WebGL renderer changes', async () => {
    const modified = { ...baseFingerprintData, webgl_renderer: 'ANGLE (NVIDIA GeForce)' };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('changes when timezone changes', async () => {
    const modified = { ...baseFingerprintData, timezone: 'Europe/London', timezone_offset: 0 };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('changes when canvas hash changes', async () => {
    const modified = { ...baseFingerprintData, canvas_hash: 'different_hash' };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });

  it('changes when font count changes', async () => {
    const modified = { ...baseFingerprintData, detected_font_count: 15 };
    const hash1 = await computeFingerprintHash(baseFingerprintData);
    const hash2 = await computeFingerprintHash(modified);
    expect(hash1).not.toBe(hash2);
  });
});
