import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('notification_settings');
  if (hasTable) return;

  await knex.schema.createTable('notification_settings', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('key').notNullable().unique();
    table.boolean('enabled').notNullable().defaultTo(true);
    table.text('label').notNullable();
    table.text('description');
    table.text('severity').notNullable().defaultTo('info');
    table.boolean('notify_owner').notNullable().defaultTo(true);
    table.boolean('notify_admins').notNullable().defaultTo(true);
    table.integer('cooldown_minutes').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Auto-update updated_at
  await knex.raw(`
    CREATE TRIGGER update_notification_settings_updated_at
    BEFORE UPDATE ON notification_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  // Seed data — all disabled by default
  await knex('notification_settings').insert([
    {
      key: 'auto_ban_detected',
      enabled: false,
      label: 'Аккаунт забанен',
      description: 'Уведомлять при обнаружении бана аккаунта',
      severity: 'critical',
      notify_owner: true,
      notify_admins: true,
      cooldown_minutes: 0,
    },
    {
      key: 'auto_ban_resolved',
      enabled: false,
      label: 'Бан снят',
      description: 'Уведомлять когда бан аккаунта снят',
      severity: 'success',
      notify_owner: true,
      notify_admins: true,
      cooldown_minutes: 0,
    },
    {
      key: 'auto_risk_elevated',
      enabled: false,
      label: 'Риск повышен',
      description: 'Уведомлять когда риск бана аккаунта повышается до high/critical',
      severity: 'warning',
      notify_owner: true,
      notify_admins: true,
      cooldown_minutes: 60,
    },
    {
      key: 'auto_account_connected',
      enabled: false,
      label: 'Новый аккаунт подключён',
      description: 'Уведомлять когда новый аккаунт Google Ads начинает отправлять данные',
      severity: 'success',
      notify_owner: true,
      notify_admins: false,
      cooldown_minutes: 0,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_settings');
}
