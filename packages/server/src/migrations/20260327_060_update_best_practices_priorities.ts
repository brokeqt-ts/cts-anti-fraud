import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const updates: Array<{ title: string; priority: number }> = [
    // AI-focused practices — top priority
    { title: 'Критические сигналы связей аккаунтов', priority: 20 },
    { title: 'Интерпретация скорости расхода для AI', priority: 20 },
    { title: 'Пороги оценки домена для AI-анализа', priority: 20 },
    { title: 'Нормы Quality Score и отклонений объявлений', priority: 20 },
    { title: 'Типичные паттерны бана по вертикалям', priority: 20 },
    { title: 'Безопасные лимиты расхода по возрасту аккаунта', priority: 20 },
    { title: 'Оценка платёжного метода (BIN)', priority: 20 },
    { title: 'Прогрев аккаунта', priority: 20 },
    { title: 'Уточняющие вопросы при недостатке данных', priority: 20 },
    { title: 'Интерпретация трендов и динамики аккаунта', priority: 20 },
    { title: 'Формат итогового анализа аккаунта', priority: 20 },
    // Second tier
    { title: 'Числовые пороги риска для AI-анализа', priority: 18 },
    { title: 'Чек-лист перед запуском', priority: 18 },
    // Third tier
    { title: 'Выбор домена', priority: 16 },
    // Creatives
    { title: 'Креативы для Nutra', priority: 14 },
    { title: 'Креативы для Gambling', priority: 14 },
    { title: 'Креативы для Crypto', priority: 14 },
    { title: 'Креативы для Dating', priority: 14 },
    { title: 'Креативы для Finance', priority: 14 },
    // Campaign setup
    { title: 'Управление бюджетом', priority: 12 },
    { title: 'Настройка Search кампании', priority: 12 },
    { title: 'Креативы для Sweepstakes', priority: 12 },
    // Lower priority
    { title: 'Подача апелляции', priority: 10 },
    { title: 'Настройка PMax кампании', priority: 10 },
  ];

  for (const { title, priority } of updates) {
    await knex('best_practices').where({ title }).update({ priority });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Revert all to 10 (previous capped value)
  await knex('best_practices').update({ priority: 10 });
}
