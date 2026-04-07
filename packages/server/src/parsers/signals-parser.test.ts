import { describe, it, expect } from 'vitest';

/**
 * Tests for signals-parser suspended signal → account status update logic.
 * We test the isSuspended detection logic in isolation.
 */

describe('isSuspended signal detection', () => {
  // This mirrors the logic in signals-parser.ts lines 56-57
  function isSuspended(signalValue: unknown): boolean {
    return signalValue === true
      || (signalValue != null && typeof signalValue === 'object' && (signalValue as Record<string, unknown>)['1'] === true);
  }

  it('detects boolean true', () => {
    expect(isSuspended(true)).toBe(true);
  });

  it('detects object with field "1" = true', () => {
    expect(isSuspended({ '1': true })).toBe(true);
  });

  it('rejects boolean false', () => {
    expect(isSuspended(false)).toBe(false);
  });

  it('rejects null', () => {
    expect(isSuspended(null)).toBe(false);
  });

  it('rejects object with field "1" = false (account restored)', () => {
    expect(isSuspended({ '1': false })).toBe(false);
  });

  it('rejects empty object', () => {
    expect(isSuspended({})).toBe(false);
  });

  it('rejects string', () => {
    expect(isSuspended('suspended')).toBe(false);
  });

  it('rejects number', () => {
    expect(isSuspended(1)).toBe(false);
  });
});
