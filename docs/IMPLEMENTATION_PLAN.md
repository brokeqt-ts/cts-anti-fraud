# CTS Anti-Fraud — План реализации Phase 2-3

> Дата составления: 2026-03-24
> Текущее состояние: Phase 1 завершена (~80% спецификации)
> Последняя миграция: 050 (notification_settings)

---

## Статус перед началом

| Компонент | Готовность | Комментарий |
|-----------|-----------|-------------|
| DB Schema (50 миграций) | 100% | Полная схема, materialized views, индексы |
| Chrome Extension | 100% | Перехват, очередь, retry, fingerprint, popup |
| Collect Pipeline | 100% | Raw storage → парсинг → upsert → auto-scoring |
| 24 RPC парсера | 95% | Все основные endpoint'ы Google Ads |
| Assessment + Rules Engine | 100% | 5 факторов, 14 правил, UI готов |
| Auto-Ban Detection | 100% | Автодетекция, post-mortem, уведомления |
| AI Analysis (Claude/GPT/Gemini) | 95% | Адаптеры, промпты, сравнение моделей |
| ML Ban Predictor | 100% | Logistic regression, 26 фичей, explainability |
| Leaderboard | 100% | Composite scoring, period filtering |
| Notification System | 90% | Inbox + admin panel, но нет Telegram |
| Domain Enrichment | 100% | WHOIS, DNS, SSL, cloaking, PageSpeed |
| Auth (JWT + API Key) | 100% | Роли, refresh tokens, extension download |
| CI/CD + Docker | 100% | GitHub Actions, 4-job pipeline |
| Dashboard (16 страниц) | 100% | Все страницы реализованы |

### Что НЕ реализовано (gaps):

1. **Telegram Bot** — placeholder в `auto-ban-detector.ts` (строки 319-328), только `console.log`
2. **AI Feedback Loop** — нет UI кнопок like/dislike, нет таблицы feedback, нет ретрейнинга
3. **Creative Decay Alerts** — endpoint `/analytics/creative-decay` существует, но нет алертов при падении CTR
4. **CTS Integration** — используется `MockCTSAdapter`, нужен реальный адаптер
5. **Смена пароля юзером** — TODO в settings.tsx, нет `PATCH /api/v1/auth/me/password`

---

## PHASE 2: Приоритетные задачи

### ЗАДАЧА 1: Telegram Bot для алертов
**Приоритет:** CRITICAL
**Оценка:** 2-3 дня
**Зависимости:** нет

#### Шаг 1.1: Создать Telegram Bot сервис
**Файл:** `packages/server/src/services/telegram-bot.service.ts`

```
Что реализовать:
- Класс TelegramBotService
- Метод sendMessage(chatId: string, text: string, parseMode?: 'HTML' | 'Markdown')
- Метод sendBanAlert(ban: BanLog, account: Account)
- Метод sendRiskAlert(accountId: string, riskScore: number, factors: string[])
- Метод sendStatusChangeAlert(accountId: string, oldStatus: string, newStatus: string)
- Форматирование сообщений с emoji и HTML
- Retry с exponential backoff (3 попытки)
- Rate limiting (не более 30 сообщений/сек по API Telegram)
```

**Формат сообщений:**
```
🚨 БАН АККАУНТА

Аккаунт: 123-456-7890
Причина: {ban_reason}
Домен: {domain}
Вертикаль: {offer_vertical}
Lifetime: {lifetime_hours}ч
Потрачено: ${total_spend}

📊 Risk Score был: {last_risk_score}/100
🔗 Dashboard: {dashboard_url}/accounts/{google_id}
```

**СТОП-ТОЧКА:** Убедись что сервис работает с тестовым ботом. Отправь себе тестовое сообщение.

#### Шаг 1.2: Env-переменные и конфиг
**Файл:** `packages/server/src/config/env.ts`

```
Добавить:
- TELEGRAM_BOT_TOKEN: string (обязательный для Telegram)
- TELEGRAM_CHAT_ID: string (основной чат команды)
- TELEGRAM_ADMIN_CHAT_ID?: string (отдельный чат для админов)
- TELEGRAM_ENABLED: boolean (default: false)
```

**Файл:** `docker-compose.yml` — добавить переменные в environment

**СТОП-ТОЧКА:** Проверь что сервер стартует с новыми env-переменными (и без них — graceful fallback).

#### Шаг 1.3: Интеграция с auto-ban-detector
**Файл:** `packages/server/src/services/auto-ban-detector.ts`

```
Заменить console.log на строках 319-328:
- Импортировать TelegramBotService
- В notifyBan(): вызвать telegramBot.sendBanAlert()
- В notifyBanResolved(): вызвать telegramBot.sendStatusChangeAlert()
- Обернуть в try/catch — Telegram failure не должен блокировать основной flow
```

**СТОП-ТОЧКА:** Проверь что при детекции бана сообщение уходит в Telegram.

#### Шаг 1.4: Интеграция с notification.service
**Файл:** `packages/server/src/services/notification.service.ts`

```
Добавить:
- Метод shouldSendTelegram(notificationType: string): boolean
  (проверяет notification_settings + TELEGRAM_ENABLED)
- В createNotification(): если shouldSendTelegram — вызвать TelegramBotService
- Поддержка severity → приоритет Telegram (critical = мгновенно, warning = батч)
```

#### Шаг 1.5: Миграция — Telegram настройки
**Файл:** `packages/server/src/migrations/20260325_051_alter_notification_settings_add_telegram.ts`

```sql
ALTER TABLE notification_settings
  ADD COLUMN telegram_enabled BOOLEAN DEFAULT false,
  ADD COLUMN telegram_chat_id TEXT;
```

#### Шаг 1.6: Admin UI — Telegram настройки
**Файл:** `packages/web/src/pages/admin-notifications.tsx`

```
В Settings tab добавить:
- Toggle "Отправлять в Telegram" для каждого типа уведомления
- Поле "Chat ID" (с подсказкой как получить)
- Кнопка "Тест" — отправить тестовое сообщение
```

**СТОП-ТОЧКА:** End-to-end тест: создай бан вручную → проверь что пришло в Telegram + в inbox.

#### Шаг 1.7: Тесты
**Файл:** `packages/server/src/__tests__/integration/telegram.test.ts`

```
- Мок Telegram API
- Тест: sendMessage корректно форматирует
- Тест: retry при 429 (rate limit)
- Тест: graceful failure при network error
- Тест: notification.service отправляет в Telegram когда enabled
- Тест: notification.service НЕ отправляет когда disabled
```

---

### ЗАДАЧА 2: AI Feedback Loop
**Приоритет:** P1
**Оценка:** 3-4 дня
**Зависимости:** нет

#### Шаг 2.1: Миграция — таблица feedback
**Файл:** `packages/server/src/migrations/20260325_052_create_ai_feedback.ts`

```sql
CREATE TABLE ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES ai_model_predictions(id),
  user_id UUID REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN -1 AND 1),
    -- -1 = dislike, 0 = neutral, 1 = like
  feedback_type TEXT NOT NULL DEFAULT 'rating',
    -- 'rating', 'correction', 'comment'
  comment TEXT,
  correct_outcome TEXT,
    -- если юзер знает правильный ответ: 'banned', 'survived', 'appealed'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_ai_feedback_prediction ON ai_feedback(prediction_id);
CREATE INDEX idx_ai_feedback_user ON ai_feedback(user_id);
CREATE INDEX idx_ai_feedback_rating ON ai_feedback(rating);
```

**СТОП-ТОЧКА:** Миграция накатывается и откатывается чисто.

#### Шаг 2.2: Repository
**Файл:** `packages/server/src/repositories/ai-feedback.repository.ts`

```
Методы:
- create(predictionId, userId, rating, comment?, correctOutcome?)
- findByPrediction(predictionId): AiFeedback[]
- findByUser(userId, limit, offset): AiFeedback[]
- getModelFeedbackStats(modelName, period?):
    { total, likes, dislikes, avg_rating, corrections_count }
- getAccuracyWithFeedback(modelName):
    сравнение prediction vs correct_outcome из feedback
```

#### Шаг 2.3: Service — обработка feedback
**Файл:** `packages/server/src/services/ai/feedback.service.ts`

```
Методы:
- submitFeedback(predictionId, userId, rating, comment?, correctOutcome?)
  - Валидация: prediction существует, юзер не голосовал дважды
  - Сохранение в БД
  - Если correctOutcome — обновить ai_model_predictions.actual_outcome

- getModelStats(modelName, period?):
  - Агрегация feedback по модели
  - Возврат: likes, dislikes, accuracy_with_corrections

- recalculateLeaderboard():
  - Вызвать leaderboard.service с учётом feedback corrections
  - Обновить веса моделей в ensemble
```

#### Шаг 2.4: Handler + Route
**Файл:** `packages/server/src/handlers/ai.handler.ts` — добавить методы
**Файл:** `packages/server/src/routes/ai.ts` — добавить endpoint'ы

```
POST /api/v1/ai/predictions/:predictionId/feedback
  Body: { rating: -1|0|1, comment?: string, correct_outcome?: string }
  Response: { id, created_at }

GET /api/v1/ai/predictions/:predictionId/feedback
  Response: { feedbacks: [], stats: { likes, dislikes, corrections } }

GET /api/v1/ai/feedback/stats
  Query: ?model=claude&period=30d
  Response: { model, total, likes, dislikes, avg_rating, accuracy_corrected }
```

**СТОП-ТОЧКА:** Тест через curl/Postman: отправь feedback, получи статистику.

#### Шаг 2.5: Frontend — кнопки feedback
**Файл:** `packages/web/src/pages/ai-analysis.tsx`

```
Добавить к каждому результату анализа:
- Кнопки 👍 / 👎 (rating: 1 / -1)
- При клике на 👎 — раскрыть поле:
  - Комментарий (textarea)
  - Правильный исход (select: "Аккаунт выжил", "Аккаунт забанен", "Апелляция успешна")
- Состояние: не голосовал → проголосовал (зелёная/красная подсветка)
- Счётчик: "12 👍 / 3 👎" под каждым анализом
```

**Файл:** `packages/web/src/api.ts` — добавить функции:
```
submitAiFeedback(predictionId, rating, comment?, correctOutcome?)
getAiFeedback(predictionId)
getAiFeedbackStats(model?, period?)
```

**СТОП-ТОЧКА:** В UI нажми like/dislike, проверь что данные сохранились и отображаются.

#### Шаг 2.6: Влияние feedback на leaderboard
**Файл:** `packages/server/src/services/ai/leaderboard.service.ts`

```
Модифицировать calculateCompositeScore():
- Добавить фактор user_satisfaction (10% веса):
  satisfaction = likes / (likes + dislikes)  (если > 5 голосов)
- Использовать correct_outcome из feedback для recalculate accuracy
- Добавить поле feedback_count в leaderboard вывод
```

#### Шаг 2.7: Тесты
**Файл:** `packages/server/src/__tests__/integration/ai-feedback.test.ts`

```
- Тест: submit feedback → сохраняется в БД
- Тест: дубликат голоса от того же юзера → ошибка
- Тест: correct_outcome обновляет ai_model_predictions
- Тест: stats корректно агрегируются
- Тест: leaderboard пересчитывается с учётом feedback
```

---

### ЗАДАЧА 3: Creative Decay Alerts
**Приоритет:** P1
**Оценка:** 2-3 дня
**Зависимости:** Задача 1 (Telegram) — желательно, но не блокирует

#### Шаг 3.1: Миграция — таблица creative snapshots
**Файл:** `packages/server/src/migrations/20260325_053_create_creative_snapshots.ts`

```sql
CREATE TABLE creative_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id),
  campaign_id UUID REFERENCES campaigns(id),
  ad_id UUID REFERENCES ads(id),
  snapshot_date DATE NOT NULL,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr NUMERIC(8,4),
  conversions INTEGER DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  cpc_micros BIGINT DEFAULT 0,
  headlines TEXT[],
  descriptions TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_creative_snapshots_ad ON creative_snapshots(ad_id, snapshot_date);
CREATE INDEX idx_creative_snapshots_campaign ON creative_snapshots(campaign_id, snapshot_date);
CREATE UNIQUE INDEX idx_creative_snapshots_unique ON creative_snapshots(ad_id, snapshot_date);
```

**СТОП-ТОЧКА:** Миграция чистая.

#### Шаг 3.2: Сервис creative decay detection
**Файл:** `packages/server/src/services/creative-decay.service.ts`

```
Методы:

- snapshotCreativePerformance():
  Запускается ежедневно. Для каждого активного ad:
  - Собрать impressions, clicks, ctr за последние 24ч
  - Сохранить snapshot

- detectDecay(campaignId?):
  Для каждого креатива с >= 7 дней данных:
  - Сравнить CTR последних 3 дней vs предыдущих 7 дней
  - Если падение > 15% → decay_detected
  - Если падение > 30% → critical_decay
  - Возврат: { ad_id, campaign_id, ctr_current, ctr_previous, decline_percent, severity }

- getDecayTrends(accountId):
  - Все креативы аккаунта с трендом CTR за 30 дней
  - Группировка по campaign

Параметры decay:
  DECAY_THRESHOLD_PERCENT = 15 (warning)
  CRITICAL_DECAY_PERCENT = 30 (alert)
  MIN_IMPRESSIONS = 100 (игнорировать если мало данных)
  LOOKBACK_DAYS = 7 (базовый период)
  COMPARE_DAYS = 3 (текущий период)
```

#### Шаг 3.3: Интеграция с collect pipeline
**Файл:** `packages/server/src/services/collect.service.ts`

```
В processPerformanceBatch():
- После upsert метрик кампании → вызвать snapshotCreativePerformance()
  (или делать это через cron, см. шаг 3.5)
```

#### Шаг 3.4: Handler + Route
**Файл:** `packages/server/src/handlers/analytics.handler.ts`
**Файл:** `packages/server/src/routes/analytics.ts`

```
Обновить существующий GET /api/v1/analytics/creative-decay:
- Вызывать creative-decay.service вместо текущей логики
- Добавить query params: ?account_id=...&campaign_id=...&threshold=15

POST /api/v1/analytics/creative-decay/scan
- Принудительный запуск сканирования (admin only)
- Возврат: { scanned, decayed, critical }
```

#### Шаг 3.5: Cron job
**Файл:** `packages/server/src/index.ts`

```
Добавить в автоматизацию:
- Creative Snapshot: каждые 6ч — snapshotCreativePerformance()
- Creative Decay Check: каждые 6ч (после snapshot) — detectDecay()
  → если decay найден:
    - Создать notification (severity: warning / critical)
    - Если Telegram enabled → отправить алерт
```

**Формат Telegram-алерта:**
```
⚠️ CREATIVE DECAY

Аккаунт: 123-456-7890
Кампания: {campaign_name}
Креатив: {ad_id}

📉 CTR упал на {decline}%
  Было: {ctr_previous}%
  Стало: {ctr_current}%

💡 Рекомендация: обновить креативы
```

**СТОП-ТОЧКА:** Проверь что decay детектится на тестовых данных.

#### Шаг 3.6: Frontend — decay dashboard
**Файл:** `packages/web/src/pages/analytics.tsx`

```
Добавить секцию "Creative Decay":
- Таблица: Кампания | Креатив | CTR (было) | CTR (стало) | Падение % | Severity
- Сортировка по severity (critical первые)
- Sparkline график CTR за 30 дней для каждого креатива
- Фильтр по аккаунту, кампании
- Кнопка "Сканировать сейчас" (admin)
```

#### Шаг 3.7: Тесты
```
- creative-decay.service.test.ts:
  - Тест: CTR падение 20% → warning
  - Тест: CTR падение 35% → critical
  - Тест: < 100 impressions → skip
  - Тест: < 7 дней данных → skip
  - Тест: стабильный CTR → no decay
```

---

### ЗАДАЧА 4: Смена пароля пользователем
**Приоритет:** P2
**Оценка:** 0.5 дня
**Зависимости:** нет

#### Шаг 4.1: Endpoint
**Файл:** `packages/server/src/routes/auth.ts`
**Файл:** `packages/server/src/handlers/auth.handler.ts`

```
PATCH /api/v1/auth/me/password
  Body: { current_password: string, new_password: string }
  - Проверить current_password
  - Валидация new_password (>= 8 символов)
  - Hash + update
  - Invalidate все refresh_tokens юзера
  Response: { message: "Password updated" }
```

#### Шаг 4.2: Frontend
**Файл:** `packages/web/src/pages/settings.tsx`

```
Добавить форму:
- Текущий пароль (input password)
- Новый пароль (input password)
- Подтверждение (input password)
- Кнопка "Сменить пароль"
- Валидация на клиенте: совпадение паролей, минимум 8 символов
```

**СТОП-ТОЧКА:** Смени пароль, разлогинься, залогинься с новым.

---

## PHASE 2.5: Средний приоритет

### ЗАДАЧА 5: Real CTS Integration
**Приоритет:** P2
**Оценка:** 2-3 дня
**Зависимости:** Доступ к CTS API

#### Шаг 5.1: Реальный CTS адаптер
**Файл:** `packages/server/src/services/cts-real.adapter.ts`

```
Заменить MockCTSAdapter:
- Реализовать CTSAdapter интерфейс с реальными HTTP-вызовами
- GET /api/sites → fetchSites()
- POST /api/events → pushEvent()
- GET /api/sites/:id/traffic → fetchTraffic()
- Auth: CTS_API_KEY в заголовке
- Retry: 3 попытки с backoff
- Timeout: 10s
```

#### Шаг 5.2: Env-переменные
```
CTS_API_URL=https://cts.example.com/api
CTS_API_KEY=...
CTS_SYNC_INTERVAL_HOURS=6
```

#### Шаг 5.3: Auto-sync cron
**Файл:** `packages/server/src/index.ts`

```
Если CTS_API_URL задан:
- Каждые CTS_SYNC_INTERVAL_HOURS: cts.service.syncSites()
- При детекции бана: cts.service.pushEvent('ban', ...)
```

**СТОП-ТОЧКА:** Синхронизация работает с реальным CTS.

---

### ЗАДАЧА 6: Методички → AI
**Приоритет:** P2
**Оценка:** 3-4 дня
**Зависимости:** Задача 2 (AI Feedback) — желательно

#### Шаг 6.1: Миграция — таблица best practices
**Файл:** `packages/server/src/migrations/20260326_054_create_best_practices.ts`

```sql
CREATE TABLE best_practices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
    -- 'campaign_setup', 'domain_selection', 'budget_strategy',
    -- 'creative_guidelines', 'ban_prevention', 'appeal_strategy'
  campaign_type TEXT,
    -- NULL = general, 'pmax', 'search', 'demand_gen', etc.
  offer_vertical TEXT,
    -- NULL = general, 'gambling', 'nutra', etc.
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_best_practices_category ON best_practices(category);
CREATE INDEX idx_best_practices_type ON best_practices(campaign_type);
CREATE INDEX idx_best_practices_vertical ON best_practices(offer_vertical);
```

#### Шаг 6.2: CRUD для методичек
**Файлы:** repository, handler, route (стандартный CRUD)

```
GET    /api/v1/best-practices?category=...&vertical=...&campaign_type=...
POST   /api/v1/best-practices (admin)
PATCH  /api/v1/best-practices/:id (admin)
DELETE /api/v1/best-practices/:id (admin)
```

#### Шаг 6.3: Интеграция с AI промптом
**Файл:** `packages/server/src/services/ai/prompts/account-analysis.prompt.ts`

```
Модифицировать промпт:
- Загрузить relevant best_practices по campaign_type + offer_vertical
- Добавить секцию в промпт:
  "Методичка команды для данного типа кампании: ..."
- AI должен сверять настройки аккаунта с best practices
- В ответе: отдельная секция "Соответствие методичке" с оценкой 0-100%
```

#### Шаг 6.4: Frontend — страница методичек
**Файл:** `packages/web/src/pages/best-practices.tsx`

```
- Список методичек с фильтрами (категория, вертикаль, тип кампании)
- Admin: кнопки создать/редактировать/удалить
- Markdown рендеринг контента
- В AI Analysis: показывать какие правила нарушены
```

**Файл:** `packages/web/src/components/layout.tsx` — добавить пункт "Методички" в навигацию

**СТОП-ТОЧКА:** Создай методичку, запусти AI анализ — проверь что AI учитывает правила.

---

### ЗАДАЧА 7: Advanced ML (XGBoost)
**Приоритет:** P3
**Оценка:** 5-7 дней
**Зависимости:** 200+ кейсов в базе

#### Шаг 7.1: Python ML сервис
**Файл:** `packages/ml/` — новый пакет

```
packages/ml/
├── requirements.txt    (scikit-learn, xgboost, fastapi, uvicorn, psycopg2)
├── Dockerfile
├── src/
│   ├── main.py         (FastAPI app)
│   ├── models/
│   │   ├── xgboost_predictor.py
│   │   └── feature_engineering.py
│   ├── api/
│   │   ├── train.py    (POST /train)
│   │   ├── predict.py  (POST /predict)
│   │   └── health.py   (GET /health)
│   └── db.py           (PostgreSQL connection)
```

#### Шаг 7.2: Feature engineering
```python
Расширить до 50+ фичей:
- Все 26 текущих из feature-extraction.service.ts
- Временные: hour_of_creation, day_of_week, days_since_last_ban_in_vertical
- Поведенческие: spend_acceleration, budget_change_count, domain_switch_count
- Сетевые: shared_proxy_ban_rate, shared_payment_ban_rate
- Текстовые: keyword_risk_score (TF-IDF на забаненных ключах)
```

#### Шаг 7.3: Интеграция с Node.js сервером
**Файл:** `packages/server/src/services/ml/ml-service-client.ts`

```
HTTP-клиент к Python ML сервису:
- POST /train → запуск обучения
- POST /predict → предсказание для аккаунта
- GET /health → проверка доступности
- Fallback на встроенный ban-predictor.ts если ML сервис недоступен
```

#### Шаг 7.4: Docker
**Файл:** `docker-compose.yml` — добавить ml сервис

```yaml
ml:
  build: ./packages/ml
  ports: ["8000:8000"]
  environment:
    DATABASE_URL: ...
  depends_on:
    postgres: { condition: service_healthy }
```

**СТОП-ТОЧКА:** ML сервис стартует, тренируется на данных из БД, выдаёт предсказания.

---

### ЗАДАЧА 8: Expert Rules Engine v2
**Приоритет:** P2
**Оценка:** 2-3 дня
**Зависимости:** нет

#### Шаг 8.1: Миграция — конфигурируемые правила
**Файл:** `packages/server/src/migrations/20260326_055_create_expert_rules.ts`

```sql
CREATE TABLE expert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT NOT NULL,
    -- 'bin', 'domain', 'account', 'geo', 'velocity', 'network'
  condition JSONB NOT NULL,
    -- { "field": "bin_ban_rate", "operator": ">", "value": 0.8 }
  severity TEXT NOT NULL DEFAULT 'warning',
  message_template TEXT NOT NULL,
    -- "BIN {bin} имеет {ban_rate}% бан рейт"
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### Шаг 8.2: Rules Engine v2
**Файл:** `packages/server/src/services/rules-engine-v2.ts`

```
- Загрузка правил из БД (кеш 5 мин)
- Поддержка операторов: >, <, >=, <=, ==, !=, in, not_in, contains, regex
- Поддержка составных условий: AND, OR
- Поддержка шаблонов сообщений с переменными
- Обратная совместимость: хардкод правила из rules-engine.ts как default seed
```

#### Шаг 8.3: Admin UI — редактор правил
**Файл:** `packages/web/src/pages/rules-editor.tsx`

```
- Список правил с toggle (active/inactive)
- Форма: name, category, condition builder, severity, message template
- Condition builder: field (dropdown) + operator (dropdown) + value (input)
- Preview: "Если BIN ban rate > 80% → BLOCK: НЕ ИСПОЛЬЗОВАТЬ этот BIN"
- Drag-n-drop приоритет
```

**СТОП-ТОЧКА:** Создай правило через UI, запусти assessment — правило применяется.

---

## PHASE 3: Долгосрочные задачи

### ЗАДАЧА 9: Facebook / TikTok Ads Extension
**Оценка:** 7-10 дней
**Зависимости:** Phase 2 завершена

```
Что нужно:
1. packages/extension/src/interceptors/ — добавить facebook-injector.ts, tiktok-injector.ts
2. manifest.json — добавить host_permissions для facebook.com/ads, business.tiktok.com
3. Новые парсеры на сервере для форматов Facebook/TikTok API
4. Абстрагировать collect pipeline для multi-platform
5. Dashboard: фильтр по платформе (Google/Facebook/TikTok)
6. Новые миграции: platform поле на accounts, campaigns
```

### ЗАДАЧА 10: Keitaro / Binom интеграция
**Оценка:** 3-5 дней

```
1. Новый сервис: tracker-integration.service.ts
2. Поддержка API Keitaro и Binom
3. Импорт: конверсии, ROI, click data
4. Связка с аккаунтами по campaign_id / sub_id
5. Dashboard: ROI колонка в таблице кампаний
```

### ЗАДАЧА 11: Авторотация доменов
**Оценка:** 5-7 дней

```
1. Таблица domain_pool: пул доменов по вертикалям
2. Сервис: domain-rotation.service.ts
   - Мониторинг risk score доменов
   - Когда risk > threshold → предложить замену
   - Auto-mode: автоматическая ротация через DNS API
3. Интеграция с Cloudflare API для смены A-записей
4. Telegram алерт при ротации
```

### ЗАДАЧА 12: A/B тесты антифрода
**Оценка:** 7-10 дней

```
1. Таблица experiments: описание эксперимента
2. Таблица experiment_groups: контрольная vs тестовая группа
3. Сервис: experiment.service.ts
   - Распределение аккаунтов по группам
   - Трекинг метрик: ban rate, lifetime, spend
   - Статистическая значимость (chi-squared test)
4. Dashboard: страница экспериментов с графиками
```

---

## Порядок выполнения (рекомендуемый)

```
Неделя 1:
  ├── Задача 1: Telegram Bot (2-3 дня)         ← CRITICAL
  └── Задача 4: Смена пароля (0.5 дня)         ← Quick win

Неделя 2:
  └── Задача 2: AI Feedback Loop (3-4 дня)     ← P1

Неделя 3:
  ├── Задача 3: Creative Decay Alerts (2-3 дня) ← P1
  └── Задача 8: Rules Engine v2 (начало)        ← P2

Неделя 4:
  ├── Задача 8: Rules Engine v2 (завершение)
  └── Задача 5: Real CTS Integration (2-3 дня)  ← P2

Неделя 5-6:
  └── Задача 6: Методички → AI (3-4 дня)        ← P2

Неделя 7-8:
  └── Задача 7: Advanced ML (5-7 дней)          ← P3

Phase 3 (после накопления данных):
  ├── Задача 9: Facebook/TikTok
  ├── Задача 10: Keitaro/Binom
  ├── Задача 11: Авторотация доменов
  └── Задача 12: A/B тесты
```

---

## Чеклист перед началом работы

- [ ] Получить ветку в GitHub
- [ ] `git clone && npm install`
- [ ] Настроить `.env` (DATABASE_URL, API_KEY, AI ключи)
- [ ] `docker-compose up` → PostgreSQL работает
- [ ] `npm run migrate -w packages/server` → 50 миграций
- [ ] `npm run dev -w packages/server` → сервер на :3000
- [ ] `npm run dev -w packages/web` → дашборд на :5173
- [ ] Проверить `GET /api/v1/health` → 200 OK
- [ ] Создать Telegram бота через @BotFather
- [ ] Получить Chat ID через @userinfobot
- [ ] Начать с Задачи 1 (Telegram Bot)

---

## Конвенции (напоминание из CLAUDE.md)

- **Файлы:** kebab-case (`creative-decay.service.ts`)
- **Миграции:** `YYYYMMDD_NNN_description.ts` (следующая: `20260325_051_...`)
- **Типы:** PascalCase, export из `packages/shared`
- **Константы:** SCREAMING_SNAKE_CASE
- **Тесты:** рядом с файлом или в `__tests__/`
- **No `any`** — использовать `unknown` + narrow
- **Branded types** для ID
- **API prefix:** `/api/v1/`
- **Error format:** `{ error: string, code: string, details?: unknown }`
