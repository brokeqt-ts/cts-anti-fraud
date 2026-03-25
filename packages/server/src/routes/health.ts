import type { FastifyInstance } from 'fastify';
import { healthHandler } from '../handlers/health.handler.js';

const healthResponseSchema = {
  200: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      version: { type: 'string' },
      uptime: { type: 'number' },
      database: {
        type: 'object',
        properties: {
          connected: { type: 'boolean' },
          latency_ms: { type: ['number', 'null'] },
        },
      },
      last_data_received: { type: ['string', 'null'] },
      ai_models: {
        type: 'object',
        properties: {
          claude: { type: 'boolean' },
          openai: { type: 'boolean' },
          gemini: { type: 'boolean' },
        },
      },
    },
  },
} as const;

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        response: healthResponseSchema,
      },
    },
    healthHandler,
  );
}
