import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { verifyPassword, hashPassword } from '../services/auth/password.service.js';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../services/auth/jwt.service.js';

const pool = getPool(env.DATABASE_URL);

// Pre-computed bcrypt hash of random string, cost 12 — used for timing equalization
const DUMMY_HASH = '$2b$12$x/UHmGpNkXDqEOEJiYMm9e9F8XGVLqVSQFdXFGqKpfGE7WbJrlm8i';

// POST /auth/login
export async function loginHandler(
  request: FastifyRequest<{ Body: { email: string; password: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { email, password } = request.body;

  // 1. Find user by email
  const userResult = await pool.query(
    `SELECT id, name, email, password_hash, role
     FROM users
     WHERE email = $1 AND is_active = true`,
    [email],
  );

  if (userResult.rows.length === 0) {
    await verifyPassword(password, DUMMY_HASH); // timing equalization
    await reply.status(401).send({
      error: 'Неверный email или пароль',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  const user = userResult.rows[0] as {
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: string;
  };

  // 2. Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await reply.status(401).send({
      error: 'Неверный email или пароль',
      code: 'INVALID_CREDENTIALS',
    });
    return;
  }

  // 3. Generate tokens
  const accessToken = generateAccessToken({ id: user.id, role: user.role, name: user.name });
  const refreshToken = generateRefreshToken({ id: user.id });

  // 4. Save refresh token hash
  const tokenHash = hashToken(refreshToken);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, tokenHash],
  );

  // 5. Update last_login_at
  await pool.query(
    `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
    [user.id],
  );

  // 6. Return tokens + user info
  await reply.status(200).send({
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

// POST /auth/refresh
export async function refreshHandler(
  request: FastifyRequest<{ Body: { refresh_token: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { refresh_token } = request.body;

  // 1. Verify JWT structure
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refresh_token);
  } catch {
    await reply.status(401).send({
      error: 'Invalid refresh token',
      code: 'REFRESH_TOKEN_INVALID',
    });
    return;
  }

  // 2. Look up token hash in DB
  const tokenHash = hashToken(refresh_token);
  const tokenResult = await pool.query(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [tokenHash],
  );

  if (tokenResult.rows.length === 0) {
    await reply.status(401).send({
      error: 'Invalid refresh token',
      code: 'REFRESH_TOKEN_INVALID',
    });
    return;
  }

  const tokenRow = tokenResult.rows[0] as { id: string; user_id: string };

  // 3. Delete used refresh token (rotation)
  await pool.query(`DELETE FROM refresh_tokens WHERE id = $1`, [tokenRow.id]);

  // 4. Verify user still active
  const userResult = await pool.query(
    `SELECT id, name, role FROM users WHERE id = $1 AND is_active = true`,
    [payload.sub],
  );

  if (userResult.rows.length === 0) {
    await reply.status(401).send({
      error: 'Invalid refresh token',
      code: 'REFRESH_TOKEN_INVALID',
    });
    return;
  }

  const user = userResult.rows[0] as { id: string; name: string; role: string };

  // 5. Generate new token pair
  const newAccessToken = generateAccessToken({ id: user.id, role: user.role, name: user.name });
  const newRefreshToken = generateRefreshToken({ id: user.id });

  // 6. Save new refresh token hash
  const newTokenHash = hashToken(newRefreshToken);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, newTokenHash],
  );

  await reply.status(200).send({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
  });
}

// POST /auth/logout
export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const body = (request.body ?? {}) as { refresh_token?: string };
  const { refresh_token } = body;

  if (refresh_token) {
    // Delete specific refresh token
    const tokenHash = hashToken(refresh_token);
    await pool.query(
      `DELETE FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2`,
      [tokenHash, userId],
    );
  } else {
    // Delete all refresh tokens for this user
    await pool.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId],
    );
  }

  await reply.status(200).send({ status: 'ok' });
}

// PATCH /auth/me/password
export async function changePasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const { current_password, new_password } = request.body as { current_password: string; new_password: string };

  const pool = getPool(env.DATABASE_URL);

  const userResult = await pool.query(
    `SELECT id, password_hash FROM users WHERE id = $1 AND is_active = true`,
    [userId],
  );

  if (userResult.rows.length === 0) {
    await reply.status(404).send({ error: 'User not found', code: 'USER_NOT_FOUND' });
    return;
  }

  const user = userResult.rows[0] as { id: string; password_hash: string };

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) {
    await reply.status(400).send({ error: 'Неверный текущий пароль', code: 'WRONG_CURRENT_PASSWORD' });
    return;
  }

  const newHash = await hashPassword(new_password);

  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

  // Invalidate all refresh tokens
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);

  await reply.send({ message: 'Password updated' });
}

// PATCH /auth/adspower-key
export async function updateAdspowerKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;
  const { adspower_api_key } = request.body as { adspower_api_key: string };

  await pool.query(
    `UPDATE users SET adspower_api_key = $1 WHERE id = $2`,
    [adspower_api_key, userId],
  );
  await reply.status(200).send({ status: 'ok' });
}

// GET /auth/me
export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user!.id;

  // Legacy API key user — return minimal info
  if (userId === 'legacy') {
    await reply.status(200).send({
      id: 'legacy',
      name: 'Legacy API Key',
      email: null,
      role: 'admin',
      api_key: null,
    });
    return;
  }

  const result = await pool.query(
    `SELECT id, name, email, role, api_key, adspower_api_key FROM users WHERE id = $1`,
    [userId],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  const user = result.rows[0] as {
    id: string;
    name: string;
    email: string;
    role: string;
    api_key: string | null;
    adspower_api_key: string | null;
  };

  // Mask API key: first 8 chars + ***
  const maskedKey = user.api_key
    ? user.api_key.slice(0, 8) + '***'
    : null;

  await reply.status(200).send({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    api_key: maskedKey,
    adspower_api_key: user.adspower_api_key ?? null,
  });
}
