import { env } from '../config/env.js';

/**
 * Returns error details safe for inclusion in API responses.
 * In production — returns null to avoid leaking DB schema, table names,
 * constraint names, etc. from PostgreSQL error messages.
 * In development — returns full error message for easier debugging.
 */
export function safeErrorDetails(err: unknown): string | null {
  if (env.NODE_ENV === 'production') return null;
  return err instanceof Error ? err.message : String(err);
}
