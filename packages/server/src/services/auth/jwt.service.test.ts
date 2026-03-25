import { describe, it, expect, beforeAll } from 'vitest';

// JWT_SECRET must be set before importing the service (it reads env at module scope)
beforeAll(() => {
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/cts_test';
  process.env['API_KEY'] = 'test-key';
  process.env['JWT_SECRET'] = 'test-jwt-secret-for-unit-tests';
});

describe('JWT Service', () => {
  it('generates and verifies access token', async () => {
    const { generateAccessToken, verifyAccessToken } = await import('./jwt.service.js');

    const user = { id: 'user-123', role: 'admin', name: 'Test Admin' };
    const token = generateAccessToken(user);

    expect(token).toBeTypeOf('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe('admin');
    expect(payload.name).toBe('Test Admin');
  });

  it('generates and verifies refresh token', async () => {
    const { generateRefreshToken, verifyRefreshToken } = await import('./jwt.service.js');

    const user = { id: 'user-456' };
    const token = generateRefreshToken(user);

    expect(token).toBeTypeOf('string');

    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-456');
    expect(payload.type).toBe('refresh');
  });

  it('rejects refresh token when verifying as access token', async () => {
    const { generateRefreshToken, verifyAccessToken } = await import('./jwt.service.js');

    const token = generateRefreshToken({ id: 'user-789' });

    expect(() => verifyAccessToken(token)).toThrow('Expected access token, got refresh token');
  });

  it('rejects access token when verifying as refresh token', async () => {
    const { generateAccessToken, verifyRefreshToken } = await import('./jwt.service.js');

    const token = generateAccessToken({ id: 'user-101', role: 'buyer', name: 'Test' });

    expect(() => verifyRefreshToken(token)).toThrow('Expected refresh token, got access token');
  });

  it('rejects tampered token', async () => {
    const { generateAccessToken, verifyAccessToken } = await import('./jwt.service.js');

    const token = generateAccessToken({ id: 'user-102', role: 'admin', name: 'X' });
    const tampered = token.slice(0, -5) + 'XXXXX';

    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('hashToken produces consistent SHA-256 hex digest', async () => {
    const { hashToken } = await import('./jwt.service.js');

    const hash1 = hashToken('test-token');
    const hash2 = hashToken('test-token');

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
    expect(hash1).toMatch(/^[0-9a-f]+$/);
  });

  it('hashToken produces different hashes for different inputs', async () => {
    const { hashToken } = await import('./jwt.service.js');

    const hash1 = hashToken('token-a');
    const hash2 = hashToken('token-b');

    expect(hash1).not.toBe(hash2);
  });
});
