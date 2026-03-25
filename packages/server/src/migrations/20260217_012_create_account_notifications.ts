import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account_notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.jsonb('notifications').notNullable();
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_account_notifications_dedup
      ON account_notifications (raw_payload_id)
      WHERE raw_payload_id IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX idx_account_notifications_account ON account_notifications (account_google_id);
    CREATE INDEX idx_account_notifications_captured ON account_notifications (captured_at);
  `);

  await knex.raw(`
    CREATE TRIGGER update_account_notifications_updated_at
    BEFORE UPDATE ON account_notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_account_notifications_updated_at ON account_notifications');
  await knex.schema.dropTableIfExists('account_notifications');
}
