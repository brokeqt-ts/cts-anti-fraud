import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('users', 'telegram_chat_id');
  if (has) return;

  await knex.schema.alterTable('users', (table) => {
    table.text('telegram_chat_id').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('telegram_chat_id');
  });
}
