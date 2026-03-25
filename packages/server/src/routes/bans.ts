import type { FastifyInstance } from 'fastify';
import { createBanHandler, updateBanHandler, listBansHandler, getBanHandler } from '../handlers/bans.handler.js';

export async function bansRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/bans',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['account_google_id', 'ban_date', 'ban_target'],
          properties: {
            account_google_id: { type: 'string' },
            ban_date: { type: 'string' },
            ban_target: { type: 'string', enum: ['account', 'domain', 'campaign', 'ad'] },
            ban_reason_google: { type: 'string' },
            ban_reason_internal: { type: 'string' },
            offer_vertical: {
              type: 'string',
              enum: ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other'],
            },
            domain: { type: 'string' },
            campaign_type: {
              type: 'string',
              enum: ['pmax', 'search', 'display', 'video', 'shopping', 'other'],
            },
          },
        },
      },
    },
    createBanHandler,
  );

  fastify.get(
    '/bans',
    { preHandler: [fastify.authenticate] },
    listBansHandler,
  );

  fastify.get(
    '/bans/:id',
    { preHandler: [fastify.authenticate] },
    getBanHandler,
  );

  fastify.patch(
    '/bans/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            offer_vertical: {
              type: ['string', 'null'],
              enum: ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other', null],
            },
            domain: { type: ['string', 'null'] },
            campaign_type: {
              type: ['string', 'null'],
              enum: ['pmax', 'search', 'display', 'video', 'shopping', 'other', null],
            },
            ban_reason_internal: { type: ['string', 'null'] },
            ban_reason_google: { type: ['string', 'null'] },
          },
        },
      },
    },
    updateBanHandler,
  );
}
