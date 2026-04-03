import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../services/auth/jwt.service.js';
import { resolveApiKey } from '../services/auth/api-key.service.js';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';

/** Returns true if the request targets an endpoint allowed for collect_only scope. */
function isCollectOnlyAllowed(request: FastifyRequest): boolean {
  const url = request.url.split('?')[0];
  if (url === '/api/v1/health') return true;
  if (url.startsWith('/api/v1/auth/')) return true;
  if (url === '/api/v1/collect' && request.method === 'POST') return true;
  return false;
}

export const authPlugin = fp(async function auth(fastify: FastifyInstance): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Try JWT from Authorization: Bearer <token> OR ?token= query param (for SSE)
    const authHeader = request.headers['authorization'];
    const queryToken = (request.query as Record<string, string | undefined>)['token'];
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;
    if (bearerToken) {
      try {
        const payload = verifyAccessToken(bearerToken);
        request.user = { id: payload.sub, role: payload.role, name: payload.name };
        return; // JWT users have no scope restriction
      } catch {
        await reply.status(401).send({
          error: 'Invalid or expired token',
          code: 'TOKEN_INVALID',
        });
        return;
      }
    }

    // 2. Try API key from X-API-Key header
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      // 2a. Look up per-user key in DB
      const user = await resolveApiKey(pool, apiKey);
      if (user) {
        request.user = { id: user.id, role: user.role as 'admin' | 'buyer', name: user.name };
        request.apiKeyScope = user.api_key_scope;

        // Scope guard: collect_only keys can only access whitelisted endpoints
        if (user.api_key_scope === 'collect_only' && !isCollectOnlyAllowed(request)) {
          await reply.status(403).send({
            error: 'API key scope insufficient — collect_only keys can only access POST /collect',
            code: 'SCOPE_INSUFFICIENT',
          });
          return;
        }
        return;
      }
      // 2b. Fallback: legacy static API_KEY from env (backward compat)
      if (apiKey === env.API_KEY) {
        request.user = { id: 'legacy', role: 'admin', name: 'Legacy API Key' };
        request.apiKeyScope = 'full';
        fastify.log.warn(
          { ip: request.ip, url: request.url, method: request.method },
          '[SECURITY] Legacy API_KEY used — migrate to per-user keys',
        );
        return;
      }
      await reply.status(401).send({
        error: 'Invalid API key',
        code: 'API_KEY_INVALID',
      });
      return;
    }

    // 3. No auth provided
    await reply.status(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  });

  // Role guard helper
  fastify.decorate('requireRole', (role: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || request.user.role !== role) {
        await reply.status(403).send({
          error: 'Insufficient permissions',
          code: 'FORBIDDEN',
        });
        return;
      }
    };
  });

  // Scope guard helper (kept for optional per-route use)
  fastify.decorate('requireScope', (scope: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.apiKeyScope) return;
      if (scope === 'full' && request.apiKeyScope === 'collect_only') {
        await reply.status(403).send({
          error: 'API key scope insufficient',
          code: 'SCOPE_INSUFFICIENT',
        });
        return;
      }
    };
  });
});
