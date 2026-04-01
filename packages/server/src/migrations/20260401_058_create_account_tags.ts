import type { Knex } from 'knex';

/**
 * Migration 058: Account tags/groups for organizing accounts.
 *
 * - tags: reusable labels (e.g. #gambling-eu, #nutra-tier1, #buyer-alex)
 * - account_tags: many-to-many junction between accounts and tags
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6366f1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await knex.raw(`
    CREATE TABLE account_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (account_id, tag_id)
    )
  `);

  await knex.raw(`CREATE INDEX idx_account_tags_account ON account_tags (account_id)`);
  await knex.raw(`CREATE INDEX idx_account_tags_tag ON account_tags (tag_id)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS account_tags CASCADE');
  await knex.raw('DROP TABLE IF EXISTS tags CASCADE');
}
