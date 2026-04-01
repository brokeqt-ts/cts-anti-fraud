import type { FastifyInstance } from 'fastify';
import {
  listTagsHandler,
  createTagHandler,
  updateTagHandler,
  deleteTagHandler,
  assignTagHandler,
  unassignTagHandler,
  bulkAssignTagHandler,
} from '../handlers/tags.handler.js';

export async function tagsRoutes(fastify: FastifyInstance): Promise<void> {
  // Tag CRUD
  fastify.get('/tags', { preHandler: [fastify.authenticate] }, listTagsHandler);
  fastify.post('/tags', { preHandler: [fastify.authenticate] }, createTagHandler);
  fastify.patch('/tags/:id', { preHandler: [fastify.authenticate] }, updateTagHandler);
  fastify.delete('/tags/:id', { preHandler: [fastify.authenticate] }, deleteTagHandler);

  // Assign/unassign tags to accounts
  fastify.post('/accounts/:google_id/tags/:tag_id', { preHandler: [fastify.authenticate] }, assignTagHandler);
  fastify.delete('/accounts/:google_id/tags/:tag_id', { preHandler: [fastify.authenticate] }, unassignTagHandler);

  // Bulk assign
  fastify.post('/tags/bulk-assign', { preHandler: [fastify.authenticate] }, bulkAssignTagHandler);
}
