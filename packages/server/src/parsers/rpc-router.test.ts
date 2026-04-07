import { describe, it, expect } from 'vitest';

// We test the exported helpers directly; internal functions are tested via behavior.
// Import the module to access exported functions.
import { resolveCid, parseCidFromNickname, isValidGoogleCid } from './rpc-router.js';
import type { RpcContext } from './rpc-router.js';

describe('extractCid behavior (via resolveCid)', () => {
  function makeCtx(overrides: Partial<RpcContext> = {}): RpcContext {
    return {
      pool: null as unknown as RpcContext['pool'],
      rawPayloadId: 'test-id',
      sourceUrl: 'https://ads.google.com/aw/_/rpc/Test?authuser=0',
      accountGoogleId: null,
      profileId: null,
      body: {},
      ...overrides,
    };
  }

  it('returns accountGoogleId when set (from ocid)', () => {
    const ctx = makeCtx({ accountGoogleId: '7923171594' });
    expect(resolveCid(ctx)).toBe('7923171594');
  });

  it('returns null when no CID available', () => {
    const ctx = makeCtx();
    expect(resolveCid(ctx)).toBeNull();
  });

  it('falls back to profileId if it looks like a valid CID', () => {
    const ctx = makeCtx({ profileId: '7923171594' });
    expect(resolveCid(ctx)).toBe('7923171594');
  });

  it('does NOT use profileId if it is not a valid CID format', () => {
    const ctx = makeCtx({ profileId: 'ATVanya333' });
    expect(resolveCid(ctx)).toBeNull();
  });

  it('prefers accountGoogleId over profileId', () => {
    const ctx = makeCtx({ accountGoogleId: '1111111111', profileId: '2222222222' });
    expect(resolveCid(ctx)).toBe('1111111111');
  });

  it('uses bodyCustomerId hint when accountGoogleId is null', () => {
    const ctx = makeCtx();
    expect(resolveCid(ctx, { bodyCustomerId: '3333333333' })).toBe('3333333333');
  });
});

describe('isValidGoogleCid', () => {
  it('accepts 7-digit CID', () => {
    expect(isValidGoogleCid('1234567')).toBe(true);
  });

  it('accepts 10-digit CID', () => {
    expect(isValidGoogleCid('7923171594')).toBe(true);
  });

  it('rejects 6-digit number', () => {
    expect(isValidGoogleCid('123456')).toBe(false);
  });

  it('accepts 13-digit CID', () => {
    expect(isValidGoogleCid('1234567890123')).toBe(true);
  });

  it('rejects 14-digit number', () => {
    expect(isValidGoogleCid('12345678901234')).toBe(false);
  });

  it('rejects non-numeric string', () => {
    expect(isValidGoogleCid('ATVanya333')).toBe(false);
  });
});

describe('parseCidFromNickname', () => {
  it('parses "Google Ads 385-165-5493" to "3851655493"', () => {
    expect(parseCidFromNickname('Google Ads 385-165-5493')).toBe('3851655493');
  });

  it('returns null for non-matching string', () => {
    expect(parseCidFromNickname('My Account')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseCidFromNickname('')).toBeNull();
  });
});
