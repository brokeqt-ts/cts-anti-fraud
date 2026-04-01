import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import * as tagsRepo from '../repositories/tags.repository.js';
import { audit } from '../services/audit.service.js';

export async function listTagsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const tags = await tagsRepo.listTags(pool);
  await reply.send({ tags });
}

export async function createTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as Record<string, unknown>;
  const name = body['name'] as string | undefined;
  const color = (body['color'] as string) ?? '#6366f1';
  if (!name || name.trim().length < 1) {
    await reply.status(400).send({ error: 'Tag name is required', code: 'VALIDATION_ERROR' });
    return;
  }
  const pool = getPool(env.DATABASE_URL);
  try {
    const tag = await tagsRepo.createTag(pool, name, color);
    audit(pool, request, 'tag.create', { entityType: 'tag', entityId: tag.id, details: { name, color } });
    await reply.status(201).send({ tag });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      await reply.status(409).send({ error: 'Tag already exists', code: 'DUPLICATE' });
      return;
    }
    throw err;
  }
}

export async function updateTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as Record<string, string>;
  const body = request.body as Record<string, unknown>;
  const name = body['name'] as string | undefined;
  const color = (body['color'] as string) ?? '#6366f1';
  if (!name || name.trim().length < 1) {
    await reply.status(400).send({ error: 'Tag name is required', code: 'VALIDATION_ERROR' });
    return;
  }
  const pool = getPool(env.DATABASE_URL);
  const tag = await tagsRepo.updateTag(pool, params['id']!, name, color);
  if (!tag) {
    await reply.status(404).send({ error: 'Tag not found', code: 'NOT_FOUND' });
    return;
  }
  await reply.send({ tag });
}

export async function deleteTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as Record<string, string>;
  const pool = getPool(env.DATABASE_URL);
  const deleted = await tagsRepo.deleteTag(pool, params['id']!);
  if (!deleted) {
    await reply.status(404).send({ error: 'Tag not found', code: 'NOT_FOUND' });
    return;
  }
  audit(pool, request, 'tag.delete', { entityType: 'tag', entityId: params['id']! });
  await reply.status(204).send();
}

export async function assignTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as Record<string, string>;
  const pool = getPool(env.DATABASE_URL);
  const accRes = await pool.query(
    `SELECT id FROM accounts WHERE google_account_id = $1`,
    [params['google_id']],
  );
  if (accRes.rows.length === 0) {
    await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  const accountId = (accRes.rows[0] as { id: string }).id;
  await tagsRepo.assignTag(pool, accountId, params['tag_id']!);
  await reply.status(204).send();
}

export async function unassignTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as Record<string, string>;
  const pool = getPool(env.DATABASE_URL);
  const accRes = await pool.query(
    `SELECT id FROM accounts WHERE google_account_id = $1`,
    [params['google_id']],
  );
  if (accRes.rows.length === 0) {
    await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
    return;
  }
  const accountId = (accRes.rows[0] as { id: string }).id;
  await tagsRepo.unassignTag(pool, accountId, params['tag_id']!);
  await reply.status(204).send();
}

export async function bulkAssignTagHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body as Record<string, unknown>;
  const google_account_ids = body['google_account_ids'] as string[] | undefined;
  const tag_id = body['tag_id'] as string | undefined;
  if (!Array.isArray(google_account_ids) || !tag_id) {
    await reply.status(400).send({ error: 'google_account_ids and tag_id required', code: 'VALIDATION_ERROR' });
    return;
  }
  const pool = getPool(env.DATABASE_URL);
  const assigned = await tagsRepo.bulkAssignTag(pool, google_account_ids, tag_id);
  await reply.send({ assigned });
}
