import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { hashPassword } from '../services/auth/password.service.js';
import { audit } from '../services/audit.service.js';

const pool = getPool(env.DATABASE_URL);

// GET /admin/users
export async function listUsersHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await pool.query(
    `SELECT id, name, email, role, api_key_scope, is_active,
            last_login_at, created_at, updated_at
     FROM users
     ORDER BY created_at DESC`,
  );

  await reply.status(200).send({ users: result.rows });
}

// POST /admin/users
export async function createUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { name, email, password, role } = request.body as {
    name: string;
    email: string;
    password: string;
    role?: string;
  };
  const userRole = role ?? 'buyer';

  // Check duplicate email
  const existing = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    [email],
  );
  if (existing.rows.length > 0) {
    await reply.status(409).send({
      error: 'Пользователь с таким email уже существует',
      code: 'EMAIL_EXISTS',
    });
    return;
  }

  const passwordHash = await hashPassword(password);
  const apiKey = `cts_${crypto.randomBytes(32).toString('hex')}`;

  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, api_key, api_key_scope)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, role, api_key, api_key_scope, is_active, created_at`,
    [name, email, passwordHash, userRole, apiKey, userRole === 'admin' ? 'full' : 'collect_only'],
  );

  const user = result.rows[0] as Record<string, unknown>;

  audit(pool, request, 'user.create', { entityType: 'user', entityId: user['id'] as string, details: { name, email, role } });
  await reply.status(201).send({ user });
}

// GET /admin/users/:id
export async function getUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };

  const result = await pool.query(
    `SELECT id, name, email, role, api_key_scope, is_active,
            last_login_at, created_at, updated_at
     FROM users WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({
      error: 'Пользователь не найден',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  await reply.status(200).send({ user: result.rows[0] });
}

// PATCH /admin/users/:id
export async function updateUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const { name, email, role, is_active, api_key_scope, antidetect_browser } = request.body as {
    name?: string;
    email?: string;
    role?: string;
    is_active?: boolean;
    api_key_scope?: string;
    antidetect_browser?: string;
  };

  // Prevent self-deactivation
  if (is_active === false && id === request.user!.id) {
    await reply.status(400).send({
      error: 'Нельзя деактивировать самого себя',
      code: 'SELF_DEACTIVATE',
    });
    return;
  }

  // Prevent self-demote
  if (id === request.user!.id && role === 'buyer') {
    await reply.status(400).send({
      error: 'Нельзя понизить свою роль',
      code: 'SELF_DEMOTE',
    });
    return;
  }

  // Check user exists
  const existing = await pool.query(`SELECT id FROM users WHERE id = $1`, [id]);
  if (existing.rows.length === 0) {
    await reply.status(404).send({
      error: 'Пользователь не найден',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  // Check duplicate email if changing
  if (email) {
    const dup = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND id != $2`,
      [email, id],
    );
    if (dup.rows.length > 0) {
      await reply.status(409).send({
        error: 'Пользователь с таким email уже существует',
        code: 'EMAIL_EXISTS',
      });
      return;
    }
  }

  // Build dynamic SET clause
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(name);
  }
  if (email !== undefined) {
    sets.push(`email = $${idx++}`);
    values.push(email);
  }
  if (role !== undefined) {
    sets.push(`role = $${idx++}`);
    values.push(role);
  }
  if (is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(is_active);
  }
  if (api_key_scope !== undefined) {
    sets.push(`api_key_scope = $${idx++}`);
    values.push(api_key_scope);
  }
  if (antidetect_browser !== undefined) {
    sets.push(`antidetect_browser = $${idx++}`);
    values.push(antidetect_browser);
  }
  if (api_key_scope === undefined && role !== undefined) {
    // Auto-sync scope with role when scope not explicitly provided
    sets.push(`api_key_scope = $${idx++}`);
    values.push(role === 'admin' ? 'full' : 'collect_only');
  }
  if (sets.length === 0) {
    await reply.status(400).send({
      error: 'Нет полей для обновления',
      code: 'NO_FIELDS',
    });
    return;
  }

  values.push(id);
  const result = await pool.query(
    `UPDATE users SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING id, name, email, role, api_key_scope, is_active, updated_at`,
    values,
  );

  // If deactivated — revoke all refresh tokens
  if (is_active === false) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
  }

  audit(pool, request, 'user.update', { entityType: 'user', entityId: id, details: { name, email, role, is_active } });
  await reply.status(200).send({ user: result.rows[0] });
}

// DELETE /admin/users/:id  (soft delete — sets is_active = false)
export async function deleteUserHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };

  // Prevent self-deactivation
  if (id === request.user!.id) {
    await reply.status(400).send({
      error: 'Нельзя деактивировать самого себя',
      code: 'SELF_DEACTIVATE',
    });
    return;
  }

  const result = await pool.query(
    `UPDATE users SET is_active = false
     WHERE id = $1 AND is_active = true
     RETURNING id`,
    [id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({
      error: 'Пользователь не найден или уже деактивирован',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  // Revoke all refresh tokens
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);

  audit(pool, request, 'user.delete', { entityType: 'user', entityId: id });
  await reply.status(200).send({ status: 'ok' });
}

// POST /admin/users/:id/reset-api-key
export async function resetApiKeyHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };

  const newApiKey = `cts_${crypto.randomBytes(32).toString('hex')}`;

  const result = await pool.query(
    `UPDATE users SET api_key = $1
     WHERE id = $2 AND is_active = true
     RETURNING id, name, api_key`,
    [newApiKey, id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({
      error: 'Пользователь не найден',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  const user = result.rows[0] as { id: string; name: string; api_key: string };

  await reply.status(200).send({
    id: user.id,
    name: user.name,
    api_key: user.api_key,
  });
}

// PATCH /admin/users/:id/password
export async function resetPasswordHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params as { id: string };
  const { password } = request.body as { password: string };

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `UPDATE users SET password_hash = $1
     WHERE id = $2 AND is_active = true
     RETURNING id`,
    [passwordHash, id],
  );

  if (result.rows.length === 0) {
    await reply.status(404).send({
      error: 'Пользователь не найден',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  // Revoke all refresh tokens — force re-login
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);

  await reply.status(200).send({ status: 'ok' });
}
