import type pg from 'pg';
import type { FastifyRequest } from 'fastify';

export interface AuditEntry {
  userId: string | null;
  userName: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

export async function logAudit(pool: pg.Pool, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.userId,
        entry.userName,
        entry.action,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.ipAddress ?? null,
      ],
    );
  } catch (err) {
    console.error('[audit] Failed to log:', err instanceof Error ? err.message : err);
  }
}

/** Helper: extract audit info from request and log */
export function audit(pool: pg.Pool, request: FastifyRequest, action: string, opts?: {
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}): void {
  const user = request.user;
  logAudit(pool, {
    userId: user?.id ?? null,
    userName: user?.name ?? 'system',
    action,
    entityType: opts?.entityType,
    entityId: opts?.entityId,
    details: opts?.details,
    ipAddress: request.ip,
  }).catch(() => {});
}
