import type { FastifyInstance } from 'fastify';
import { assessHandler } from '../handlers/assessment.handler.js';

export async function assessmentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/assess',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            domain: { type: 'string' },
            account_google_id: { type: 'string' },
            bin: { type: 'string' },
            vertical: {
              type: 'string',
              enum: ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other'],
            },
            geo: { type: 'string' },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              risk_score: { type: 'number' },
              risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              factors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    category: { type: 'string' },
                    score: { type: 'number' },
                    weight: { type: 'number' },
                    detail: { type: 'string' },
                  },
                },
              },
              recommendations: {
                type: 'array',
                items: { type: 'string' },
              },
              comparable_accounts: {
                type: 'object',
                properties: {
                  total: { type: 'number' },
                  banned: { type: 'number' },
                  ban_rate: { type: 'number' },
                  avg_lifetime_days: { type: 'number' },
                },
              },
              budget_recommendation: { type: ['number', 'null'] },
            },
          },
        },
      },
    },
    assessHandler,
  );
}
