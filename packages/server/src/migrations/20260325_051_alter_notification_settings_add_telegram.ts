import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTelegramEnabled = await knex.schema.hasColumn('notification_settings', 'telegram_enabled');
  if (hasTelegramEnabled) return;

  await knex.schema.alterTable('notification_settings', (table) => {
    table.boolean('telegram_enabled').notNullable().defaultTo(false);
    table.text('telegram_chat_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notification_settings', (table) => {
    table.dropColumn('telegram_enabled');
    table.dropColumn('telegram_chat_id');
  });
}
