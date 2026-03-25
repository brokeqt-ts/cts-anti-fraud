import type { FastifyInstance } from 'fastify';
import {
  rawAnalysisHandler,
  rpcPayloadsHandler,
  backfillParsersHandler,
  resetParsedDataHandler,
  mergeAccountHandler,
  parsedDataHandler,
  detectBansHandler,
  gapDiagnosticsHandler,
  enrichDomainsHandler,
  rawPayloadsListHandler,
  rawPayloadsDetailHandler,
  backfillAccountsHandler,
} from '../handlers/admin.handler.js';
import {
  listUsersHandler,
  createUserHandler,
  getUserHandler,
  updateUserHandler,
  deleteUserHandler,
  resetApiKeyHandler,
  resetPasswordHandler,
} from '../handlers/admin-users.handler.js';
import {
  listSettingsHandler,
  updateSettingHandler,
  testTelegramHandler,
  sendNotificationHandler,
  notificationHistoryHandler,
} from '../handlers/admin-notifications.handler.js';

// --- JSON Schemas for user management ---

const createUserBodySchema = {
  type: 'object',
  required: ['name', 'email', 'password'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8, maxLength: 128 },
    role: { type: 'string', enum: ['admin', 'buyer'] },
  },
} as const;

const updateUserBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['admin', 'buyer'] },
    is_active: { type: 'boolean' },
    api_key_scope: { type: 'string', enum: ['full', 'collect_only'] },
  },
  minProperties: 1,
} as const;

const resetPasswordBodySchema = {
  type: 'object',
  required: ['password'],
  properties: {
    password: { type: 'string', minLength: 8, maxLength: 128 },
  },
} as const;

const userIdParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // --- User management (admin only) ---

  fastify.get(
    '/admin/users',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    listUsersHandler,
  );

  fastify.post(
    '/admin/users',
    {
      schema: { body: createUserBodySchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    createUserHandler,
  );

  fastify.get(
    '/admin/users/:id',
    {
      schema: { params: userIdParamsSchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    getUserHandler,
  );

  fastify.patch(
    '/admin/users/:id',
    {
      schema: { params: userIdParamsSchema, body: updateUserBodySchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    updateUserHandler,
  );

  fastify.delete(
    '/admin/users/:id',
    {
      schema: { params: userIdParamsSchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    deleteUserHandler,
  );

  fastify.post(
    '/admin/users/:id/reset-api-key',
    {
      schema: { params: userIdParamsSchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    resetApiKeyHandler,
  );

  fastify.patch(
    '/admin/users/:id/password',
    {
      schema: { params: userIdParamsSchema, body: resetPasswordBodySchema },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    resetPasswordHandler,
  );

  // --- Existing admin routes (admin only) ---

  fastify.get(
    '/admin/raw-analysis',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    rawAnalysisHandler,
  );

  fastify.get(
    '/admin/rpc-payloads',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    rpcPayloadsHandler,
  );

  fastify.post(
    '/admin/backfill-parsers',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    backfillParsersHandler,
  );

  fastify.post(
    '/admin/reset-parsed-data',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    resetParsedDataHandler,
  );

  fastify.post(
    '/admin/merge-account',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    mergeAccountHandler,
  );

  fastify.get(
    '/admin/parsed-data',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    parsedDataHandler,
  );

  fastify.post(
    '/admin/detect-bans',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    detectBansHandler,
  );

  fastify.get(
    '/admin/gap-diagnostics',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    gapDiagnosticsHandler,
  );

  fastify.post(
    '/admin/enrich-domains',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    enrichDomainsHandler,
  );

  fastify.post(
    '/admin/backfill-accounts',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    backfillAccountsHandler,
  );

  fastify.get(
    '/admin/raw-payloads',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    rawPayloadsListHandler,
  );

  fastify.get(
    '/admin/raw-payloads/:id',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    rawPayloadsDetailHandler,
  );

  // --- Notification settings (admin only) ---

  fastify.get(
    '/admin/notification-settings',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    listSettingsHandler,
  );

  fastify.patch(
    '/admin/notification-settings/:key',
    {
      schema: {
        params: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            severity: { type: 'string', enum: ['info', 'warning', 'critical', 'success'] },
            notify_owner: { type: 'boolean' },
            notify_admins: { type: 'boolean' },
            cooldown_minutes: { type: 'integer', minimum: 0 },
            telegram_enabled: { type: 'boolean' },
            telegram_chat_id: { type: ['string', 'null'] },
          },
          minProperties: 1,
        },
      },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    updateSettingHandler,
  );

  // --- Telegram test (admin only) ---

  fastify.post(
    '/admin/notification-settings/:key/test-telegram',
    {
      schema: {
        params: {
          type: 'object',
          required: ['key'],
          properties: { key: { type: 'string' } },
        },
      },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    testTelegramHandler,
  );

  // --- Manual notification send (admin only) ---

  fastify.post(
    '/admin/notifications/send',
    {
      schema: {
        body: {
          type: 'object',
          required: ['target', 'title', 'message', 'severity'],
          properties: {
            target: { type: 'string', enum: ['all', 'buyers', 'admins', 'user_id'] },
            user_id: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            message: { type: 'string', minLength: 1, maxLength: 5000 },
            severity: { type: 'string', enum: ['info', 'warning', 'critical', 'success'] },
          },
        },
      },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    sendNotificationHandler,
  );

  // --- Notification history (admin only) ---

  fastify.get(
    '/admin/notifications/history',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'string' },
          },
        },
      },
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
    },
    notificationHistoryHandler,
  );
}
