import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.service.js';

describe('Password Service', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('Str0ngP@ss');

    expect(hash).toBeTypeOf('string');
    expect(hash).not.toBe('Str0ngP@ss');
    expect(hash.startsWith('$2b$')).toBe(true); // bcrypt prefix

    const valid = await verifyPassword('Str0ngP@ss', hash);
    expect(valid).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct-password');

    const valid = await verifyPassword('wrong-password', hash);
    expect(valid).toBe(false);
  });

  it('produces different hashes for same password (salt)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');

    expect(hash1).not.toBe(hash2); // different salts
  });

  it('uses cost factor 12', async () => {
    const hash = await hashPassword('test');

    // bcrypt format: $2b$12$...
    expect(hash).toMatch(/^\$2b\$12\$/);
  });
});
