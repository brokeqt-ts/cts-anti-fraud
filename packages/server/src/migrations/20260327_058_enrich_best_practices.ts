import type { Knex } from 'knex';

// Numeric risk thresholds and signals for AI prompt injection.
// Priority 11–18 ensures these always appear in the LIMIT 5 / LIMIT 10 contexts.
// Content is written for direct AI consumption (Russian, markdown).

export async function up(knex: Knex): Promise<void> {
  // ── 1. Enrich existing seeded practices ────────────────────────────────────

  await knex('best_practices')
    .where('title', 'Прогрев аккаунта')
    .update({
      content: `## Прогрев аккаунта — правила и пороги

### Временны́е фазы
| Возраст | Макс. бюджет/день | Кампаний | Лендинг |
|---------|-------------------|----------|---------|
| 0–3 дня | $5–10 | 1 | Белый |
| 4–7 дней | $10–20 | 1 | Белый/серый |
| 8–14 дней | $20–50 | 1–2 | Рабочий |
| 15–30 дней | $50–100 | 2–3 | Рабочий |
| 31–90 дней | $100–300 | Без ограничений | Любой |

### Запрещено в первые 48 часов
- Менять настройки кампании (тип ставок, таргетинг, бюджет)
- Добавлять/удалять ключевые слова
- Менять лендинг

### Признаки успешного прогрева
- CTR > 1% (Search), > 0.1% (Display)
- QS ≥ 5 на ключевых словах
- Нет disapproved объявлений
- Нет предупреждений от Google (policy_violation_count = 0)

### Красные флаги во время прогрева
- spend_velocity_ratio > 2.0 в первые 7 дней → уменьшить бюджет
- policy_violation_count > 0 в первые 3 дня → немедленно остановить, исправить
- ad_disapproval_count ≥ 2 → пересмотреть все креативы`,
    });

  await knex('best_practices')
    .where('title', 'Чек-лист перед запуском')
    .update({
      content: `## Чек-лист перед запуском кампании

### Лендинг (проверяется по domain_*)
- [ ] Privacy Policy — обязательно (domain_has_privacy_page = true)
- [ ] Terms of Service — обязательно
- [ ] Контактная информация (email или форма)
- [ ] Дисклеймер для nutra/finance/dating
- [ ] SSL-сертификат платный (domain_has_ssl = true; self-signed = HIGH RISK)
- [ ] Нет скрытого текста (white-on-white, font-size:0)
- [ ] Нет агрессивных попапов при входе
- [ ] Нет countdown-таймеров с фальшивыми дедлайнами
- [ ] Нет fake-reviews с явно фотостоковыми фото

### Домен (проверяется по domain_age_days)
- [ ] Возраст > 14 дней (< 14 = CRITICAL RISK)
- [ ] Возраст > 30 дней для серых вертикалей
- [ ] Домен не в спам-листах (DNSBL, Spamhaus)
- [ ] TLD из безопасных: .com, .org, .net, .io, .co
- [ ] domain_safe_page_score > 60 (< 40 = HIGH RISK)

### Аккаунт
- [ ] Нет активных предупреждений (policy_violation_count = 0)
- [ ] Нет отклонённых объявлений из предыдущих кампаний (ad_disapproval_count = 0)
- [ ] BIN ban rate < 20% (bin_ban_rate < 20)
- [ ] Нет связей с забаненными аккаунтами (connected_banned_accounts = 0)`,
    });

  await knex('best_practices')
    .where('title', 'Выбор домена')
    .update({
      content: `## Выбор домена — критерии и пороги риска

### Возраст домена (domain_age_days)
| Значение | Риск | Действие |
|----------|------|----------|
| < 14 дней | КРИТИЧЕСКИЙ | Не запускать |
| 14–30 дней | ВЫСОКИЙ | Только белые вертикали, малый бюджет |
| 30–90 дней | СРЕДНИЙ | Осторожно, мониторить |
| 90–180 дней | НИЗКИЙ | Приемлемо |
| > 180 дней | МИНИМАЛЬНЫЙ | Хорошо |

### Безопасность (domain_has_ssl, domain_has_privacy_page)
- domain_has_ssl = false → ВЫСОКИЙ риск немедленного бана
- domain_has_privacy_page = false → нарушение политик для nutra/finance/crypto

### Safe Page Score (domain_safe_page_score)
| Значение | Оценка |
|---------|--------|
| < 30 | КРИТИЧЕСКИЙ — не запускать |
| 30–50 | ВЫСОКИЙ риск |
| 50–70 | СРЕДНИЙ — улучшить перед запуском |
| > 70 | ПРИЕМЛЕМО |
| > 85 | ХОРОШО |

### TLD
- Безопасные: .com .org .net .io .co .app
- Рискованные: .xyz .top .click .online .site .info
- Под запретом: .xxx, ccTLD экзотических юрисдикций

### Красные флаги
- WHOIS-privacy скрыт (подозрительно для Google)
- Shared-хостинг с другими забаненными сайтами
- История использования в других серых кампаниях`,
    });

  await knex('best_practices')
    .where('title', 'Креативы для Nutra')
    .update({
      content: `## Креативы для вертикали Nutra

### Абсолютно запрещено
- "До и после" без дисклеймера "Results may vary"
- "FDA approved" / "FDA cleared" (если нет официального одобрения)
- "Clinically proven" без ссылки на реальное исследование с DOI
- Гарантии результата: "похудеете на X кг за Y дней"
- Медицинские термины без лицензированного врача в объявлении
- "Cure", "treat", "prevent" применительно к болезням
- Fake-отзывы с фотостоковыми изображениями
- Countdown-таймеры "акция заканчивается через..."

### Обязательные дисклеймеры в объявлениях
- "Results may vary"
- "Individual results may differ"
- "Not evaluated by the FDA" (для продуктов не-FDA)
- "Consult your healthcare provider before use"

### Рекомендуемые формулировки (Headlines)
- "Support your wellness journey"
- "Natural ingredients for daily use"
- "Backed by [N] customer reviews"
- Избегать: lose/burn/melt/blast (применительно к жиру)

### Частые причины disapproval в Nutra
- Misleading content (обман в заголовке)
- Dangerous products policy
- Personalized advertising restrictions
- Healthcare and medicine policy

### Триггеры немедленного бана
- ad_disapproval_count ≥ 3 с одинаковой причиной = системное нарушение
- policy_violation_count > 0 с кодом HEALTH_MEDICAL → смена лендинга обязательна`,
    });

  await knex('best_practices')
    .where('title', 'Креативы для Gambling')
    .update({
      content: `## Креативы для вертикали Gambling

### Запрещённые слова в заголовках/описаниях
casino, slot, jackpot, poker, roulette, blackjack, win money, guaranteed win,
риск минимален, без проигрышей, get rich, easy money

### Запрещённые элементы
- Обещания выигрыша или возврата денег
- Бонусы за депозит (в EU, UK, AU без лицензии)
- Таргетинг несовершеннолетних (18+ gate обязателен на лендинге)
- Лексика призывающая к ставкам: "bet now", "place your bet"

### Разрешённые формулировки
- "Online entertainment platform"
- "Play your favourite games"
- "Join [N] players worldwide"
- "Licensed and regulated gaming"
- "Gamble responsibly — 18+"

### Требования к лендингу
- Возрастная проверка 18+ (age gate) на входе
- "Gamble Responsibly" и ссылка на helpline (BeGambleAware и т.п.)
- Лицензия указана явно (jurisdiction + license number)
- Ссылка на политику самоисключения

### GEO-ограничения
- UK: лицензия UKGC обязательна, строгие требования к рекламе
- AU: запрет большинства gambling-рекламы
- US: разрешено только в штатах с легальным gambling (NJ, NV, PA и др.)
- Tier-1 EU: локальная лицензия для каждой страны

### Сигналы риска
- Отсутствие возрастного гейта на лендинге → CRITICAL
- Таргетинг на GEO без лицензии → гарантированный бан`,
    });

  await knex('best_practices')
    .where('title', 'Управление бюджетом')
    .update({
      content: `## Управление бюджетом — стратегия и пороги

### Фазы роста бюджета
1. **Неделя 1 (account_age_days 0–7):** $10–20/день, +0% масштабирования
2. **Неделя 2–3 (8–21 дней):** +20–30% каждые 2–3 дня при стабильном CTR
3. **Месяц 2 (22–60 дней):** +30–50% каждые 3–5 дней
4. **После 60 дней:** масштабировать агрессивнее, но мониторить spend_velocity

### Spend Velocity Ratio (spend_velocity_ratio)
| Значение | Статус | Действие |
|----------|--------|----------|
| < 1.0 | Стабильно | Ничего |
| 1.0–1.5 | Нормальный рост | Мониторить |
| 1.5–2.0 | Ускорение | Проверить причину |
| 2.0–3.0 | ПРЕДУПРЕЖДЕНИЕ | Снизить бюджет на 30–50% |
| > 3.0 | КРИТИЧЕСКИЙ | Поставить кампании на паузу |

### Максимальные дневные бюджеты по возрасту
| account_age_days | Безопасный максимум |
|-----------------|---------------------|
| 0–7 | $20 |
| 8–14 | $50 |
| 15–30 | $100 |
| 31–60 | $300 |
| 61–90 | $500 |
| > 90 | Без жёсткого лимита, но мониторить |

### Экстренные сигналы
- daily_spend_avg увеличился > 200% за 1 день → немедленная пауза
- CTR упал > 40% при неизменном бюджете → обновить креативы
- total_spend_usd превысил исторический дневной max × 5 → стоп`,
    });

  await knex('best_practices')
    .where('title', 'Подача апелляции')
    .update({
      content: `## Подача апелляции — тактика по типу бана

### Общий алгоритм
1. Подождать 24–48 ч после бана (не подавать сразу)
2. Устранить ВСЕ нарушения на лендинге и в объявлениях
3. Убедиться domain_has_privacy_page = true, domain_has_ssl = true
4. Подать апелляцию через официальную форму Google Ads
5. Ждать 3–5 рабочих дней; повторная подача не раньше чем через 7 дней

### Структура текста апелляции
1. **Признание** (даже если не согласны): "We acknowledge that our account was suspended..."
2. **Причина нарушения**: кратко, без оправданий
3. **Принятые меры**: конкретно что изменили (URL, текст, политика)
4. **Доказательства**: скриншоты обновлённого лендинга
5. **Обязательство**: "We commit to maintaining compliance..."

### По типу бана
| Причина бана | Тактика |
|-------------|---------|
| Misleading content | Убрать клеймы, добавить дисклеймеры |
| Circumventing systems | Полная смена домена, IP, профиля |
| Dangerous products | Смена вертикали или полный редизайн оффера |
| Billing issues | Привязать новую карту с историей |
| Policy violations | Fix конкретного нарушения + appeal |

### Когда не подавать апелляцию
- Бан аккаунта по причине "circumventing systems" — почти никогда не одобряют
- connected_banned_accounts > 2 — Google видит связи, appeal бесполезен
- Аккаунт уже имел 2+ rejected appeals — создать новый`,
    });

  await knex('best_practices')
    .where('title', 'Настройка PMax кампании')
    .update({
      content: `## Performance Max — настройка и пороги

### Минимальные требования к Asset Group
- Заголовков: ≥ 5 (рекомендуется 15)
- Описаний: ≥ 5 (рекомендуется 4 длинных)
- Изображений: ≥ 3 (1:1, 1.91:1, 4:5)
- Логотип: обязателен
- Видео: рекомендуется (иначе Google генерирует автоматически — риск)

### Критические настройки для серых вертикалей
- **URL expansion = OFF** (иначе Google сам выбирает лендинги)
- **Final URL expansion = OFF** (иначе трафик на нерелевантные страницы)
- **Brand exclusions** — исключить название бренда конкурентов
- **Audience signals** — добавить custom intent + in-market аудитории

### Стратегия ставок
- Старт: Target CPA (не Maximize Conversions — слишком агрессивно для новых аккаунтов)
- После 30+ конверсий: можно переключить на Maximize Conversion Value
- Никогда: Target ROAS на аккаунте < 30 дней

### Признаки проблем с PMax
- low_qs_keyword_ratio > 0.5 в поисковых запросах PMax → добавить negative keywords
- ad_disapproval_count > 0 в PMax → проверить все asset groups
- CTR < 0.5% через 14 дней → обновить креативы или пересмотреть audience signals

### Для gambling/nutra
- Обязательно: exclude branded terms конкурентов
- Добавить location exclusions (страны без лицензий)
- Не использовать автоматически сгенерированные видео (могут нарушать политику)`,
    });

  // ── 2. New high-priority AI-oriented practices ──────────────────────────────

  const adminResult = await knex('users').where('role', 'admin').first('id');
  const adminId = adminResult?.id ?? null;

  await knex('best_practices').insert([
    {
      category: 'ban_prevention',
      title: 'Числовые пороги риска для AI-анализа',
      content: `## Числовые пороги — справочник для анализа аккаунта

Используй эти пороги при оценке каждого поля в данных аккаунта.

### Возраст аккаунта (account_age_days)
| Значение | Риск-уровень |
|----------|-------------|
| 0–7 | КРИТИЧЕСКИЙ (очень уязвим) |
| 8–30 | ВЫСОКИЙ |
| 31–90 | СРЕДНИЙ |
| > 90 | НИЗКИЙ |

### Нарушения политики (policy_violation_count)
| Значение | Интерпретация |
|----------|--------------|
| 0 | Норма |
| 1 | Предупреждение — исправить |
| 2 | ВЫСОКИЙ риск |
| ≥ 3 | КРИТИЧЕСКИЙ — немедленная пауза |

### Отклонённые объявления (ad_disapproval_count)
| Значение | Интерпретация |
|----------|--------------|
| 0 | Норма |
| 1–2 | Низкий риск, мониторить |
| 3–5 | СРЕДНИЙ — пересмотреть все объявления |
| > 5 | ВЫСОКИЙ — системное нарушение политик |

### Скорость расхода (spend_velocity_ratio)
| Значение | Интерпретация |
|----------|--------------|
| < 1.0 | Стабильно |
| 1.0–1.5 | Нормальный рост |
| 1.5–2.0 | Ускорение, мониторить |
| 2.0–3.0 | ПРЕДУПРЕЖДЕНИЕ |
| > 3.0 | КРИТИЧЕСКИЙ |

### BIN ban rate (bin_ban_rate)
| Значение | Риск |
|----------|------|
| null / нет данных | Неизвестен |
| < 15% | Низкий |
| 15–30% | СРЕДНИЙ |
| > 30% | ВЫСОКИЙ — сменить карту |
| > 50% | КРИТИЧЕСКИЙ — немедленно сменить |`,
      priority: 18,
      created_by: adminId,
    },
    {
      category: 'ban_prevention',
      title: 'Критические сигналы связей аккаунтов',
      content: `## Связи с забаненными — интерпретация сигналов

Это наиболее сильные предикторы бана по цепочке (ban chain).

### connected_banned_accounts
| Значение | Риск | Действие |
|----------|------|----------|
| 0 | Норма | — |
| 1 | СРЕДНИЙ | Проверить что именно связано (домен или BIN) |
| 2 | ВЫСОКИЙ | Сменить общие ресурсы |
| ≥ 3 | КРИТИЧЕСКИЙ | Полная смена инфраструктуры |

### shared_domain_with_banned = true
- Уровень риска: **КРИТИЧЕСКИЙ**
- Означает: домен аккаунта уже использовался в забаненном аккаунте
- Действие: немедленно сменить домен, не запускать новые кампании на старом

### shared_bin_with_banned = true
- Уровень риска: **ВЫСОКИЙ**
- Означает: платёжная карта (BIN) связана с другим забаненным аккаунтом
- Действие: сменить платёжный метод в течение 24–48 ч

### Комбинированные риски (усиливают друг друга)
- shared_domain_with_banned = true + shared_bin_with_banned = true → НЕМЕДЛЕННАЯ ПАУЗА
- connected_banned_accounts ≥ 2 + spend_velocity_ratio > 2.0 → экстренная остановка
- policy_violation_count ≥ 2 + connected_banned_accounts ≥ 1 → высокая вероятность бана в 24–48 ч

### Типичный паттерн ban chain
1. Аккаунт A банится
2. Аккаунт B использует тот же домен → банится в течение 7–14 дней
3. Аккаунт C использует тот же BIN → банится в течение 3–7 дней
4. Ключ: сразу после бана A нужно ротировать ресурсы для B и C`,
      priority: 17,
      created_by: adminId,
    },
    {
      category: 'budget_strategy',
      title: 'Интерпретация скорости расхода для AI',
      content: `## Spend Velocity — как интерпретировать и что рекомендовать

### Что такое spend_velocity_ratio
Отношение текущей скорости расхода к историческому среднему аккаунта.
- 1.0 = расход идёт в обычном темпе
- 2.0 = расход вдвое быстрее обычного
- 3.0 = расход в три раза быстрее — серьёзный сигнал

### Причины аномального роста velocity
**Технические:**
- Кампания вышла из Learning Period — расход растёт нормально (velocity 1.5–2.0 до 14 дней)
- Сезонный всплеск (holidays, sales) — проверить по датам

**Опасные:**
- Аккаунт начал показываться по нецелевым, дорогим запросам (нет минус-слов)
- Google тестирует агрессивный bid (особенно в PMax с Maximize Conversions)
- Click fraud на конкурентов (internal или external)
- Баг с дублированием конверсий — ставки завысились автоматически

### Рекомендации по порогам
| spend_velocity_ratio | Рекомендация для AI |
|---------------------|---------------------|
| < 1.5 | Норма, не требует действий |
| 1.5–2.0 | Проверить поисковые запросы, убедиться нет мусора |
| 2.0–2.5 | Снизить бюджет на 30%, поставить bid cap |
| 2.5–3.0 | Снизить бюджет на 50% или пауза до выяснения |
| > 3.0 | Немедленная пауза всех кампаний |

### Контекст: аккаунт в первые 7 дней
- Во время прогрева (account_age_days < 8) velocity > 1.5 = ABNORMAL (бюджет должен расти постепенно)
- Резкий spend при account_age_days < 7 и spend_velocity_ratio > 2.0 = сигнал мошенничества или ошибки`,
      priority: 16,
      created_by: adminId,
    },
    {
      category: 'domain_selection',
      title: 'Пороги оценки домена для AI-анализа',
      content: `## Оценка домена — числовые пороги и интерпретация

### domain_age_days
| Порог | Риск-уровень | Контекст |
|-------|-------------|---------|
| < 7 дней | КРИТИЧЕСКИЙ | Гарантированный бан при старте |
| 7–14 дней | ВЫСОКИЙ | Только тест с $5–10/день |
| 14–30 дней | СРЕДНИЙ-ВЫСОКИЙ | Осторожно, только белые вертикали |
| 30–90 дней | СРЕДНИЙ | Допустимо при хорошем контенте |
| 90–365 дней | НИЗКИЙ | Хороший домен |
| > 365 дней | МИНИМАЛЬНЫЙ | Отлично |

### domain_has_ssl
- false → ВЫСОКИЙ риск: Google с 2018 года явно ниже ранжирует non-HTTPS, плюс policy violation
- Самоподписанный SSL приравнивается к false
- Требование: Let's Encrypt или выше

### domain_has_privacy_page
- false при вертикалях nutra, finance, crypto, dating → КРИТИЧЕСКИЙ риск (нарушение Privacy Policy Google)
- false при gambling → ВЫСОКИЙ риск
- false при ecommerce → СРЕДНИЙ риск

### domain_safe_page_score (0–100)
| Диапазон | Оценка |
|---------|--------|
| 0–29 | КРИТИЧЕСКИЙ — запрещено запускать |
| 30–49 | ВЫСОКИЙ риск |
| 50–64 | СРЕДНИЙ — требует доработки |
| 65–79 | ПРИЕМЛЕМО |
| 80–100 | ХОРОШО — безопасно |

### Комбинации максимального риска
- domain_age_days < 30 + domain_has_ssl = false → не запускать
- domain_safe_page_score < 50 + offer_vertical in (nutra, gambling, crypto) → высокий риск бана в первые 48 ч
- domain_has_privacy_page = false + offer_vertical = nutra → исправить до запуска`,
      priority: 15,
      created_by: adminId,
    },
    {
      category: 'campaign_setup',
      title: 'Нормы Quality Score и отклонений объявлений',
      content: `## Quality Score и объявления — пороги и интерпретация

### avg_quality_score (1–10)
| Значение | Оценка | Действие |
|---------|--------|---------|
| 1–3 | КРИТИЧЕСКИ НИЗКИЙ | Полная переработка ключей и объявлений |
| 4 | НИЗКИЙ | Улучшить relevance, landing page experience |
| 5–6 | СРЕДНИЙ | Норма для новых кампаний |
| 7–8 | ХОРОШИЙ | Поддерживать, масштабировать |
| 9–10 | ОТЛИЧНЫЙ | Флагманские кампании |

### low_qs_keyword_ratio (доля ключей с QS ≤ 4)
| Значение | Риск | Действие |
|----------|------|---------|
| < 0.10 | Норма | — |
| 0.10–0.20 | Низкий | Проверить нерелевантные ключи |
| 0.20–0.35 | СРЕДНИЙ | Почистить или добавить минус-слова |
| 0.35–0.50 | ВЫСОКИЙ | Паузировать низкокачественные ключи |
| > 0.50 | КРИТИЧЕСКИЙ | Перестроить структуру кампании |

### ad_disapproval_count
| Значение | Интерпретация |
|----------|--------------|
| 0 | Норма |
| 1 | Случайное нарушение, исправить |
| 2–3 | Паттерн нарушений — проверить все объявления вертикали |
| 4–5 | Системное нарушение — смена подхода к креативам |
| > 5 | КРИТИЧЕСКИЙ — аккаунт под угрозой бана |

### Взаимосвязь QS и бана
- avg_quality_score < 4 + ad_disapproval_count > 3 → синергетический эффект → HIGH BAN RISK
- Низкий QS заставляет Google внимательнее изучать аккаунт
- Высокий QS (≥ 7) частично компенсирует другие риски

### Нормы CTR по типу кампании
| Тип | Нормальный CTR | Тревожный порог |
|-----|----------------|-----------------|
| Search | 3–8% | < 1% или > 15% |
| Display | 0.1–0.5% | < 0.05% |
| PMax | 2–5% | < 0.5% |
| Shopping | 0.5–2% | < 0.2% |`,
      priority: 14,
      created_by: adminId,
    },
    {
      category: 'ban_prevention',
      title: 'Типичные паттерны бана по вертикалям',
      content: `## Паттерны бана — что Google видит как нарушение

### Gambling
**Самые частые причины:**
1. Unlicensed gambling offer в GEO без лицензии — 60% всех банов
2. Misleading claims ("guaranteed win") — 25%
3. Age gate отсутствует или легко обходится — 10%
4. Слова-триггеры в объявлениях (casino, slots, jackpot) — 5%

**Паттерн перед баном:** сначала disapproved объявления → потом policy violation → бан через 2–7 дней

### Nutra
**Самые частые причины:**
1. Healthcare and medicines policy — 70% (ложные медицинские клеймы)
2. Misleading content (до/после без дисклеймера) — 20%
3. Personalized ads restrictions — 10%

**Паттерн:** высокий CTR (>5%) → Google проверяет landing page → нарушение → быстрый бан (< 24 ч)

### Crypto
**Самые частые причины:**
1. Financial products and services policy — 55%
2. Unlicensed financial services — 35%
3. Deceptive crypto promotions — 10%

**Паттерн:** медленный бан (7–14 дней) после накопления сигналов

### Finance
**Самые частые причины:**
1. Financial services certification отсутствует — 65%
2. Inaccurate claims (гарантированный доход) — 25%
3. Scam operations — 10%

### Dating
**Самые частые причины:**
1. Sexual content policy — 50%
2. Adult content on landing page — 30%
3. Misleading personals — 20%

### Универсальные паттерны (все вертикали)
- **BIN chain:** один BIN на 3+ аккаунтах → бан всей цепочки за 3–5 дней
- **Domain reuse:** домен с историей бана → новый аккаунт банится в 48–72 ч
- **Aggressive scaling:** резкий рост бюджета (×5 за 1 день) → триггер ревью → бан`,
      priority: 13,
      created_by: adminId,
    },
    {
      category: 'budget_strategy',
      title: 'Безопасные лимиты расхода по возрасту аккаунта',
      content: `## Лимиты бюджета по возрасту — для оценки текущего состояния

### Таблица безопасных дневных бюджетов
| account_age_days | Безопасный max/день | Тревожный порог | Критический порог |
|-----------------|---------------------|-----------------|-------------------|
| 0–7 | $20 | > $30 | > $50 |
| 8–14 | $50 | > $80 | > $120 |
| 15–30 | $100 | > $150 | > $250 |
| 31–60 | $300 | > $500 | > $800 |
| 61–90 | $500 | > $800 | > $1500 |
| > 90 | Без ограничения | Мониторить velocity | velocity > 3.0 |

### Как оценивать daily_spend_avg
- Если daily_spend_avg > "Тревожный порог" для данного account_age_days → предупреждение
- Если daily_spend_avg > "Критический порог" → риск бана HIGH
- Исключение: аккаунт с total_spend_usd > $5000 и нулевыми нарушениями — можно масштабировать быстрее

### Общий расход total_spend_usd как сигнал надёжности
| total_spend_usd | Интерпретация |
|----------------|--------------|
| < $50 | Новичок — максимальная осторожность |
| $50–$500 | Начинающий — стандартные ограничения |
| $500–$2000 | Устоявшийся — меньше ограничений |
| > $2000 | Надёжный — Google доверяет больше |
| > $10000 | Авторитетный — высокое доверие платформы |

### Примечания для AI-анализа
- Молодой аккаунт (< 30 дней) с daily_spend_avg > $200 = КРАСНЫЙ ФЛАГ
- Аккаунт с нулевым total_spend_usd и активными кампаниями = только что запущен, максимальный риск
- Резкое падение daily_spend_avg до $0 = либо пауза, либо скрытый бан`,
      priority: 12,
      created_by: adminId,
    },
    {
      category: 'ban_prevention',
      title: 'Оценка платёжного метода (BIN)',
      content: `## BIN и платёжные методы — риски и пороги

### bin_ban_rate — процент забаненных аккаунтов с этим BIN
| bin_ban_rate | Риск | Действие |
|-------------|------|---------|
| null (нет данных) | Неизвестен | Использовать осторожно, мониторить |
| 0–10% | НИЗКИЙ | Хороший BIN |
| 10–20% | НИЗКИЙ-СРЕДНИЙ | Допустимо, мониторить |
| 20–35% | СРЕДНИЙ | Рассмотреть смену карты |
| 35–50% | ВЫСОКИЙ | Рекомендуется сменить карту |
| > 50% | КРИТИЧЕСКИЙ | Немедленно сменить карту |

### Признаки проблемного BIN
- BIN связан с виртуальными prepaid картами без верификации (часто банится)
- BIN из юрисдикций с высоким уровнем мошенничества (некоторые оффшоры)
- shared_bin_with_banned = true — уже есть прецедент бана с этим BIN

### Надёжные BIN-типы (исторически меньше банов)
- Корпоративные карты с историей (не prepaid)
- Физические карты verified billing address
- Карты крупных банков (Chase, Wells Fargo, Barclays, Deutsche Bank и т.п.)
- Карты с длинной историей транзакций

### Стратегия ротации карт
- Никогда не использовать одну карту для > 3 аккаунтов одновременно
- После бана любого аккаунта — мониторить остальные аккаунты с тем же BIN
- При bin_ban_rate > 30% — плановая ротация даже если аккаунт активен

### Для AI: как влиять на оценку
- bin_ban_rate > 30% + policy_violation_count > 0 = ВЫСОКИЙ суммарный риск (синергия)
- bin_ban_rate > 50% = доминирующий фактор риска вне зависимости от остальных метрик`,
      priority: 11,
      created_by: adminId,
    },
    // Additional vertical-specific creative practices
    {
      category: 'creative_guidelines',
      offer_vertical: 'crypto',
      title: 'Креативы для Crypto',
      content: `## Креативы для вертикали Crypto

### Требования Google (Financial Services Certification)
- Рекламодатель ОБЯЗАН пройти сертификацию Google для crypto-рекламы
- Без сертификации: 100% disapproval на все объявления
- Сертификация требует: лицензированный обменник ИЛИ wallet ИЛИ tax advisory

### Абсолютно запрещено
- ICO / IEO / IDO продвижение без сертификации
- Гарантии роста курса ("Bitcoin will reach $100k")
- Призывы к немедленной покупке ("Buy before it's too late")
- DeFi/yield farming с нереалистичными APY без раскрытия рисков
- NFT marketplace без сертификации (в большинстве GEO)

### Разрешённые формулировки
- "Buy and sell crypto securely"
- "Licensed crypto exchange — [jurisdication] regulated"
- "Portfolio tracker — monitor your assets"
- "Educational resources about blockchain"

### Обязательные дисклеймеры
- "Crypto assets are highly volatile and risky"
- "You may lose all of your investment"
- "Not financial advice"
- Регуляторный дисклеймер по юрисдикции (FCA, MiCA, etc.)

### GEO-ограничения
- UK (FCA): строжайшие требования, обязательна авторизация FCA
- EU (MiCA 2024): лицензия CASP
- US: почти полный запрет без state-level лицензий
- AU (ASIC): лицензия финансовых услуг

### Сигналы риска для AI
- ad_disapproval_count > 0 в crypto-вертикали чаще всего = нет сертификации
- Высокий CTR (> 5%) при crypto = возможно misleading claim → проверить`,
      priority: 7,
      created_by: adminId,
    },
    {
      category: 'creative_guidelines',
      offer_vertical: 'dating',
      title: 'Креативы для Dating',
      content: `## Креативы для вертикали Dating

### Разрешено и запрещено
**Запрещено абсолютно:**
- Сексуальный контент в объявлениях (sexual suggestiveness)
- "Mail-order bride" и аналогичные формулировки
- Обещания романтических/сексуальных встреч
- Контент предполагающий платный эскорт
- Скрытые платные подписки без явного раскрытия

**Запрещено в большинстве GEO:**
- Акцент на физических характеристиках другого пола
- Формулировки намекающие на случайный секс
- Fake profile advertising ("Real women near you")

**Разрешено:**
- "Meet like-minded people"
- "Join [N] million singles"
- "Find meaningful connections"
- "Dating app for [demographic] — [age+] singles"

### Требования к лендингу
- Возрастная верификация 18+ (обязательно)
- Явная цена подписки до начала регистрации
- Privacy Policy с GDPR-compliant разделом
- Чёткие условия отмены подписки
- Реальные фото пользователей (не stock)

### Compliance по GEO
- EU: GDPR + ePrivacy — явный consent на cookies и marketing emails
- UK: ASA rules — нет misleading claims о базе пользователей
- AU: честная реклама базы (нет "fake activity" при регистрации)

### Типичные причины disapproval
1. Adult/sexual content (даже намёки)
2. Misleading claims (fake users, fake messages)
3. Personalized advertising restrictions

### Сигнал для AI
- dating вертикаль + ad_disapproval_count > 2 = 80% вероятность нарушения sexual content policy`,
      priority: 7,
      created_by: adminId,
    },
    {
      category: 'creative_guidelines',
      offer_vertical: 'finance',
      title: 'Креативы для Finance',
      content: `## Креативы для вертикали Finance

### Требования Google
- Обязательна сертификация Financial Products and Services
- Отдельные требования для: loans, insurance, credit cards, investments, forex/CFD

### Абсолютно запрещено
- "Guaranteed returns" / "Risk-free investment"
- APR скрыт или указан неправомерно маленьким шрифтом
- Payday loans advertising в запрещённых GEO
- CFD/Forex без регуляторного предупреждения о потерях
- "Get out of debt guaranteed"
- Binary options (запрещены глобально)

### Обязательные раскрытия по типу продукта
**Loans:** APR range, fees, minimum repayment term
**Credit cards:** representative APR, annual fee
**Investments:** "Capital at risk", "Past performance is not indicative..."
**CFD/Forex:** "X% of retail investors lose money" (по данным регулятора)
**Insurance:** exact coverage limitations

### Формулировки с низким риском disapproval
- "Compare financial products"
- "Check your eligibility — no credit impact"
- "Licensed financial services — [regulator]"
- "Free financial comparison tool"

### GEO-специфика
- UK: FCA авторизация обязательна; "Financial Promotions" rules
- EU: local регулятор (BaFin, AMF, etc.)
- US: SEC/FINRA для investments; state licenses для loans

### Сигналы риска для AI
- finance вертикаль + domain_has_privacy_page = false → CRITICAL (GDPR + Google policy)
- finance + bin_ban_rate > 20% → нестандартная платёжная схема, проверить`,
      priority: 7,
      created_by: adminId,
    },
    {
      category: 'campaign_setup',
      campaign_type: 'search',
      title: 'Настройка Search кампании',
      content: `## Search Campaign — лучшие практики и пороги

### Структура кампании
- 1 кампания = 1 тема / 1 продукт (не смешивать)
- 2–5 групп объявлений на кампанию (SKAG или тематические группы)
- 3+ объявления на группу (минимум 1 RSA + 1–2 expanded)
- Match types: старт с Phrase + Exact; Broad только после накопления данных (>200 конверсий)

### Минус-слова (критически важно для серых вертикалей)
- Добавить общий список "мусора": free, scam, review, reddit, lawsuit
- Для nutra: diet, weight loss при отсутствии релевантного оффера
- Для gambling: casino (если оффер не казино), poker
- Для finance: fraud, complaint, scam

### Quality Score — цели
- Запуск: avg_quality_score ≥ 5 через 7 дней = успешный старт
- Через 30 дней: avg_quality_score ≥ 6
- low_qs_keyword_ratio > 0.3 через 14 дней = пересмотреть структуру

### Ставки
- Новый аккаунт (account_age_days < 30): Target CPA или Manual CPC с bid cap
- Никогда: Maximize Clicks без bid cap на новом аккаунте (неконтролируемый spend)
- Target Impression Share только для брендовых кампаний

### Признаки здоровой Search-кампании
- CTR > 3% (для нефинансовых вертикалей)
- Search Impression Share > 20%
- avg_quality_score ≥ 6
- ad_disapproval_count = 0

### Красные флаги
- CTR < 0.5% через 7 дней → нерелевантные ключи или плохой заголовок
- low_qs_keyword_ratio > 0.4 → проблема с relevance ad ↔ landing page
- 0 конверсий при > $100 spend → проверить конверсионный тег`,
      priority: 6,
      created_by: adminId,
    },
    {
      category: 'creative_guidelines',
      offer_vertical: 'sweepstakes',
      title: 'Креативы для Sweepstakes',
      content: `## Креативы для вертикали Sweepstakes

### Легальная база
- Sweepstakes (розыгрыши) легальны при соблюдении: NO PURCHASE NECESSARY
- Нельзя требовать оплату за участие в розыгрыше (это лотерея — требует лицензию)

### Запрещено
- "You have been selected!" (misleading — имитация уведомления)
- "Claim your prize" без ясного условия "No purchase necessary"
- Fake winner notifications
- Имитация системных уведомлений (popup-стиль "Virus detected")
- Countdown "Prize expires in 10 minutes"
- Скрытые платные подписки под видом регистрации

### Обязательные элементы на лендинге
- "No purchase necessary to enter or win"
- Official rules (link)
- Prize details and odds of winning
- Eligibility requirements (age, GEO)
- Sponsor information

### Разрешённые формулировки
- "Enter for a chance to win [prize]"
- "Free entry — no purchase required"
- "[Prize] Giveaway — enter now"
- Избегать "guaranteed", "you won", "selected"

### Частые причины disapproval
1. Misleading ad content (имитация уведомлений) — 70%
2. Gambling policy (если оффер выглядит как лотерея) — 20%
3. Scam-like content — 10%

### Для AI
- sweepstakes + ad_disapproval_count > 3 = скорее всего misleading content
- Особенно уязвимы push-style объявления ("Congratulations!")`,
      priority: 6,
      created_by: adminId,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // Remove the new practices added in this migration
  await knex('best_practices').whereIn('title', [
    'Числовые пороги риска для AI-анализа',
    'Критические сигналы связей аккаунтов',
    'Интерпретация скорости расхода для AI',
    'Пороги оценки домена для AI-анализа',
    'Нормы Quality Score и отклонений объявлений',
    'Типичные паттерны бана по вертикалям',
    'Безопасные лимиты расхода по возрасту аккаунта',
    'Оценка платёжного метода (BIN)',
    'Креативы для Crypto',
    'Креативы для Dating',
    'Креативы для Finance',
    'Настройка Search кампании',
    'Креативы для Sweepstakes',
  ]).delete();

  // Note: reversing the content updates to original values is omitted intentionally —
  // the original content was minimal seed data and rollback of text is impractical.
}
