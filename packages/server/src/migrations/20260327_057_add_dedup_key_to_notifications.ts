import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notifications', (table) => {
    table.text('dedup_key'); // e.g. "ban_detected:123-456-7890" or "creative_decay:camp_id"
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_notifications_dedup ON notifications(user_id, dedup_key)
    WHERE dedup_key IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_notifications_dedup');
  await knex.schema.alterTable('notifications', (table) => {
    table.dropColumn('dedup_key');
  });
}
