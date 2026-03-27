import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('best_practices', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('category').notNullable();
    // 'campaign_setup', 'domain_selection', 'budget_strategy',
    // 'creative_guidelines', 'ban_prevention', 'appeal_strategy'
    table.text('campaign_type'); // NULL = general, 'pmax', 'search', etc.
    table.text('offer_vertical'); // NULL = general, 'gambling', 'nutra', etc.
    table.text('title').notNullable();
    table.text('content').notNullable(); // Markdown
    table.integer('priority').defaultTo(0);
    table.boolean('is_active').defaultTo(true);
    table.uuid('created_by').references('id').inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_best_practices_category ON best_practices(category);
    CREATE INDEX idx_best_practices_type ON best_practices(campaign_type);
    CREATE INDEX idx_best_practices_vertical ON best_practices(offer_vertical);
    CREATE INDEX idx_best_practices_active ON best_practices(is_active) WHERE is_active = true;
  `);

  await knex.raw(`
    CREATE TRIGGER update_best_practices_updated_at
    BEFORE UPDATE ON best_practices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
  `);

  // Seed initial best practices
  const adminResult = await knex('users').where('role', 'admin').first('id');
  const adminId = adminResult?.id ?? null;

  await knex('best_practices').insert([
    { category: 'ban_prevention', title: 'Прогрев аккаунта', content: '## Правила прогрева\n\n1. Первые 3 дня — минимальный бюджет ($5-10/день)\n2. Не менять настройки кампании первые 48ч\n3. Использовать белый лендинг на период прогрева\n4. Не запускать больше 1 кампании одновременно\n5. Постепенно увеличивать бюджет: +20-30% в день', priority: 10, created_by: adminId },
    { category: 'ban_prevention', title: 'Чек-лист перед запуском', content: '## Перед запуском кампании проверьте\n\n- [ ] Privacy Policy на лендинге\n- [ ] Terms of Service\n- [ ] Контактная информация\n- [ ] Дисклеймер (для nutra/finance)\n- [ ] SSL сертификат (не self-signed)\n- [ ] Нет скрытого текста на странице\n- [ ] Нет агрессивных попапов\n- [ ] Домен старше 14 дней\n- [ ] Домен не в спам-листах', priority: 9, created_by: adminId },
    { category: 'domain_selection', title: 'Выбор домена', content: '## Критерии хорошего домена\n\n- Возраст > 30 дней (лучше > 6 мес)\n- TLD: .com, .org, .net (избегать .xyz, .top, .click)\n- Без WHOIS-privacy (выглядит подозрительно)\n- Платный SSL сертификат\n- Нет истории банов на домене\n- Уникальный IP (не shared hosting с забаненными сайтами)', priority: 8, created_by: adminId },
    { category: 'creative_guidelines', title: 'Креативы для Nutra', content: '## Правила для вертикали Nutra\n\n### Запрещено:\n- "До и после" без дисклеймера\n- "FDA approved" (если нет реального одобрения)\n- "Clinically proven" без ссылки на исследование\n- Гарантии результата\n\n### Рекомендуется:\n- Дисклеймер "Results may vary"\n- Ссылка на Terms & Conditions\n- Реалистичные claims\n- Отзывы с оговоркой', offer_vertical: 'nutra', priority: 7, created_by: adminId },
    { category: 'creative_guidelines', title: 'Креативы для Gambling', content: '## Правила для вертикали Gambling\n\n### Запрещено:\n- Слова: casino, slots, jackpot (в объявлениях)\n- Обещания выигрыша\n- Бонусы за депозит (в некоторых GEO)\n\n### Рекомендуется:\n- Мягкие формулировки: "entertainment", "games"\n- Таргетинг на разрешённые GEO\n- Возрастное ограничение 18+\n- Disclaimers: "Gamble responsibly"', offer_vertical: 'gambling', priority: 7, created_by: adminId },
    { category: 'budget_strategy', title: 'Управление бюджетом', content: '## Стратегия бюджета\n\n1. **Старт:** $10-20/день на первую неделю\n2. **Рост:** +30% каждые 2-3 дня при стабильном CTR\n3. **Потолок:** Не более $200/день на молодой аккаунт (< 30 дней)\n4. **Спад CTR:** Снизить бюджет на 20%, обновить креативы\n5. **Красная зона:** Если spend velocity > 3x среднего — снизить немедленно', priority: 6, created_by: adminId },
    { category: 'appeal_strategy', title: 'Подача апелляции', content: '## Как подать апелляцию\n\n1. Подождите 24-48ч после бана\n2. Проверьте что лендинг соответствует политикам\n3. Уберите все нарушения\n4. В апелляции:\n   - Признайте ошибку (даже если не согласны)\n   - Опишите какие изменения сделали\n   - Покажите что сайт соответствует политикам\n   - Будьте вежливы и профессиональны\n5. Ждите 3-5 рабочих дней\n6. Не подавайте повторно раньше чем через 7 дней', priority: 5, created_by: adminId },
    { category: 'campaign_setup', title: 'Настройка PMax кампании', content: '## Performance Max — Best Practices\n\n1. Минимум 5 headlines, 5 descriptions\n2. Добавьте минимум 3 изображения разных размеров\n3. Используйте Audience Signals\n4. Установите brand exclusions\n5. Начните с Target CPA (не Maximize Conversions)\n6. URL expansion = OFF для серых вертикалей\n7. Final URL expansion = OFF', campaign_type: 'pmax', priority: 5, created_by: adminId },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('best_practices');
}
