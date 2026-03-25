import type { Knex } from 'knex';

/**
 * Migration 018: Create notification_details table for structured notification data.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_details', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('account_google_id').notNullable();
    table.string('notification_id');
    table.string('title');
    table.text('description');
    table.string('category'); // CRITICAL, WARNING, INFO
    table.string('notification_type'); // ADWORDS_POLICY_ACCOUNT_SUSPENDED, etc.
    table.string('label'); // e.g. "7973813934:UNACCEPTABLE_BUSINESS_PRACTICES"
    table.string('priority');
    table.jsonb('raw_notification');
    table.uuid('raw_payload_id').references('id').inTable('raw_payloads').onDelete('SET NULL');
    table.timestamp('captured_at').notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_notif_details_dedup
      ON notification_details (notification_id, raw_payload_id)
      WHERE notification_id IS NOT NULL AND raw_payload_id IS NOT NULL
  `);

  await knex.raw(`CREATE INDEX idx_notif_details_account ON notification_details (account_google_id)`);
  await knex.raw(`CREATE INDEX idx_notif_details_category ON notification_details (category)`);

  await knex.raw(`
    CREATE TRIGGER update_notification_details_updated_at
    BEFORE UPDATE ON notification_details
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TRIGGER IF EXISTS update_notification_details_updated_at ON notification_details');
  await knex.schema.dropTableIfExists('notification_details');
}
