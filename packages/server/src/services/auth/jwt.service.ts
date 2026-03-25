import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  role: 'admin' | 'buyer';
  name: string;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
}

const secret = env.JWT_SECRET;

export function generateAccessToken(user: { id: string; role: string; name: string }): string {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    secret,
    { algorithm: 'HS256', expiresIn: '1h' },
  );
}

export function generateRefreshToken(user: { id: string }): string {
  return jwt.sign(
    { sub: user.id, type: 'refresh' },
    secret,
    { algorithm: 'HS256', expiresIn: '7d' },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  const obj = payload as Record<string, unknown>;
  if (obj['type'] === 'refresh') {
    throw new Error('Expected access token, got refresh token');
  }
  return {
    sub: obj['sub'] as string,
    role: obj['role'] as 'admin' | 'buyer',
    name: obj['name'] as string,
  };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
  const obj = payload as Record<string, unknown>;
  if (obj['type'] !== 'refresh') {
    throw new Error('Expected refresh token, got access token');
  }
  return {
    sub: obj['sub'] as string,
    type: 'refresh',
  };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
