import type { FastifyInstance } from 'fastify';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateAntidetectBrowserHandler,
} from '../handlers/auth.handler.js';

const loginBodySchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 1 },
  },
} as const;

const refreshBodySchema = {
  type: 'object',
  required: ['refresh_token'],
  properties: {
    refresh_token: { type: 'string', minLength: 1 },
  },
} as const;

const logoutBodySchema = {
  type: 'object',
  properties: {
    refresh_token: { type: 'string' },
  },
} as const;

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Public — no auth
  fastify.post(
    '/auth/login',
    {
      schema: { body: loginBodySchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    loginHandler,
  );

  // Public — no auth
  fastify.post(
    '/auth/refresh',
    {
      schema: { body: refreshBodySchema },
    },
    refreshHandler,
  );

  // Authenticated
  fastify.post(
    '/auth/logout',
    {
      schema: { body: logoutBodySchema },
      preHandler: [fastify.authenticate],
    },
    logoutHandler,
  );

  // Authenticated
  fastify.get(
    '/auth/me',
    {
      preHandler: [fastify.authenticate],
    },
    meHandler,
  );

  // Authenticated — update antidetect browser preference
  fastify.patch(
    '/auth/antidetect-browser',
    {
      schema: {
        body: {
          type: 'object',
          required: ['antidetect_browser'],
          properties: {
            antidetect_browser: { type: 'string' },
          },
        },
      },
      preHandler: [fastify.authenticate],
    },
    updateAntidetectBrowserHandler,
  );

}
