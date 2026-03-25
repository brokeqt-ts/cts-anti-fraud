import type { CollectService } from './services/collect.service.js';

interface RequestUser {
  id: string;
  role: 'admin' | 'buyer';
  name: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    requireRole: (role: string) => (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    requireScope: (scope: string) => (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
    collectService: CollectService;
  }

  interface FastifyRequest {
    user?: RequestUser;
    apiKeyScope?: string;
  }
}
