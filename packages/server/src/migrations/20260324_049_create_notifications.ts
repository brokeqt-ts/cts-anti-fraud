import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('notifications');
  if (hasTable) return;

  await knex.schema.createTable('notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('type').notNullable();
    // types: 'ban_detected', 'ban_resolved', 'risk_elevated', 'creative_decay', 'account_connected', 'system'
    table.text('title').notNullable();
    table.text('message');
    table.text('severity').notNullable().defaultTo('info');
    // severity: 'critical', 'warning', 'info', 'success'
    table.jsonb('metadata');
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Main query: unread notifications for a user, newest first
  await knex.raw(
    'CREATE INDEX idx_notifications_user_unread_created ON notifications (user_id, is_read, created_at DESC)',
  );

  // Cleanup old notifications
  await knex.raw(
    'CREATE INDEX idx_notifications_created_at ON notifications (created_at)',
  );

  // Auto-update updated_at
  await knex.raw(`
    CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notifications');
}
