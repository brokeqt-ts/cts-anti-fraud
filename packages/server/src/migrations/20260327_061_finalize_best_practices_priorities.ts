import type { Knex } from 'knex';

/**
 * Finalizes priorities on a 1–20 scale.
 * Top 10 by priority (≥20) are injected into the AI context (LIMIT 10 ORDER BY priority DESC).
 * Exactly 10 practices are set to priority 20.
 */
export async function up(knex: Knex): Promise<void> {
  const updates: Array<{ title: string; priority: number }> = [
    // ── Priority 20: always visible in AI context (top 10) ──
    { title: 'Числовые пороги риска для AI-анализа', priority: 20 },
    { title: 'Критические сигналы связей аккаунтов', priority: 20 },
    { title: 'Интерпретация скорости расхода для AI', priority: 20 },
    { title: 'Пороги оценки домена для AI-анализа', priority: 20 },
    { title: 'Нормы Quality Score и отклонений объявлений', priority: 20 },
    { title: 'Типичные паттерны бана по вертикалям', priority: 20 },
    { title: 'Безопасные лимиты расхода по возрасту аккаунта', priority: 20 },
    { title: 'Оценка платёжного метода (BIN)', priority: 20 },
    { title: 'Интерпретация трендов и динамики аккаунта', priority: 20 },
    { title: 'Формат итогового анализа аккаунта', priority: 20 },
    // ── Priority 18: second tier ──
    { title: 'Прогрев аккаунта', priority: 18 },
    { title: 'Чек-лист перед запуском', priority: 18 },
    { title: 'Уточняющие вопросы при недостатке данных', priority: 18 },
    // ── Priority 16 ──
    { title: 'Выбор домена', priority: 16 },
    // ── Priority 14: creatives + budget ──
    { title: 'Управление бюджетом', priority: 14 },
    { title: 'Креативы для Nutra', priority: 14 },
    { title: 'Креативы для Gambling', priority: 14 },
    { title: 'Креативы для Crypto', priority: 14 },
    { title: 'Креативы для Dating', priority: 14 },
    { title: 'Креативы для Finance', priority: 14 },
    // ── Priority 12 ──
    { title: 'Настройка Search кампании', priority: 12 },
    { title: 'Настройка PMax кампании', priority: 12 },
    { title: 'Креативы для Sweepstakes', priority: 12 },
    // ── Priority 10 ──
    { title: 'Подача апелляции', priority: 10 },
  ];

  for (const { title, priority } of updates) {
    await knex('best_practices').where({ title }).update({ priority });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Revert to previous state (migration 060 values)
  const prev: Array<{ title: string; priority: number }> = [
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
    { title: 'Числовые пороги риска для AI-анализа', priority: 18 },
    { title: 'Чек-лист перед запуском', priority: 18 },
    { title: 'Выбор домена', priority: 16 },
    { title: 'Управление бюджетом', priority: 14 },
    { title: 'Креативы для Nutra', priority: 14 },
    { title: 'Креативы для Gambling', priority: 14 },
    { title: 'Креативы для Crypto', priority: 14 },
    { title: 'Креативы для Dating', priority: 14 },
    { title: 'Креативы для Finance', priority: 14 },
    { title: 'Настройка Search кампании', priority: 12 },
    { title: 'Настройка PMax кампании', priority: 12 },
    { title: 'Креативы для Sweepstakes', priority: 12 },
    { title: 'Подача апелляции', priority: 10 },
  ];
  for (const { title, priority } of prev) {
    await knex('best_practices').where({ title }).update({ priority });
  }
}
