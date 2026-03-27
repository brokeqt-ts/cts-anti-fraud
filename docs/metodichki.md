# Методички для AI — CTS Anti-Fraud

## Как заполнять на сайте

| Поле | Значение |
|------|----------|
| **Вертикаль** | gambling / nutra / crypto / dating / sweepstakes / finance / ecommerce — или пусто (универсальная) |
| **Тип кампании** | pmax / search / demand_gen / uac / display / shopping / video — или пусто |
| **Приоритет** | 1–20 (чем выше — тем важнее для AI; топ-10 по приоритету уходят в AI-контекст) |

---

## 1. Числовые пороги и веса факторов риска

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Числовые пороги и веса факторов риска

### ВЕСА ФАКТОРОВ (используй для итоговой оценки)

КРИТИЧЕСКИЕ — любого одного достаточно для вывода HIGH RISK:
- shared_domain_with_banned = true
- shared_bin_with_banned = true
- policy_violation_count ≥ 3
- spend_velocity_ratio > 3.0
- ad_disapproval_count > 5 с одинаковой причиной
- content_risk_score > 85 (из анализа лендинга)
- compliance_score < 25 (из анализа лендинга)

ВЫСОКИЕ — 2 и более = HIGH RISK:
- domain_age_days < 14
- bin_ban_rate > 30%
- ad_disapproval_count > 3
- connected_banned_accounts ≥ 2
- domain_has_ssl = false
- domain_safe_page_score < 30
- content_risk_score 65–85
- compliance_score 25–45
- keyword_risk_score > 60

СРЕДНИЕ — учитываются как контекст:
- account_age_days < 30
- domain_safe_page_score < 60
- low_qs_keyword_ratio > 0.3
- bin_ban_rate 15–30%
- notification_warning_count > 3
- structure_risk_score > 60

### policy_violation_count — IF-THEN

ЕСЛИ policy_violation_count = 0 → нарушений нет, не учитывать
ЕСЛИ policy_violation_count = 1 → предупреждение, исправить в течение 24 ч
ЕСЛИ policy_violation_count = 2 → ВЫСОКИЙ риск, проверить лендинг и объявления
ЕСЛИ policy_violation_count ≥ 3 → КРИТИЧЕСКИЙ, немедленная пауза

### ad_disapproval_count — IF-THEN

ЕСЛИ ad_disapproval_count = 0 → норма
ЕСЛИ ad_disapproval_count = 1–2 → мониторить, разовые нарушения
ЕСЛИ ad_disapproval_count = 3–5 → пересмотреть все объявления вертикали
ЕСЛИ ad_disapproval_count > 5 → КРИТИЧЕСКИЙ, системное нарушение политик

### bin_ban_rate — IF-THEN

ЕСЛИ bin_ban_rate = null → неизвестен, использовать осторожно
ЕСЛИ bin_ban_rate < 15% → низкий риск
ЕСЛИ bin_ban_rate 15–30% → средний риск, мониторить
ЕСЛИ bin_ban_rate > 30% → ВЫСОКИЙ, рекомендовать смену карты
ЕСЛИ bin_ban_rate > 50% → КРИТИЧЕСКИЙ, доминирующий фактор риска независимо от остальных

### domain_content_analysis (если есть данные лендинга)

content_risk_score (0–100): < 40 — хорошо, 40–65 — средний, 65–85 — высокий, > 85 — КРИТИЧЕСКИЙ
compliance_score (0–100): > 75 — хорошо, 45–75 — средний, 25–45 — высокий, < 25 — КРИТИЧЕСКИЙ
keyword_risk_score (0–100): < 40 — хорошо, 40–60 — средний, > 60 — ВЫСОКИЙ
structure_risk_score (0–100): < 50 — норма, 50–70 — средний, > 70 — ВЫСОКИЙ

Красные флаги на лендинге (каждый = отдельный HIGH RISK сигнал):
- has_countdown_timer = true (fake urgency)
- has_fake_reviews = true (misleading content)
- has_before_after = true без дисклеймера (nutra/finance)
- has_hidden_text = true (cloaking)
- url_mismatch = true (URL в объявлении ≠ лендинг — КРИТИЧЕСКИЙ)
```

---

## 2. Критические сигналы связей аккаунтов

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Связи с забаненными — IF-THEN логика

### shared_domain_with_banned

ЕСЛИ shared_domain_with_banned = true → КРИТИЧЕСКИЙ
Означает: домен уже был в забаненном аккаунте
Действие: немедленно сменить домен, не запускать новые кампании на старом

### shared_bin_with_banned

ЕСЛИ shared_bin_with_banned = true → ВЫСОКИЙ
Означает: карта связана с забаненным аккаунтом
Действие: сменить платёжный метод в течение 24–48 ч

### connected_banned_accounts

ЕСЛИ connected_banned_accounts = 0 → норма
ЕСЛИ connected_banned_accounts = 1 → СРЕДНИЙ, выяснить что именно общее
ЕСЛИ connected_banned_accounts = 2 → ВЫСОКИЙ, сменить общие ресурсы
ЕСЛИ connected_banned_accounts ≥ 3 → КРИТИЧЕСКИЙ, полная смена инфраструктуры

### Комбинированные условия (усиливают друг друга)

ЕСЛИ shared_domain_with_banned = true И shared_bin_with_banned = true:
→ КРИТИЧЕСКИЙ, немедленная пауза, смена домена + карты одновременно

ЕСЛИ connected_banned_accounts ≥ 2 И spend_velocity_ratio > 2.0:
→ КРИТИЧЕСКИЙ, два независимых сигнала риска совпали

ЕСЛИ policy_violation_count ≥ 2 И connected_banned_accounts ≥ 1:
→ ВЫСОКИЙ, высокая вероятность бана в течение 24–48 ч

ЕСЛИ shared_domain_with_banned = true И account_age_days < 30:
→ КРИТИЧЕСКИЙ (молодой аккаунт + проблемный домен = почти гарантированный бан)

### Типичный паттерн ban chain
1. Аккаунт A банится
2. Аккаунт B с тем же доменом → банится через 7–14 дней
3. Аккаунт C с тем же BIN → банится через 3–7 дней
Вывод: после бана любого связанного аккаунта — немедленно ротировать ресурсы
```

---

## 3. Интерпретация скорости расхода (Spend Velocity)

- **Категория:** budget_strategy
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Spend Velocity — IF-THEN логика с контекстом

### Базовые пороги spend_velocity_ratio

ЕСЛИ spend_velocity_ratio > 3.0 → КРИТИЧЕСКИЙ, пауза всех кампаний, не анализировать дальше
ЕСЛИ spend_velocity_ratio > 2.5 → ВЫСОКИЙ, снизить бюджет на 50%
ЕСЛИ spend_velocity_ratio > 2.0 → ПРЕДУПРЕЖДЕНИЕ, снизить бюджет на 30%
ЕСЛИ spend_velocity_ratio 1.5–2.0 → проверить поисковые запросы на мусор
ЕСЛИ spend_velocity_ratio < 1.5 → норма, не требует действий

### Контекст меняет интерпретацию

ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days < 14:
→ КРИТИЧЕСКИЙ (молодой аккаунт не должен так расти, сигнал нестабильности)

ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days 7–14 И кампания запущена < 14 дней назад:
→ СРЕДНИЙ (возможно Learning Period — Google тестирует ставки, норма до 14 дней)

ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days > 90 И policy_violation_count = 0:
→ СРЕДНИЙ (зрелый чистый аккаунт может масштабироваться быстрее)

ЕСЛИ spend_velocity_ratio > 1.5 И daily_spend_avg > безопасного лимита для данного account_age_days:
→ ВЫСОКИЙ (двойной сигнал — и скорость, и абсолютный объём превышены)

### Причины аномального роста (для рекомендаций)

Технические — не опасные:
- Learning Period первых 7–14 дней кампании
- Сезонный всплеск (проверить по дате)

Опасные — требуют действий:
- Показы по нецелевым дорогим запросам (нет минус-слов) → добавить минус-слова
- Агрессивный bid в PMax с Maximize Conversions → переключить на Target CPA
- Click fraud → проверить IP отчёт
- Баг с дублированием конверсий → проверить тег конверсии
```

---

## 4. Пороги оценки домена для AI-анализа

- **Категория:** domain_selection
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Оценка домена — IF-THEN с контекстом

### domain_age_days

ЕСЛИ domain_age_days < 7 → КРИТИЧЕСКИЙ, не запускать ни при каких условиях
ЕСЛИ domain_age_days 7–14 → ВЫСОКИЙ, только тест $5–10/день на белой вертикали
ЕСЛИ domain_age_days 14–30 → СРЕДНИЙ-ВЫСОКИЙ, только белые вертикали, малый бюджет
ЕСЛИ domain_age_days 30–90 → СРЕДНИЙ, допустимо с мониторингом
ЕСЛИ domain_age_days > 90 → НИЗКИЙ риск по возрасту

Контекст:
ЕСЛИ domain_age_days < 30 И offer_vertical IN (gambling, nutra, crypto, finance) → КРИТИЧЕСКИЙ
ЕСЛИ domain_age_days < 30 И offer_vertical = ecommerce И domain_safe_page_score > 80 → СРЕДНИЙ

### domain_has_ssl

ЕСЛИ domain_has_ssl = false → ВЫСОКИЙ риск (нарушение политик + Google ранжирует ниже)
ЕСЛИ domain_has_ssl = true → норма, не учитывать

### domain_has_privacy_page

ЕСЛИ domain_has_privacy_page = false И offer_vertical IN (nutra, finance, crypto, dating) → КРИТИЧЕСКИЙ
ЕСЛИ domain_has_privacy_page = false И offer_vertical = gambling → ВЫСОКИЙ
ЕСЛИ domain_has_privacy_page = false И offer_vertical = ecommerce → СРЕДНИЙ

### domain_safe_page_score

ЕСЛИ domain_safe_page_score < 30 → КРИТИЧЕСКИЙ, не запускать
ЕСЛИ domain_safe_page_score 30–49 → ВЫСОКИЙ риск
ЕСЛИ domain_safe_page_score 50–64 → СРЕДНИЙ, рекомендовать доработку
ЕСЛИ domain_safe_page_score 65–79 → ПРИЕМЛЕМО
ЕСЛИ domain_safe_page_score ≥ 80 → ХОРОШО, не учитывать как фактор риска

### Анализ контента лендинга (если доступен)

content_risk_score > 70 → лендинг нарушает политики контента, перед запуском исправить
compliance_score < 40 → критичный недостаток соответствия (отсутствуют Privacy Policy, Terms, Disclaimer)
keyword_risk_score > 60 → серые ключевые слова в тексте (типично для nutra/gambling/crypto)
url_mismatch = true → URL в объявлении не совпадает с реальным лендингом → КРИТИЧЕСКИЙ (cloaking)

Флаги на лендинге:
- has_countdown_timer = true → fake urgency, нарушение misleading content policy
- has_fake_reviews = true → ВЫСОКИЙ, типичная причина бана nutra/dating
- has_hidden_text = true → КРИТИЧЕСКИЙ (cloaking техника, прямое нарушение)
- has_before_after = true без дисклеймера → ВЫСОКИЙ (nutra/dating)
- has_age_verification = false при gambling/dating → КРИТИЧЕСКИЙ

### Самые опасные комбинации

ЕСЛИ domain_age_days < 30 И domain_has_ssl = false → не запускать
ЕСЛИ domain_safe_page_score < 50 И offer_vertical IN (nutra, gambling, crypto) → КРИТИЧЕСКИЙ (бан в первые 48 ч)
ЕСЛИ content_risk_score > 70 И keyword_risk_score > 60 → КРИТИЧЕСКИЙ (лендинг полностью под риском)
```

---

## 5. Нормы Quality Score и отклонений объявлений

- **Категория:** campaign_setup
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Quality Score и объявления — IF-THEN логика

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
ЕСЛИ тип = Shopping И CTR < 0.2% → проблема с фидом или ценами
```

---

## 6. Типичные паттерны бана по вертикалям

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Паттерны бана — что Google видит как нарушение

### Gambling
Причины:
1. Unlicensed gambling в GEO без лицензии — 60%
2. Misleading claims ("guaranteed win") — 25%
3. Нет age gate или он легко обходится — 10%
4. Запрещённые слова (casino, slots, jackpot) — 5%

Паттерн: disapproved объявления → policy violation → бан через 2–7 дней
Сигналы раннего предупреждения: ad_disapproval с кодом GAMBLING_ILLEGAL + has_age_verification = false

### Nutra
Причины:
1. Healthcare and medicines policy (ложные медицинские клеймы) — 70%
2. Misleading content (до/после без дисклеймера) — 20%
3. Personalized ads restrictions — 10%

Паттерн: высокий CTR (>5%) → Google проверяет лендинг → бан < 24 ч
Триггеры на лендинге: has_fake_reviews = true, has_before_after = true, keyword_risk_score > 60

### Crypto
Причины:
1. Financial products and services policy — 55%
2. Unlicensed financial services — 35%
3. Deceptive crypto promotions — 10%

Паттерн: медленный бан (7–14 дней) после накопления сигналов
Сигнал: compliance_score < 40 при crypto + нет регуляторного дисклеймера

### Finance
Причины:
1. Financial services certification отсутствует — 65%
2. Inaccurate claims (гарантированный доход) — 25%
3. Scam operations — 10%

### Dating
Причины:
1. Sexual content policy — 50%
2. Adult content на лендинге — 30%
3. Misleading personals — 20%

Триггер: ad_disapproval_count > 2 в dating = 80% нарушение sexual content policy

### Использование данных похожих аккаунтов (similar_accounts_stats)

ЕСЛИ ban_rate_percent > 70% для данной вертикали:
→ Большинство аккаунтов в этой вертикали банятся — относиться к аккаунту как HIGH RISK изначально

ЕСЛИ avg_lifetime_days < 14 для данной вертикали:
→ Аккаунты в этой вертикали живут очень мало — ускорить ротацию ресурсов

ЕСЛИ common_ban_reasons содержит причину совпадающую с текущим состоянием аккаунта:
→ Указать пользователю: "По статистике похожих аккаунтов, эта причина — самая частая в вертикали"

### Универсальные паттерны (все вертикали)
- BIN chain: один BIN на 3+ аккаунтах → бан всей цепочки за 3–5 дней
- Domain reuse: домен с историей бана → новый аккаунт банится в 48–72 ч
- Aggressive scaling: бюджет ×5 за 1 день → триггер ревью → бан
```

---

## 7. Безопасные лимиты расхода по возрасту аккаунта

- **Категория:** budget_strategy
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Лимиты бюджета по возрасту — IF-THEN

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
ЕСЛИ account_age_days < 14 И spend_velocity_ratio > 1.5 → ВЫСОКИЙ (молодость + ускорение = нестабильность)
```

---

## 8. Оценка платёжного метода (BIN)

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## BIN и платёжные методы — IF-THEN

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
Проблемные: виртуальные prepaid без верификации, shared_bin_with_banned = true
```

---

## 9. Интерпретация трендов и динамики аккаунта

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Тренды — как интерпретировать изменения во времени

### Рост policy_violation_count

ЕСЛИ +1 нарушение за 7 дней → мониторить
ЕСЛИ +2–3 нарушения за 7 дней → Google присматривается, активные изменения в аккаунте
ЕСЛИ +3 нарушения за 3 дня → КРИТИЧЕСКИЙ, высокая вероятность бана в течение 48 ч
ЕСЛИ нарушения накапливались постепенно (1 в неделю 3 недели подряд) → системная проблема с лендингом

### Динамика ad_disapproval_count

ЕСЛИ disapproval появился однократно давно (> 14 дней назад) и не повторялся → вероятно уже исправлен, низкий риск
ЕСЛИ disapproval повторяется с одинаковой причиной → системное нарушение, смена подхода к креативам
ЕСЛИ после исправления disapproval вернулся → лендинг или оффер фундаментально нарушает политику

### Динамика CTR

ЕСЛИ CTR упал > 30% при неизменном бюджете:
→ Creative decay — обновить объявления

ЕСЛИ CTR упал > 30% И одновременно вырос spend:
→ Google расширил аудиторию, идёт нерелевантный трафик — добавить минус-слова

ЕСЛИ CTR вырос > 50% внезапно:
→ Проверить на click fraud или нецелевой трафик (может быть ботный)

### Динамика spend_velocity_ratio

ЕСЛИ velocity стабильно растёт каждый день (1.2 → 1.5 → 1.8 → 2.1):
→ Прогрессирующее ускорение — вмешаться до достижения критического порога

ЕСЛИ velocity резко скакнул за 1 день с нормы до > 2.0:
→ Скорее всего изменение настроек (стратегия ставок, бюджет) — проверить что менялось

### Паттерн "тихий старт → резкий рост"

Описание: аккаунт работает в норме 2–3 недели, затем резкий рост всех метрик
Интерпретация: кампания вышла из Learning Period — это норма
НО: если рост сопровождается ростом policy_violation_count → аккаунт попал под ревью

### Паттерн "стабильный спад"

Описание: CTR падает на 5–10% каждую неделю в течение месяца
Интерпретация: creative decay — объявления "выгорели" для аудитории
Действие: обновить заголовки и описания, протестировать новые офферы
```

---

## 10. Формат итогового анализа аккаунта

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 20

```
## Как структурировать итоговый анализ

### Структура JSON-ответа (обязательные поля)

risk_level: LOW | MEDIUM | HIGH | CRITICAL
→ Определяется по весам факторов: один КРИТИЧЕСКИЙ = CRITICAL/HIGH, два ВЫСОКИХ = HIGH

summary_ru: одна строка с уровнем и главной причиной + конкретными значениями
→ Плохо: "Высокий риск"
→ Хорошо: "ВЫСОКИЙ — shared BIN с забаненным аккаунтом при молодом домене (18 дней)"

top_risk_factors: только значимые отклонения, максимум 5
→ Каждый фактор содержит: factor (название), value (конкретное значение из данных), interpretation (почему опасно)
→ Плохо: factor "spend velocity высокий"
→ Хорошо: factor "spend_velocity_ratio", value "2.8", interpretation "молодой аккаунт (12 дней) + высокий velocity = двойной сигнал нестабильности"

actions_today: только при HIGH/CRITICAL факторах, максимум 3 пункта
→ Конкретное действие + причина + ожидаемый эффект
→ priority: "critical" или "high"

actions_this_week: улучшения для снижения среднесрочных рисков, максимум 4 пункта
→ priority: "medium" или "low"

stable_factors: что работает хорошо и не требует вмешательства
→ Пример: "CTR 4.2% — в норме для Search, не менять ставки"
→ Важно: пользователь должен знать что можно оставить как есть

### Правила итогового вывода

ЕСЛИ есть хотя бы один КРИТИЧЕСКИЙ фактор → risk_level = CRITICAL
ЕСЛИ есть 2+ ВЫСОКИХ фактора → risk_level = HIGH
ЕСЛИ есть 1 ВЫСОКИЙ фактор → risk_level = HIGH (если нет компенсирующих факторов)
ЕСЛИ только СРЕДНИЕ факторы → risk_level = MEDIUM
ЕСЛИ нет ни одного среднего или выше → risk_level = LOW

### Компенсирующие факторы (могут снизить итоговый риск на 1 уровень)

- total_spend_usd > $5000 И policy_violation_count = 0 И account_age_days > 90
- avg_quality_score ≥ 8 И ad_disapproval_count = 0
- domain_safe_page_score > 85 И domain_age_days > 365
- compliance_score > 80 (из анализа лендинга)

### Чего избегать

- Не перечислять все метрики — только значимые отклонения
- Не давать рекомендации по факторам в норме
- Не повторять одно и то же в разных блоках
- Не использовать "возможно", "вероятно" для критических факторов — если данные есть, говорить прямо
- actions_today оставить пустым если нет HIGH/CRITICAL факторов
```

---

## 11. Прогрев аккаунта

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 18

```
## Прогрев аккаунта — IF-THEN по фазам

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
ЕСЛИ has_countdown_timer = true И account_age_days < 14 → ВЫСОКИЙ (Google с большей вероятностью проверит новый аккаунт)

### Признаки успешного прогрева

ЕСЛИ через 7 дней CTR > 1% (Search) или > 0.1% (Display) → прогрев идёт нормально
ЕСЛИ через 14 дней avg_quality_score ≥ 5 → структура кампании правильная
ЕСЛИ policy_violation_count = 0 И ad_disapproval_count = 0 к 14-му дню → зелёный свет для масштабирования

### Когда прогрев считается провалившимся

ЕСЛИ policy_violation_count ≥ 2 до 7-го дня → аккаунт скомпрометирован, не масштабировать
ЕСЛИ ad_disapproval_count > 3 до 14-го дня → системная проблема с креативами или лендингом
ЕСЛИ shared_domain_with_banned = true И account_age_days < 14 → прогрев не имеет смысла, сменить домен
```

---

## 12. Чек-лист перед запуском

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 18

```
## Чек-лист перед запуском — IF-THEN блокеры

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

ЕСЛИ compliance_score > 75 И content_risk_score < 50 → лендинг в порядке
```

---

## 13. Уточняющие вопросы при недостатке данных

- **Категория:** ban_prevention
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 18

```
## Что спросить у пользователя если данных не хватает

Используй эти вопросы когда ключевые поля null или неизвестны.

### bin_ban_rate = null или bin_prefix неизвестен
→ "Какой тип карты — prepaid, виртуальная или корпоративная физическая?"
→ "Карта уже использовалась в других аккаунтах?"

### domain_age_days = null
→ "Когда зарегистрирован домен? Можно проверить на who.is"
→ "Домен новый или покупной с историей?"

### offer_vertical = null или неизвестен
→ "Какой продукт или услуга рекламируется?"
→ Это важно — пороги CTR, нормы и риски сильно отличаются по вертикалям

### connected_banned_accounts > 0 но причина неизвестна
→ "Что именно общее с забаненным аккаунтом — домен, карта, прокси или антидетект-профиль?"
→ Разные типы связи = разный уровень риска и разные действия

### spend_velocity_ratio аномально высокий
→ "Были ли недавно изменения в стратегии ставок или бюджете?"
→ "Совпадает ли рост расхода с запуском новой кампании или изменением оффера?"

### account_age_days очень малый (< 7) при высоком spend
→ "Это действительно новый аккаунт или перенос данных старого?"
→ "Проходил ли аккаунт ручную верификацию Google?"

### Данные лендинга отсутствуют (нет анализа домена)
→ "Лендинг уже запущен в продакшн?"
→ "Есть ли на лендинге Privacy Policy, Terms, контактная форма?"
→ "Есть ли countdown-таймеры, секции до/после, отзывы с фото?"

### Когда уточнять НЕ нужно
- Если значение null у несущественного поля и остальные сигналы дают чёткую картину
- Если уже есть 2+ критических фактора — итоговый вывод не изменится от уточнения
```

---

## 14. Выбор домена

- **Категория:** domain_selection
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 16

```
## Выбор домена — IF-THEN по критериям

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
ЕСЛИ shared-хостинг с другими забаненными доменами → ВЫСОКИЙ (IP-репутация заражена)
```

---

## 15. Управление бюджетом

- **Категория:** budget_strategy
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 14

```
## Стратегия бюджета — IF-THEN

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
ЕСЛИ spend_velocity_ratio > 2.0 И account_age_days < 14 → КРИТИЧЕСКИЙ (двойной сигнал нестабильности)
```

---

## 16. Подача апелляции

- **Категория:** appeal_strategy
- **Вертикаль:** —
- **Тип кампании:** —
- **Приоритет:** 12

```
## Подача апелляции — тактика по типу бана

### Общий алгоритм
1. Подождать 24–48 ч после бана
2. Устранить ВСЕ нарушения на лендинге и в объявлениях
3. Убедиться: domain_has_privacy_page = true, domain_has_ssl = true
4. Подать апелляцию через форму Google Ads
5. Ждать 3–5 рабочих дней; повтор не раньше чем через 7 дней

### Структура текста апелляции
1. Признание: "We acknowledge that our account was suspended..."
2. Причина нарушения: кратко, без оправданий
3. Принятые меры: конкретно что изменили
4. Доказательства: скриншоты обновлённого лендинга
5. Обязательство: "We commit to maintaining compliance..."

### По типу бана
| Причина | Тактика |
|---------|---------|
| Misleading content | Убрать клеймы, добавить дисклеймеры |
| Circumventing systems | Смена домена, IP, профиля |
| Dangerous products | Смена вертикали или редизайн оффера |
| Billing issues | Привязать новую карту с историей |
| Policy violations | Исправить нарушение + appeal |

### Когда не подавать
- "Circumventing systems" — почти никогда не одобряют
- connected_banned_accounts > 2 — Google видит связи, appeal бесполезен
- 2+ rejected appeals подряд — создать новый аккаунт
```

---

## 17. Настройка PMax кампании

- **Категория:** campaign_setup
- **Вертикаль:** —
- **Тип кампании:** pmax
- **Приоритет:** 12

```
## Performance Max — настройка

### Минимум по активам (Asset Group)
- Заголовков: ≥ 5 (рекомендуется 15)
- Описаний: ≥ 5
- Изображений: ≥ 3 (1:1, 1.91:1, 4:5)
- Логотип: обязателен
- Видео: рекомендуется (иначе Google генерирует — риск нарушения)

### Критические настройки для серых вертикалей
- URL expansion = OFF
- Final URL expansion = OFF
- Brand exclusions — исключить конкурентов
- Audience Signals — custom intent + in-market аудитории

### Стратегия ставок
- Старт: Target CPA
- После 30+ конверсий: Maximize Conversion Value
- Никогда: Target ROAS на аккаунте < 30 дней

### Признаки проблем
- low_qs_keyword_ratio > 0.5 → добавить negative keywords
- ad_disapproval_count > 0 → проверить все asset groups
- CTR < 0.5% через 14 дней → обновить креативы

### Для gambling/nutra
- Exclude branded terms конкурентов
- Location exclusions (страны без лицензий)
- Не использовать автогенерированные видео
```

---

## 18. Настройка Search кампании

- **Категория:** campaign_setup
- **Вертикаль:** —
- **Тип кампании:** search
- **Приоритет:** 12

```
## Search Campaign — лучшие практики

### Структура
- 1 кампания = 1 тема / 1 продукт
- 2–5 групп объявлений на кампанию
- 3+ объявления на группу (минимум 1 RSA)
- Match types: старт с Phrase + Exact; Broad после 200+ конверсий

### Минус-слова (обязательно для серых вертикалей)
- Базовый список: free, scam, review, reddit, lawsuit, fraud, complaint
- Для nutra: diet, weight loss (если не релевантно)
- Для gambling: casino (если оффер не казино)
- Для finance: fraud, complaint, scam

### Quality Score — цели
- Через 7 дней: avg_quality_score ≥ 5 = успешный старт
- Через 30 дней: avg_quality_score ≥ 6
- low_qs_keyword_ratio > 0.3 через 14 дней = пересмотреть структуру

### Ставки
- Новый аккаунт (< 30 дней): Target CPA или Manual CPC с bid cap
- Никогда: Maximize Clicks без bid cap на новом аккаунте

### Красные флаги
- CTR < 0.5% через 7 дней → нерелевантные ключи
- low_qs_keyword_ratio > 0.4 → проблема relevance ad ↔ landing page
- 0 конверсий при > $100 spend → проверить тег конверсии
```

---

## 19. Креативы для Nutra

- **Категория:** creative_guidelines
- **Вертикаль:** nutra
- **Тип кампании:** —
- **Приоритет:** 14

```
## Креативы для вертикали Nutra

### Абсолютно запрещено
- "До и после" без дисклеймера "Results may vary"
- "FDA approved" без реального одобрения
- "Clinically proven" без ссылки на исследование с DOI
- Гарантии результата: "похудеете на X кг за Y дней"
- "Cure", "treat", "prevent" применительно к болезням
- Fake-отзывы со стоковыми фото
- Countdown-таймеры "акция заканчивается через..."

### Обязательные дисклеймеры
- "Results may vary"
- "Individual results may differ"
- "Not evaluated by the FDA"
- "Consult your healthcare provider before use"

### Безопасные формулировки
- "Support your wellness journey"
- "Natural ingredients for daily use"
- "Backed by [N] customer reviews"
- Избегать: lose/burn/melt/blast (применительно к жиру)

### Частые причины disapproval
- Misleading content
- Dangerous products policy
- Healthcare and medicine policy

### Триггеры бана
- ad_disapproval_count ≥ 3 с одинаковой причиной = системное нарушение
- policy_violation с кодом HEALTH_MEDICAL → смена лендинга обязательна
- has_before_after = true + has_fake_reviews = true → двойной красный флаг
```

---

## 20. Креативы для Gambling

- **Категория:** creative_guidelines
- **Вертикаль:** gambling
- **Тип кампании:** —
- **Приоритет:** 14

```
## Креативы для вертикали Gambling

### Запрещённые слова в объявлениях
casino, slot, jackpot, poker, roulette, blackjack,
win money, guaranteed win, без проигрышей, get rich

### Запрещённые элементы
- Обещания выигрыша или возврата денег
- Бонусы за депозит (в EU/UK/AU без лицензии)
- Таргетинг несовершеннолетних
- "Bet now", "place your bet"

### Безопасные формулировки
- "Online entertainment platform"
- "Play your favourite games"
- "Join [N] players worldwide"
- "Licensed and regulated gaming"
- "Gamble responsibly — 18+"

### Требования к лендингу
- Возрастная проверка 18+ (age gate) на входе — has_age_verification = true
- "Gamble Responsibly" + ссылка на helpline
- Лицензия указана явно (jurisdiction + license number)
- Ссылка на политику самоисключения

### GEO-ограничения
- UK: лицензия UKGC обязательна
- AU: запрет большинства gambling-рекламы
- US: только штаты с легальным gambling (NJ, NV, PA и др.)
- EU: локальная лицензия для каждой страны

### Сигналы риска
- has_age_verification = false → CRITICAL для gambling
- keyword_risk_score > 60 → серые ключевые слова в тексте
- Таргетинг на GEO без лицензии → гарантированный бан
```

---

## 21. Креативы для Crypto

- **Категория:** creative_guidelines
- **Вертикаль:** crypto
- **Тип кампании:** —
- **Приоритет:** 14

```
## Креативы для вертикали Crypto

### Требования Google
- Обязательна сертификация Financial Services (Google)
- Без сертификации: 100% disapproval на все объявления

### Абсолютно запрещено
- ICO / IEO / IDO без сертификации
- Гарантии роста курса ("Bitcoin will reach $100k")
- "Buy before it's too late"
- DeFi/yield farming с нереалистичными APY без раскрытия рисков
- NFT marketplace без сертификации

### Безопасные формулировки
- "Buy and sell crypto securely"
- "Licensed crypto exchange — [jurisdiction] regulated"
- "Portfolio tracker — monitor your assets"
- "Educational resources about blockchain"

### Обязательные дисклеймеры
- "Crypto assets are highly volatile and risky"
- "You may lose all of your investment"
- "Not financial advice"
- Регуляторный дисклеймер по юрисдикции

### GEO-ограничения
- UK (FCA): обязательна авторизация FCA
- EU (MiCA 2024): лицензия CASP
- US: почти полный запрет без state-level лицензий
- AU (ASIC): лицензия финансовых услуг

### Для AI
- ad_disapproval_count > 0 в crypto = 90% нет сертификации → исправить прежде всего
- compliance_score < 40 при crypto = КРИТИЧЕСКИЙ (нет дисклеймеров)
```

---

## 22. Креативы для Dating

- **Категория:** creative_guidelines
- **Вертикаль:** dating
- **Тип кампании:** —
- **Приоритет:** 14

```
## Креативы для вертикали Dating

### Запрещено
- Сексуальный контент (даже намёки)
- "Mail-order bride" и аналогичные формулировки
- Обещания романтических/сексуальных встреч
- Скрытые платные подписки без явного раскрытия
- Fake profile advertising ("Real women near you")

### Разрешено
- "Meet like-minded people"
- "Join [N] million singles"
- "Find meaningful connections"
- "Dating app for [demographic] — [age+] singles"

### Требования к лендингу
- Возрастная верификация 18+ — has_age_verification = true
- Явная цена подписки до регистрации
- Privacy Policy с GDPR-compliant разделом
- Чёткие условия отмены подписки
- Реальные фото пользователей (не stock) → has_fake_reviews = false

### Compliance
- EU: GDPR + явный consent на cookies и marketing emails
- UK: ASA rules — нет misleading claims о базе пользователей

### Частые причины disapproval
1. Adult/sexual content (даже намёки)
2. Misleading claims (fake users, fake messages)
3. Personalized advertising restrictions

### Для AI
- dating + ad_disapproval_count > 2 = 80% нарушение sexual content policy
- has_age_verification = false → КРИТИЧЕСКИЙ для dating
```

---

## 23. Креативы для Finance

- **Категория:** creative_guidelines
- **Вертикаль:** finance
- **Тип кампании:** —
- **Приоритет:** 14

```
## Креативы для вертикали Finance

### Требования Google
- Сертификация Financial Products and Services обязательна
- Отдельные требования для: loans, insurance, credit cards, investments, forex/CFD

### Абсолютно запрещено
- "Guaranteed returns" / "Risk-free investment"
- APR скрыт или мелким шрифтом
- Payday loans в запрещённых GEO
- CFD/Forex без предупреждения о потерях
- Binary options (запрещены глобально)

### Обязательные раскрытия по типу продукта
- Loans: APR range, fees, minimum repayment term
- Credit cards: representative APR, annual fee
- Investments: "Capital at risk", "Past performance is not indicative..."
- CFD/Forex: "X% of retail investors lose money"
- Insurance: exact coverage limitations

### Безопасные формулировки
- "Compare financial products"
- "Check your eligibility — no credit impact"
- "Licensed financial services — [regulator]"
- "Free financial comparison tool"

### GEO-специфика
- UK: FCA авторизация обязательна
- EU: local регулятор (BaFin, AMF и т.д.)
- US: SEC/FINRA для investments

### Для AI
- finance + domain_has_privacy_page = false → CRITICAL (GDPR + Google policy)
- compliance_score < 40 при finance → КРИТИЧЕСКИЙ
```

---

## 24. Креативы для Sweepstakes

- **Категория:** creative_guidelines
- **Вертикаль:** sweepstakes
- **Тип кампании:** —
- **Приоритет:** 12

```
## Креативы для вертикали Sweepstakes

### Легальная база
- Sweepstakes легальны при соблюдении: NO PURCHASE NECESSARY
- Требование оплаты за участие = лотерея = требует лицензию

### Запрещено
- "You have been selected!" (имитация уведомления)
- "Claim your prize" без явного "No purchase necessary"
- Fake winner notifications
- Имитация системных уведомлений (popup "Virus detected")
- Countdown "Prize expires in 10 minutes"
- Скрытые платные подписки под видом регистрации

### Обязательные элементы на лендинге
- "No purchase necessary to enter or win"
- Official rules (link)
- Prize details and odds of winning
- Eligibility requirements (age, GEO)
- Sponsor information

### Безопасные формулировки
- "Enter for a chance to win [prize]"
- "Free entry — no purchase required"
- "[Prize] Giveaway — enter now"
- Избегать: "guaranteed", "you won", "selected"

### Для AI
- sweepstakes + ad_disapproval_count > 3 = скорее всего misleading content
- Push-style ("Congratulations!") — особо уязвимы
- has_countdown_timer = true при sweepstakes → КРИТИЧЕСКИЙ (fake urgency)
```
