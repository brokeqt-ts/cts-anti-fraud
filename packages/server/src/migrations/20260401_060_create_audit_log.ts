import type { Knex } from 'knex';

/**
 * Migration 060: Audit log for tracking user actions.
 *
 * Records who did what: ban creation, account changes, settings updates,
 * extension downloads, user management, etc.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`CREATE INDEX idx_audit_log_user ON audit_log (user_id)`);
  await knex.raw(`CREATE INDEX idx_audit_log_action ON audit_log (action)`);
  await knex.raw(`CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC)`);
  await knex.raw(`CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS audit_log CASCADE');
}
