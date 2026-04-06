import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { CollectRequest } from '@cts/shared';
import { collectHandler } from '../handlers/collect.handler.js';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

const collectBodySchema = {
  type: 'object',
  required: ['profile_id', 'extension_version', 'batch'],
  properties: {
    profile_id: { type: 'string', minLength: 1 },
    antidetect_browser: { type: 'string' },
    proxy_info: {
      type: 'object',
      properties: {
        ip: { type: 'string' },
        geo: { type: ['string', 'null'] },
        org: { type: ['string', 'null'] },
        asn: { type: ['string', 'null'] },
      },
    },
    profile_config: {
      type: 'object',
      properties: {
        proxy_provider: { type: 'string' },
        account_type: { type: 'string' },
        payment_service: { type: 'string' },
      },
    },
    extension_version: { type: 'string', minLength: 1 },
    batch: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'timestamp', 'data'],
        properties: {
          type: {
            type: 'string',
            enum: ['account', 'campaign', 'performance', 'billing', 'ad_review', 'status_change', 'billing_request', 'raw', 'raw_text'],
          },
          timestamp: { type: 'string' },
          data: { type: 'object' },
        },
      },
    },
  },
};

const collectResponseSchema = {
  200: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      processed: { type: 'number' },
    },
  },
};

export async function collectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: CollectRequest }>(
    '/collect',
    {
      schema: {
        body: collectBodySchema,
        response: collectResponseSchema,
      },
      preHandler: [fastify.authenticate],
    },
    collectHandler,
  );

  // Returns user's most recently used profile config (for auto-fill in new profiles)
  fastify.get(
    '/profile-defaults',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId || userId === 'legacy') {
        return reply.send({ proxy_provider: null, account_type: null, payment_service: null });
      }
      const pool = getPool(env.DATABASE_URL);
      const result = await pool.query(
        `SELECT
           a.account_type,
           (SELECT p.provider FROM proxies p
              JOIN account_consumables ac ON ac.proxy_id = p.id
             WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL AND p.provider IS NOT NULL
             ORDER BY ac.linked_at DESC LIMIT 1) AS proxy_provider,
           (SELECT pm.service_provider FROM payment_methods pm
              JOIN account_consumables ac ON ac.payment_method_id = pm.id
             WHERE ac.account_id = a.id AND ac.unlinked_at IS NULL AND pm.service_provider IS NOT NULL
             ORDER BY ac.linked_at DESC LIMIT 1) AS payment_service
         FROM accounts a
         WHERE a.user_id = $1
         ORDER BY a.updated_at DESC
         LIMIT 1`,
        [userId],
      );
      const row = result.rows[0] as Record<string, string | null> | undefined;
      return reply.send({
        proxy_provider: row?.proxy_provider ?? null,
        account_type: row?.account_type ?? null,
        payment_service: row?.payment_service ?? null,
      });
    },
  );
}
