import type { FastifyInstance } from 'fastify';
import type { CollectRequest } from '@cts/shared';
import { collectHandler } from '../handlers/collect.handler.js';

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
}
