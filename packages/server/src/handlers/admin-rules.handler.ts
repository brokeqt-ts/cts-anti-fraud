import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { safeErrorDetails } from '../utils/error-response.js';
import { invalidateRulesCache } from '../services/rules-engine-v2.js';
import * as rulesRepo from '../repositories/rules.repository.js';

export async function listRulesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const rules = await rulesRepo.listRules(pool);
    await reply.send({ rules });
  } catch (err) {
    await reply.status(500).send({ error: 'Ошибка загрузки правил', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}

export async function createRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const body = request.body as rulesRepo.CreateRuleInput;
  const user = (request as unknown as { user?: { id?: string } }).user;

  try {
    const rule = await rulesRepo.createRule(pool, { ...body, created_by: user?.id ?? null });
    invalidateRulesCache();
    await reply.status(201).send({ rule });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      await reply.status(409).send({ error: 'Правило с таким именем уже существует', code: 'CONFLICT' });
      return;
    }
    await reply.status(500).send({ error: 'Ошибка создания правила', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}

export async function updateRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const body = request.body as rulesRepo.UpdateRuleInput;

  try {
    const rule = await rulesRepo.updateRule(pool, id, body);
    if (!rule) {
      await reply.status(404).send({ error: 'Правило не найдено', code: 'NOT_FOUND' });
      return;
    }
    invalidateRulesCache();
    await reply.send({ rule });
  } catch (err) {
    await reply.status(500).send({ error: 'Ошибка обновления правила', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}

export async function deleteRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };

  try {
    const deleted = await rulesRepo.deleteRule(pool, id);
    if (!deleted) {
      await reply.status(404).send({ error: 'Правило не найдено', code: 'NOT_FOUND' });
      return;
    }
    invalidateRulesCache();
    await reply.status(204).send();
  } catch (err) {
    await reply.status(500).send({ error: 'Ошибка удаления правила', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}

export async function toggleRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { id } = request.params as { id: string };
  const { is_active } = request.body as { is_active: boolean };

  try {
    const rule = await rulesRepo.toggleRule(pool, id, is_active);
    if (!rule) {
      await reply.status(404).send({ error: 'Правило не найдено', code: 'NOT_FOUND' });
      return;
    }
    invalidateRulesCache();
    await reply.send({ rule });
  } catch (err) {
    await reply.status(500).send({ error: 'Ошибка обновления правила', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}

export async function reorderRulesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { updates } = request.body as { updates: { id: string; priority: number }[] };

  try {
    await rulesRepo.updatePriorities(pool, updates);
    invalidateRulesCache();
    await reply.send({ ok: true });
  } catch (err) {
    await reply.status(500).send({ error: 'Ошибка обновления приоритетов', code: 'INTERNAL_ERROR', details: safeErrorDetails(err) });
  }
}
