import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { safeErrorDetails } from '../utils/error-response.js';
import { assess, type AssessmentRequest } from '../services/assessment.service.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { getUserIdFilter } from '../utils/user-scope.js';

export async function assessHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const body = request.body as AssessmentRequest;

  // At least one input is required
  if (!body.domain && !body.account_google_id && !body.bin && !body.vertical && !body.geo) {
    await reply.status(400).send({
      error: 'Необходимо указать хотя бы одно поле: domain, account_google_id, bin, vertical или geo',
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  // Verify buyer owns the account (if account_google_id provided)
  if (body.account_google_id) {
    const userId = getUserIdFilter(request);
    if (userId) {
      const owned = await accountsRepo.getAccountIdByGoogleId(pool, body.account_google_id, userId);
      if (!owned) {
        await reply.status(404).send({ error: 'Account not found', code: 'NOT_FOUND' });
        return;
      }
    }
  }

  try {
    const result = await assess(pool, {
      domain: body.domain,
      account_google_id: body.account_google_id,
      bin: body.bin,
      vertical: body.vertical,
      geo: body.geo,
    });

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'assessHandler' }, 'Failed to run assessment');
    await reply.status(500).send({
      error: 'Ошибка при оценке рисков',
      code: 'INTERNAL_ERROR',
      details: safeErrorDetails(err),
    });
  }
}
