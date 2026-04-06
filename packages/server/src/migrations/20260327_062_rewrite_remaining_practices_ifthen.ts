import type { Knex } from 'knex';

/**
 * Rewrites 7 practices that were still in old table format
 * to match the IF-THEN logic style used in migrations 059+.
 */
export async function up(knex: Knex): Promise<void> {
  // ── 1. Нормы Quality Score ────────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Нормы Quality Score и отклонений объявлений')
    .update({
      content: `## Quality Score и объявления — IF-THEN логика

### avg_quality_score (1–10)

ЕСЛИ avg_quality_score = null → данных нет, опираться на ad_disapproval_count
ЕСЛИ avg_quality_score < 4 → КРИТИЧЕСКИЙ, переработать ключи и объявления немедленно
ЕСЛИ avg_quality_score = 4 → НИЗКИЙ, улучшить релевантность объявлений и лендинга
ЕСЛИ avg_quality_score 5–6 → СРЕДНИЙ, норма для новых кампаний
ЕСЛИ avg_quality_score 7–8 → ХОРОШИЙ, можно масштабировать
ЕСЛИ avg_quality_score ≥ 9 → ОТЛИЧНЫЙ, не трогать

Контекст:
ЕСЛИ avg_quality_score < 5 И account_age_days > 30 → ВЫСОКИЙ (кампания не улучшается, проблема в структуре)
ЕСЛИ avg_quality_score < 5 И account_age_days < 14 → СРЕДНИЙ (норма для первых 2 недель — Learning Period)
ЕСЛИ avg_quality_score ≥ 7 И ad_disapproval_count = 0 → компенсирующий фактор (снижает общий риск)

### low_qs_keyword_ratio (доля ключей с QS ≤ 4)

ЕСЛИ low_qs_keyword_ratio < 0.10 → норма
ЕСЛИ low_qs_keyword_ratio 0.10–0.20 → проверить нерелевантные ключи
ЕСЛИ low_qs_keyword_ratio 0.20–0.35 → СРЕДНИЙ, почистить ключи или добавить минус-слова
ЕСЛИ low_qs_keyword_ratio 0.35–0.50 → ВЫСОКИЙ, паузировать плохие ключи
ЕСЛИ low_qs_keyword_ratio > 0.50 → КРИТИЧЕСКИЙ, перестроить всю структуру кампании

Контекст:
ЕСЛИ low_qs_keyword_ratio > 0.35 И ad_disapproval_count > 2 → КРИТИЧЕСКИЙ (два сигнала плохого качества)
ЕСЛИ low_qs_keyword_ratio > 0.30 И account_age_days < 14 → СРЕДНИЙ (норма для первых 2 недель)

### ad_disapproval_count

ЕСЛИ ad_disapproval_count = 0 → норма
ЕСЛИ ad_disapproval_count = 1 → исправить, единичное нарушение
ЕСЛИ ad_disapproval_count 2–3 → СРЕДНИЙ, проверить все объявления в вертикали
ЕСЛИ ad_disapproval_count 4–5 → ВЫСОКИЙ, системное нарушение — сменить подход к креативам
ЕСЛИ ad_disapproval_count > 5 → КРИТИЧЕСКИЙ, аккаунт под угрозой бана

Контекст по вертикали:
ЕСЛИ ad_disapproval_count ≥ 3 с одинаковой причиной → системное нарушение, смена подхода
ЕСЛИ ad_disapproval_count > 2 И offer_vertical = dating → 80% нарушение sexual content policy
ЕСЛИ ad_disapproval_count > 0 И offer_vertical = crypto → 90% отсутствует сертификация Financial Services
ЕСЛИ ad_disapproval_count > 0 И offer_vertical = nutra → проверить клеймы и дисклеймеры на лендинге

### Комбинированные условия

ЕСЛИ avg_quality_score < 4 И ad_disapproval_count > 3 → КРИТИЧЕСКИЙ (синергия низкого качества и нарушений)
ЕСЛИ avg_quality_score ≥ 7 И ad_disapproval_count = 0 → компенсирует другие средние риски
ЕСЛИ low_qs_keyword_ratio > 0.50 И ad_disapproval_count > 3 → перестроить всю кампанию с нуля

### Нормы CTR по типу кампании

ЕСЛИ тип = Search И CTR < 1% через 7 дней → нерелевантные ключи, пересмотреть структуру
ЕСЛИ тип = Search И CTR > 15% → проверить на click fraud или слишком узкий таргетинг
ЕСЛИ тип = PMax И CTR < 0.5% через 14 дней → обновить креативы в asset groups
ЕСЛИ тип = Display И CTR < 0.05% → объявления не работают, заменить
ЕСЛИ тип = Shopping И CTR < 0.2% → проблема с фидом или ценами`,
    });

  // ── 2. Безопасные лимиты расхода ──────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Безопасные лимиты расхода по возрасту аккаунта')
    .update({
      content: `## Лимиты бюджета по возрасту — IF-THEN

### daily_spend_avg vs account_age_days

ЕСЛИ account_age_days 0–7 И daily_spend_avg > $50 → КРИТИЧЕСКИЙ (норма $20/день)
ЕСЛИ account_age_days 0–7 И daily_spend_avg > $30 → ВЫСОКИЙ
ЕСЛИ account_age_days 0–7 И daily_spend_avg ≤ $20 → норма

ЕСЛИ account_age_days 8–14 И daily_spend_avg > $120 → КРИТИЧЕСКИЙ (норма $50/день)
ЕСЛИ account_age_days 8–14 И daily_spend_avg > $80 → ВЫСОКИЙ
ЕСЛИ account_age_days 8–14 И daily_spend_avg ≤ $50 → норма

ЕСЛИ account_age_days 15–30 И daily_spend_avg > $250 → КРИТИЧЕСКИЙ (норма $100/день)
ЕСЛИ account_age_days 15–30 И daily_spend_avg > $150 → ВЫСОКИЙ

ЕСЛИ account_age_days 31–60 И daily_spend_avg > $800 → КРИТИЧЕСКИЙ
ЕСЛИ account_age_days 61–90 И daily_spend_avg > $1500 → КРИТИЧЕСКИЙ
ЕСЛИ account_age_days > 90 → лимитов по абсолюту нет, контролировать spend_velocity_ratio

### total_spend_usd как контекст доверия

ЕСЛИ total_spend_usd < $50 → новичок, любые аномалии расцениваются строже
ЕСЛИ total_spend_usd 50–500 → начинающий, мониторить velocity
ЕСЛИ total_spend_usd > $2000 → Google доверяет больше, velocity-пороги менее критичны
ЕСЛИ total_spend_usd > $10000 → авторитетный, агрессивный рост менее подозрителен

Контекст:
ЕСЛИ total_spend_usd > $5000 И policy_violation_count = 0 И account_age_days > 90 → смягчающий фактор для velocity-отклонений
ЕСЛИ total_spend_usd = 0 И active_campaign_count > 0 → только запущен, максимальный риск любых аномалий

### Красные флаги

ЕСЛИ account_age_days < 30 И daily_spend_avg > $200 → КРАСНЫЙ ФЛАГ (двойной сигнал: молодость + большой расход)
ЕСЛИ daily_spend_avg резко упал до $0 → пауза или скрытый бан, проверить статус аккаунта немедленно
ЕСЛИ account_age_days < 14 И spend_velocity_ratio > 1.5 → ВЫСОКИЙ (молодость + ускорение = нестабильность)`,
    });

  // ── 3. Оценка BIN ─────────────────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Оценка платёжного метода (BIN)')
    .update({
      content: `## BIN и платёжные методы — IF-THEN

### bin_ban_rate

ЕСЛИ bin_ban_rate = null → неизвестен; уточнить тип карты перед оценкой
ЕСЛИ bin_ban_rate < 10% → НИЗКИЙ, хороший BIN
ЕСЛИ bin_ban_rate 10–20% → НИЗКИЙ-СРЕДНИЙ, допустимо, мониторить
ЕСЛИ bin_ban_rate 20–35% → СРЕДНИЙ, рассмотреть плановую ротацию
ЕСЛИ bin_ban_rate 35–50% → ВЫСОКИЙ, рекомендовать смену карты
ЕСЛИ bin_ban_rate > 50% → КРИТИЧЕСКИЙ, доминирующий фактор риска независимо от всех остальных метрик

### shared_bin_with_banned

ЕСЛИ shared_bin_with_banned = true → ВЫСОКИЙ
Означает: эта карта уже была в забаненном аккаунте
Действие: сменить платёжный метод в течение 24–48 ч

### Комбинированные условия

ЕСЛИ bin_ban_rate > 50% → КРИТИЧЕСКИЙ вне зависимости от возраста и остальных метрик
ЕСЛИ bin_ban_rate > 30% И policy_violation_count > 0 → ВЫСОКИЙ (суммарный риск усиливается)
ЕСЛИ bin_ban_rate > 30% И account_age_days < 30 → КРИТИЧЕСКИЙ (проблемная карта + молодой аккаунт)
ЕСЛИ shared_bin_with_banned = true И connected_banned_accounts ≥ 1 → КРИТИЧЕСКИЙ

Контекст:
ЕСЛИ bin_ban_rate > 30% И total_spend_usd > $5000 И policy_violation_count = 0 → СРЕДНИЙ (история доверия смягчает)

### Стратегия ротации

ЕСЛИ один BIN используется в 3+ аккаунтах одновременно → ВЫСОКИЙ риск цепного бана
ЕСЛИ бан произошёл в любом аккаунте с тем же BIN → немедленно мониторить остальные
ЕСЛИ bin_ban_rate > 30% И аккаунт активен → плановая ротация, не ждать бана

### Надёжные vs проблемные типы

Надёжные: корпоративные физические карты крупных банков с verified billing address
Проблемные: виртуальные prepaid без верификации, shared_bin_with_banned = true`,
    });

  // ── 4. Прогрев аккаунта ───────────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Прогрев аккаунта')
    .update({
      content: `## Прогрев аккаунта — IF-THEN по фазам

### Что делать в зависимости от возраста

ЕСЛИ account_age_days 0–3:
→ Макс. бюджет $5–10/день, 1 кампания, только белый лендинг
→ Нельзя: менять ставки, таргетинг, бюджет, добавлять ключи

ЕСЛИ account_age_days 4–7:
→ Макс. бюджет $10–20/день, 1 кампания
→ Допустимо: белый или серый лендинг

ЕСЛИ account_age_days 8–14:
→ Макс. бюджет $20–50/день, до 2 кампаний, рабочий лендинг

ЕСЛИ account_age_days 15–30:
→ Макс. бюджет $50–100/день, до 3 кампаний

ЕСЛИ account_age_days > 30:
→ Без жёстких ограничений, ориентироваться на spend_velocity_ratio

### Красные флаги во время прогрева

ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days < 7 → КРИТИЧЕСКИЙ, уменьшить бюджет немедленно
ЕСЛИ policy_violation_count > 0 И account_age_days < 3 → СТОП, исправить до продолжения
ЕСЛИ ad_disapproval_count ≥ 2 И account_age_days < 14 → пересмотреть все креативы перед продолжением
ЕСЛИ daily_spend_avg > $50 И account_age_days < 7 → ВЫСОКИЙ, бюджет превышает безопасный уровень

Контекст по лендингу:
ЕСЛИ content_risk_score > 60 И account_age_days < 7 → КРИТИЧЕСКИЙ (рискованный лендинг + молодой аккаунт)
ЕСЛИ has_countdown_timer = true И account_age_days < 14 → ВЫСОКИЙ (Google с большей вероятностью проверит)

### Признаки успешного прогрева

ЕСЛИ через 7 дней CTR > 1% (Search) или > 0.1% (Display) → прогрев идёт нормально
ЕСЛИ через 14 дней avg_quality_score ≥ 5 → структура кампании правильная
ЕСЛИ policy_violation_count = 0 И ad_disapproval_count = 0 к 14-му дню → зелёный свет для масштабирования

### Когда прогрев считается провалившимся

ЕСЛИ policy_violation_count ≥ 2 до 7-го дня → аккаунт скомпрометирован, не масштабировать
ЕСЛИ ad_disapproval_count > 3 до 14-го дня → системная проблема с креативами или лендингом
ЕСЛИ shared_domain_with_banned = true И account_age_days < 14 → прогрев не имеет смысла, сменить домен`,
    });

  // ── 5. Чек-лист перед запуском ────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Чек-лист перед запуском')
    .update({
      content: `## Чек-лист перед запуском — IF-THEN блокеры

### Жёсткие блокеры (ЕСЛИ любое из ниже — НЕ ЗАПУСКАТЬ)

ЕСЛИ domain_age_days < 14 → СТОП (КРИТИЧЕСКИЙ риск)
ЕСЛИ domain_has_ssl = false → СТОП (нарушение политик + риск немедленного бана)
ЕСЛИ domain_has_privacy_page = false И offer_vertical IN (nutra, finance, crypto, dating) → СТОП
ЕСЛИ has_hidden_text = true → СТОП (cloaking)
ЕСЛИ url_mismatch = true → СТОП (несовпадение URL — прямое нарушение)
ЕСЛИ shared_domain_with_banned = true → СТОП (домен с историей бана)
ЕСЛИ connected_banned_accounts ≥ 2 → СТОП (инфраструктура под угрозой)
ЕСЛИ content_risk_score > 80 → СТОП (лендинг критически нарушает политики)
ЕСЛИ compliance_score < 30 → СТОП (слишком много отсутствующих обязательных элементов)

### Предупреждения (запустить можно, но риск повышен)

ЕСЛИ domain_age_days 14–30 И offer_vertical IN (gambling, nutra, crypto) → ВЫСОКИЙ риск
ЕСЛИ domain_safe_page_score < 50 → ВЫСОКИЙ, рекомендовать доработку лендинга
ЕСЛИ bin_ban_rate > 20% → СРЕДНИЙ, рекомендовать смену карты
ЕСЛИ policy_violation_count > 0 → ВЫСОКИЙ (из предыдущих кампаний — исправить)
ЕСЛИ ad_disapproval_count > 0 → СРЕДНИЙ (из предыдущих кампаний — исправить)
ЕСЛИ has_countdown_timer = true → СРЕДНИЙ (fake urgency — убрать до запуска)
ЕСЛИ has_fake_reviews = true → ВЫСОКИЙ (misleading content — убрать)
ЕСЛИ has_before_after = true И offer_vertical = nutra → ВЫСОКИЙ (нужен дисклеймер)

### Зелёный свет (можно запускать)

ЕСЛИ domain_age_days > 30 И domain_has_ssl = true И domain_has_privacy_page = true
  И policy_violation_count = 0 И bin_ban_rate < 20% И connected_banned_accounts = 0 → норма

ЕСЛИ compliance_score > 75 И content_risk_score < 50 → лендинг в порядке`,
    });

  // ── 6. Выбор домена ───────────────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Выбор домена')
    .update({
      content: `## Выбор домена — IF-THEN по критериям

### domain_age_days

ЕСЛИ domain_age_days < 14 → КРИТИЧЕСКИЙ, не запускать ни при каких условиях
ЕСЛИ domain_age_days 14–30 → ВЫСОКИЙ, только белые вертикали, бюджет $5–10/день
ЕСЛИ domain_age_days 30–90 → СРЕДНИЙ, мониторить
ЕСЛИ domain_age_days 90–180 → НИЗКИЙ риск по возрасту
ЕСЛИ domain_age_days > 180 → МИНИМАЛЬНЫЙ, компенсирующий фактор

Контекст:
ЕСЛИ domain_age_days < 30 И offer_vertical IN (gambling, nutra, crypto, finance) → КРИТИЧЕСКИЙ
ЕСЛИ domain_age_days > 90 И domain_safe_page_score > 75 → компенсирует другие средние риски

### domain_has_ssl

ЕСЛИ domain_has_ssl = false → ВЫСОКИЙ, немедленно установить SSL (нарушение политик)
ЕСЛИ domain_has_ssl = true → норма, не учитывать

### domain_has_privacy_page

ЕСЛИ domain_has_privacy_page = false И offer_vertical IN (nutra, finance, crypto, dating) → КРИТИЧЕСКИЙ
ЕСЛИ domain_has_privacy_page = false И offer_vertical = gambling → ВЫСОКИЙ
ЕСЛИ domain_has_privacy_page = false И offer_vertical = ecommerce → СРЕДНИЙ
ЕСЛИ domain_has_privacy_page = true → норма

### domain_safe_page_score

ЕСЛИ domain_safe_page_score < 30 → КРИТИЧЕСКИЙ, не запускать
ЕСЛИ domain_safe_page_score 30–50 → ВЫСОКИЙ, доработать лендинг
ЕСЛИ domain_safe_page_score 50–70 → СРЕДНИЙ, улучшить
ЕСЛИ domain_safe_page_score > 70 → ПРИЕМЛЕМО
ЕСЛИ domain_safe_page_score > 85 → ХОРОШО, компенсирующий фактор

### TLD

ЕСЛИ TLD = .xyz / .top / .click / .online / .site И offer_vertical IN (nutra, crypto) → ВЫСОКИЙ
Безопасные: .com .org .net .io .co .app

### Красные флаги домена

ЕСЛИ домен ранее использовался в забаненном аккаунте (shared_domain_with_banned = true) → КРИТИЧЕСКИЙ
ЕСЛИ WHOIS-privacy скрыт И offer_vertical IN (nutra, gambling, crypto) → ВЫСОКИЙ (усиливает подозрения)
ЕСЛИ shared-хостинг с другими забаненными доменами → ВЫСОКИЙ (IP-репутация заражена)`,
    });

  // ── 7. Управление бюджетом ────────────────────────────────────────────────────
  await knex('best_practices')
    .where('title', 'Управление бюджетом')
    .update({
      content: `## Стратегия бюджета — IF-THEN

### Можно ли масштабировать прямо сейчас?

ЕСЛИ account_age_days < 7 → НЕТ, держать $10–20/день независимо от показателей
ЕСЛИ account_age_days < 14 И spend_velocity_ratio > 1.5 → НЕТ, сначала стабилизировать
ЕСЛИ bin_ban_rate > 30% → НЕТ, сначала сменить карту
ЕСЛИ policy_violation_count > 0 → НЕТ, сначала исправить нарушения
ЕСЛИ avg_quality_score ≥ 6 И policy_violation_count = 0 И spend_velocity_ratio < 1.5 → ДА, безопасно

### Фазы роста бюджета

ЕСЛИ account_age_days 0–7 → без масштабирования, $10–20/день
ЕСЛИ account_age_days 7–21 → рост не более +20–30% каждые 2–3 дня при стабильном CTR
ЕСЛИ account_age_days 22–60 → рост не более +30–50% каждые 3–5 дней
ЕСЛИ account_age_days > 60 → более агрессивный рост допустим при velocity < 2.0

### spend_velocity_ratio — действия

ЕСЛИ spend_velocity_ratio < 1.5 → норма
ЕСЛИ spend_velocity_ratio 1.5–2.0 → проверить поисковые запросы на нерелевантный трафик
ЕСЛИ spend_velocity_ratio 2.0–3.0 → снизить бюджет на 30–50%
ЕСЛИ spend_velocity_ratio > 3.0 → пауза всех кампаний

### Экстренные ситуации

ЕСЛИ daily_spend_avg вырос > 200% за 1 день → немедленная пауза, искать причину
ЕСЛИ CTR упал > 40% при неизменном бюджете → creative decay, обновить объявления
ЕСЛИ total_spend_usd превысил исторический дневной max × 5 → полная остановка

Контекст:
ЕСЛИ spend_velocity_ratio > 2.0 И total_spend_usd > $5000 И account_age_days > 90 → СРЕДНИЙ (зрелый аккаунт может расти быстрее)
ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days < 14 → КРИТИЧЕСКИЙ (двойной сигнал нестабильности)`,
    });
}

export async function down(_knex: Knex): Promise<void> {
  // Revert is not practical for content changes — leaving as no-op
}
