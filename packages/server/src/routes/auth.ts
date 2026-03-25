import type { FastifyInstance } from 'fastify';
import {
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  changePasswordHandler,
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

const changePasswordBodySchema = {
  type: 'object',
  required: ['current_password', 'new_password'],
  properties: {
    current_password: { type: 'string', minLength: 1 },
    new_password: { type: 'string', minLength: 8, maxLength: 128 },
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

  // Authenticated
  fastify.patch(
    '/auth/me/password',
    {
      schema: { body: changePasswordBodySchema },
      preHandler: [fastify.authenticate],
    },
    changePasswordHandler,
  );
}
