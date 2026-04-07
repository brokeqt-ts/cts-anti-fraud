import { describe, it, expect } from 'vitest';
import { isValidCid } from './ensure-account.js';

describe('isValidCid', () => {
  it('accepts 7-digit CID', () => {
    expect(isValidCid('1234567')).toBe(true);
  });

  it('accepts 10-digit CID', () => {
    expect(isValidCid('7923171594')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidCid('')).toBe(false);
  });

  it('rejects 6-digit number (too short)', () => {
    expect(isValidCid('123456')).toBe(false);
  });

  it('rejects 11-digit number (too long)', () => {
    expect(isValidCid('12345678901')).toBe(false);
  });

  it('rejects non-numeric string', () => {
    expect(isValidCid('abc1234567')).toBe(false);
  });

  it('rejects Google internal IDs like __c (if > 10 digits)', () => {
    expect(isValidCid('99368533061')).toBe(false);
  });

  it('accepts __c values that happen to be 10 digits', () => {
    // This is a known limitation — 10-digit internal IDs pass validation.
    // The fix is in extractCid (only using ocid, not __c).
    expect(isValidCid('9936853306')).toBe(true);
  });
});
