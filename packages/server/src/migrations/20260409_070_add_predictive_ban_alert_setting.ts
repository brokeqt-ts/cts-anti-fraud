import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    INSERT INTO notification_settings (key, enabled, label, description, severity, notify_owner, notify_admins, cooldown_minutes, telegram_enabled)
    VALUES (
      'auto_predictive_ban_alert',
      true,
      'Предупреждение о возможном бане',
      'ML модель предсказывает высокий риск бана аккаунта. Настройте порог вероятности и интервал проверки.',
      'warning',
      true,
      true,
      360,
      false
    )
    ON CONFLICT (key) DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DELETE FROM notification_settings WHERE key = 'auto_predictive_ban_alert'`);
}
