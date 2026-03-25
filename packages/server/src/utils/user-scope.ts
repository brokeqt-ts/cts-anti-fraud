import type { FastifyRequest } from 'fastify';

/**
 * Returns userId for data-scoped filtering.
 * Admin → undefined (sees all data).
 * Buyer → their user id (sees only own data).
 */
export function getUserIdFilter(request: FastifyRequest): string | undefined {
  return request.user?.role === 'admin' ? undefined : request.user?.id;
}
