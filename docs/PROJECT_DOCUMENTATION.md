# CTS Anti-Fraud — Полная документация проекта

> Версия: 1.0.0
> Обновлено: 2026-04-09
> Миграции: 68 (последняя: 068_create_expert_rules)
> Dashboard страниц: 18

---

## 1. Обзор проекта

**CTS Anti-Fraud Analytics** — внутренняя платформа для мониторинга Google Ads аккаунтов, прогнозирования банов и антифрод-аналитики. Разработана для команды медиабаинга, работающей через антидетект-браузеры.

### Архитектура

```
Chrome Extension (антидетект-браузер)
    ↓ перехватывает Google Ads XHR/fetch ответы
    ↓ POST /api/v1/collect
Fastify Backend (Node.js)
    ↓ парсинг → upsert → auto-scoring
PostgreSQL (хранение данных)
    ↓
React Dashboard (визуализация)
```

**Ключевой принцип:** НЕ используется Google Ads API — данные собираются через перехват браузерных запросов, чтобы не связывать аккаунты.

### Технологии

| Компонент | Технология |
|-----------|-----------|
| Бэкенд | Fastify + TypeScript strict |
| Фронтенд | React 18 + Tailwind CSS + Vite |
| База данных | PostgreSQL 15+ |
| Миграции | Knex.js |
| Расширение | Chrome MV3, vanilla TypeScript |
| AI | Claude Sonnet / GPT-4o / Gemini 2.5 Flash |
| ML | Logistic Regression (встроенный) |
| Контейнеры | Docker + docker-compose |
| CI/CD | GitHub Actions (4-job pipeline) |

---

## 2. Структура монорепо

```
cts-antifraud/
├── packages/
│   ├── server/          # Fastify API сервер
│   │   ├── src/
│   │   │   ├── config/          # Конфигурация (env, database, knexfile)
│   │   │   ├── handlers/        # Обработчики запросов
│   │   │   ├── migrations/      # 68 Knex миграций
│   │   │   ├── plugins/         # Fastify плагины (auth, swagger)
│   │   │   ├── repositories/    # SQL запросы (raw pg)
│   │   │   ├── routes/          # 19 файлов маршрутов
│   │   │   ├── services/        # Бизнес-логика
│   │   │   │   ├── ai/          # AI анализ, адаптеры, чат
│   │   │   │   └── ml/          # ML предиктор, фичи
│   │   │   ├── scripts/         # Утилиты (seed, etc)
│   │   │   └── utils/           # Хелперы
│   │   └── __tests__/           # Тесты
│   │
│   ├── web/             # React dashboard
│   │   └── src/
│   │       ├── components/      # UI компоненты
│   │       ├── contexts/        # Auth context
│   │       └── pages/           # 18 страниц
│   │
│   ├── extension/       # Chrome Extension MV3
│   │   └── src/
│   │       ├── background/      # Service worker
│   │       ├── content/         # Content scripts
│   │       ├── interceptors/    # Fetch/XHR перехват
│   │       ├── collectors/      # Извлечение данных
│   │       └── transport/       # Батчинг, retry, очередь
│   │
│   └── shared/          # Общие типы, константы, enums
│
├── docs/                # Документация
├── docker-compose.yml   # Docker окружение
└── CLAUDE.md            # Инструкции для разработки
```

---

## 3. Аутентификация и авторизация

### Методы аутентификации

| Метод | Использование | Заголовок |
|-------|--------------|-----------|
| JWT Bearer | Dashboard (фронтенд) | `Authorization: Bearer <token>` |
| API Key | Chrome Extension | `X-API-Key: <key>` |

### Роли

| Роль | Доступ |
|------|--------|
| `admin` | Все аккаунты, настройки, управление пользователями, аудит |
| `buyer` | Только свои аккаунты (привязанные через user assignment) |

### Эндпоинты авторизации

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/auth/login` | Логин (email + password → JWT) |
| POST | `/auth/refresh` | Обновление access token |
| POST | `/auth/logout` | Отзыв refresh token |
| GET | `/auth/me` | Текущий пользователь |
| PATCH | `/auth/me/password` | Смена пароля |

---

## 4. API Reference

Полная интерактивная документация: **`/docs`** (Swagger UI)

### Health

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/health` | Нет | Статус сервера, БД, AI моделей |

### Accounts

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/accounts` | JWT/Key | Список аккаунтов (пагинация, фильтры по статусу, тегу) |
| GET | `/accounts/:id` | JWT/Key | Детали аккаунта (кампании, баны, объявления, ключевые слова, биллинг) |
| PATCH | `/accounts/:id` | JWT/Key | Обновление аккаунта |
| GET | `/accounts/:id/risk-summary` | JWT/Key | Summary рисков аккаунта |

### Bans

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/bans` | JWT/Key | Список банов (пагинация, from_date/to_date) |
| GET | `/bans/:id` | JWT/Key | Детали бана |
| POST | `/bans` | JWT/Key | Ручная запись бана |
| POST | `/bans/:id/post-mortem` | JWT/Key | Генерация post-mortem анализа |
| POST | `/bans/post-mortem/all` | Admin | Генерация post-mortem для всех ожидающих |

### Domains

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/domains` | JWT/Key | Список доменов с enrichment данными |
| GET | `/domains/:domain` | JWT/Key | Детали домена (WHOIS, SSL, content analysis) |
| POST | `/domains/:domain/analyze` | JWT/Key | Запуск анализа контента домена |
| POST | `/domains/enrich` | Admin | Ручной запуск enrichment цикла |

### Analytics

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/analytics/overview` | JWT/Key | Общая статистика: lifetime, verticals, ban rate |
| GET | `/analytics/ban-timing` | JWT/Key | Ban Timing Heatmap (7x24 матрица) |
| GET | `/analytics/spend-velocity` | JWT/Key | Скорость расхода по аккаунтам |
| GET | `/analytics/ban-chain` | JWT/Key | Связи между забаненными аккаунтами |
| GET | `/analytics/consumable-scoring` | JWT/Key | Scoring расходных материалов (BIN, прокси) |
| GET | `/analytics/creative-decay` | JWT/Key | Decay креативов |
| GET | `/analytics/creative-decay/trends/:id` | JWT/Key | Тренды decay по аккаунту |
| POST | `/analytics/creative-decay/scan` | Admin | Ручной scan decay |
| GET | `/analytics/competitive-intelligence` | JWT/Key | Конкурентная аналитика |
| GET | `/analytics/competitive-intelligence/:id` | JWT/Key | Конкуренты по аккаунту |
| GET | `/analytics/quality-distribution/:id` | JWT/Key | Распределение Quality Score |
| GET | `/analytics/low-quality-keywords/:id` | JWT/Key | Ключевые слова с низким QS |
| GET | `/analytics/quality-history/:id` | JWT/Key | История Quality Score |
| GET | `/analytics/parsed-data` | Admin | Статистика парсинга |
| GET | `/analytics/mv-freshness` | JWT/Key | Дата последнего обновления materialized views |

### Assessment

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/assessment/:accountId` | JWT/Key | Запуск оценки рисков аккаунта (14 правил, 5 факторов) |

### AI

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/ai/analyze/:accountId` | JWT/Key | AI анализ аккаунта (multi-model) |
| POST | `/ai/analyze-ban/:banLogId` | JWT/Key | AI анализ бана |
| POST | `/ai/compare` | JWT/Key | Сравнение аккаунтов AI |
| POST | `/ai/compare-models/:accountId` | JWT/Key | Сравнение моделей AI |
| POST | `/ai/chat/:accountId` | JWT/Key | AI чат по аккаунту |
| GET | `/ai/history/:accountId` | JWT/Key | История AI анализов |
| GET | `/ai/leaderboard` | JWT/Key | Лидерборд AI моделей |
| GET | `/ai/leaderboard/history` | JWT/Key | История лидерборда |
| GET | `/ai/models` | JWT/Key | Список настроенных моделей |
| POST | `/ai/audit-domain/:domainId` | JWT/Key | AI аудит домена |
| POST | `/ai/rotation-strategy/:banLogId` | JWT/Key | AI стратегия ротации |
| POST | `/ai/appeal-strategy/:banLogId` | JWT/Key | AI стратегия апелляции |
| POST | `/ai/farm-analysis` | JWT/Key | AI анализ фарма (2+ аккаунтов) |
| POST | `/ai/predictions/:id/feedback` | JWT/Key | Фидбек на AI предсказание |
| GET | `/ai/predictions/:id/feedback` | JWT/Key | Получить фидбек |
| GET | `/ai/feedback/stats` | JWT/Key | Статистика фидбека |

### ML

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/ml/status` | JWT/Key | Статус ML модели |
| POST | `/ml/predict/:accountId` | JWT/Key | Предсказание бана для аккаунта |
| POST | `/ml/retrain` | Admin | Ручной retrain модели |
| GET | `/ml/features/:accountId` | JWT/Key | Feature vector аккаунта |
| GET | `/ml/feature-importance` | JWT/Key | Важность фичей модели |

### Notifications

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/notifications` | JWT/Key | Список уведомлений (пагинация, фильтры) |
| GET | `/notifications/unread-count` | JWT/Key | Количество непрочитанных |
| POST | `/notifications/:id/read` | JWT/Key | Отметить как прочитанное |
| POST | `/notifications/read-all` | JWT/Key | Отметить все как прочитанные |
| GET | `/notifications/stream` | JWT (query) | SSE стрим real-time уведомлений |
| GET | `/notifications/settings` | JWT/Key | Настройки уведомлений |
| PATCH | `/notifications/settings/:type` | JWT/Key | Обновить настройку |
| GET | `/notifications/history` | JWT/Key | История уведомлений |

### Tags

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/tags` | JWT/Key | Список тегов |
| POST | `/tags` | JWT/Key | Создать тег |
| PATCH | `/tags/:id` | JWT/Key | Обновить тег |
| DELETE | `/tags/:id` | JWT/Key | Удалить тег |
| POST | `/accounts/:id/tags/:tagId` | JWT/Key | Назначить тег аккаунту |
| DELETE | `/accounts/:id/tags/:tagId` | JWT/Key | Снять тег с аккаунта |
| POST | `/tags/bulk-assign` | JWT/Key | Bulk назначение тега |

### Search

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/search?q=...` | JWT/Key | Глобальный поиск (accounts, domains, bans) |

### Collect

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| POST | `/collect` | API Key | Приём данных от Chrome Extension |

### Stats

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/stats/overview` | JWT/Key | Общие метрики |
| GET | `/stats/activity` | JWT/Key | Лента активности |
| GET | `/stats/buyer-performance` | Admin | Перформанс байеров |
| GET | `/stats/buyer/:id` | Admin | Детали байера |
| GET | `/stats/prediction-summary` | JWT/Key | Summary предсказаний |

### Admin

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/admin/users` | Admin | Список пользователей |
| POST | `/admin/users` | Admin | Создать пользователя |
| GET | `/admin/users/:id` | Admin | Детали пользователя |
| PATCH | `/admin/users/:id` | Admin | Обновить пользователя |
| DELETE | `/admin/users/:id` | Admin | Удалить пользователя |
| POST | `/admin/users/:id/generate-key` | Admin | Генерация API ключа |
| POST | `/admin/users/:id/reset-password` | Admin | Сброс пароля |
| GET | `/admin/notification-settings` | Admin | Глобальные настройки нотификаций |
| PATCH | `/admin/notification-settings/:type` | Admin | Обновить глобальную настройку |
| POST | `/admin/notification-settings/test` | Admin | Тест уведомления |
| GET | `/admin/audit` | Admin | Audit log |
| GET | `/admin/rules` | Admin | Список expert rules |
| POST | `/admin/rules` | Admin | Создать правило |
| PATCH | `/admin/rules/:id` | Admin | Обновить правило |
| DELETE | `/admin/rules/:id` | Admin | Удалить правило |
| PATCH | `/admin/rules/:id/toggle` | Admin | Вкл/выкл правило |

### CTS Integration

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/cts/sites` | JWT/Key | Список CTS сайтов |
| POST | `/cts/sites` | JWT/Key | Создать сайт |
| PATCH | `/cts/sites/:id` | JWT/Key | Обновить сайт |
| DELETE | `/cts/sites/:id` | JWT/Key | Удалить сайт |
| GET | `/cts/sites/:id/traffic` | JWT/Key | Трафик CTS сайта |
| POST | `/cts/sync` | Admin | Синхронизация с CTS |

### Telegram

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/telegram/bot-info` | JWT/Key | Информация о боте |
| GET | `/telegram/connect-status` | JWT/Key | Статус подключения |
| POST | `/telegram/connect` | JWT/Key | Подключить Telegram |
| POST | `/telegram/disconnect` | JWT/Key | Отключить Telegram |

### Best Practices

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/best-practices` | JWT/Key | Список методичек |
| POST | `/best-practices` | JWT/Key | Создать методичку |
| PATCH | `/best-practices/:id` | JWT/Key | Обновить |
| DELETE | `/best-practices/:id` | JWT/Key | Удалить |

### Extension

| Метод | Путь | Auth | Описание |
|-------|------|------|----------|
| GET | `/extension/download` | JWT/Key | Скачать CRX расширение |
| GET | `/extension/download/:userId` | Admin | Скачать CRX для конкретного юзера |

---

## 5. Dashboard — Страницы

### Общедоступные (buyer + admin)

| # | Роут | Страница | Описание |
|---|------|----------|----------|
| 1 | `/` | Dashboard | Обзор: метрики, активность, тренды, ML status |
| 2 | `/accounts` | Accounts | Список аккаунтов: фильтры, теги, bulk операции, CSV |
| 3 | `/accounts/:id` | Account Detail | Полная карточка: кампании, баны, объявления, ключевые слова, биллинг, AI анализ, AI чат, competitive intel, QS, timeline, связи |
| 4 | `/bans` | Bans | Журнал банов: таблица, фильтры по дате, post-mortem |
| 5 | `/bans/new` | New Ban | Форма записи бана вручную |
| 6 | `/bans/:id` | Ban Detail | Детали бана: причина, анализ, AI стратегия |
| 7 | `/domains` | Domains | Анализ доменов: enrichment, scoring, content |
| 8 | `/assessment` | Assessment | Оценка рисков аккаунтов (запуск assessment) |
| 9 | `/analytics` | Analytics | Heatmap, spend velocity, ban chain, creative decay, consumables |
| 10 | `/ai-analysis` | AI Analysis | AI анализ: multi-model, leaderboard, history |
| 11 | `/best-practices` | Best Practices | Методички команды: CRUD |
| 12 | `/notifications` | Notifications | Inbox уведомлений |
| 13 | `/cts` | CTS Integration | Интеграция с CTS трекером |
| 14 | `/settings` | Settings | Настройки подключения, пароль |

### Только admin

| # | Роут | Страница | Описание |
|---|------|----------|----------|
| 15 | `/users` | Users | Управление пользователями (CRUD, API ключи) |
| 16 | `/admin/notifications` | Admin Notifications | Глобальные настройки уведомлений, Telegram |
| 17 | `/admin/buyers/:id` | Buyer Detail | Детали байера: перформанс, аудит |
| 18 | `/admin/rules` | Rules Editor | Редактор expert rules |

### Глобальные компоненты

- **Command Palette** (Ctrl+K / Cmd+K) — глобальный поиск с операторами
- **Toast Notifications** — real-time уведомления через SSE
- **Sidebar** — навигация с группировкой по ролям
- **AI Chat** — floating panel на странице аккаунта

---

## 6. Функциональные модули

### 6.1 Сбор данных (Chrome Extension)

- Перехватывает XHR/fetch ответы на `ads.google.com`
- 24 RPC парсера для Google Ads эндпоинтов
- Буферизация: отправка каждые 30с или при закрытии вкладки
- Очередь в `chrome.storage.local` при недоступности сервера
- Retry с exponential backoff
- Fingerprint-free: zero shared identifiers

### 6.2 Assessment Engine

- **5 категорий факторов:** аккаунт, домен, финансы, сеть, поведение
- **14 правил** (расширяемые через admin UI)
- Expert Rules: конфигурируемые правила из БД
- Операторы: `>`, `<`, `>=`, `<=`, `==`, `!=`, `in`, `not_in`, `contains`, `regex`
- Severity levels: `info`, `warning`, `critical`, `block`

### 6.3 AI Analysis

**Модели:**
- Claude Sonnet 4 (Anthropic)
- GPT-4o (OpenAI)
- Gemini 2.5 Flash (Google)

**Возможности:**
- Анализ аккаунта (multi-model comparison)
- Анализ бана (post-mortem)
- Стратегия ротации после бана
- Стратегия апелляции
- Аудит домена
- Анализ фарма (2+ аккаунтов)
- **AI Chat** — диалоговый интерфейс с полным контекстом аккаунта

**Aggregation strategies:**
- `majority_vote` — голосование 2+ моделей
- `best_model` — лучшая модель по leaderboard

**Feedback loop:** like/dislike на предсказания, влияние на leaderboard.

### 6.4 ML Ban Predictor

- **Модель:** Logistic Regression (встроенная, без Python)
- **26 фичей:** возраст, violations, spend, velocity, BIN rate, QS, network connections и др.
- **Explainability:** top factors с direction (positive/negative)
- **Auto-retrain:** еженедельно + каждые 50 банов + ручной запуск
- **Batch prediction:** scoring всех аккаунтов каждые 6ч

### 6.5 Domain Analysis

- **14 внешних API:** crt.sh, WHOIS/RDAP, Shodan, DNS, Spamhaus, SURBL, URIBL, CommonCrawl, OpenPhish, AbuseIPDB, URLhaus, SerpAPI, Safe Browsing, VirusTotal
- **Content Analysis:** keyword scanning, structure risk, compliance scoring
- Hard/soft risk scoring architecture
- Cloudflare challenge detection

### 6.6 Notification System

- **Channels:** in-app inbox, SSE real-time, Telegram bot
- **Types:** ban alerts, risk alerts, creative decay, system
- **SSE:** `GET /notifications/stream` с auto-reconnect
- **Telegram Bot:** алерты банов, creative decay, команды (/status, /help)
- **Cleanup:** автоудаление уведомлений старше 30 дней

### 6.7 Analytics

- **Ban Timing Heatmap:** 7x24 матрица (день недели x час) — визуализация паттернов банов
- **Spend Velocity:** анализ скорости расхода по аккаунтам
- **Ban Chain:** граф связей между забаненными аккаунтами
- **Consumable Scoring:** оценка BIN, прокси, доменов
- **Creative Decay:** мониторинг деградации креативов
- **Quality Score:** распределение, низкие ключи, тренды
- **Competitive Intelligence:** анализ конкурентов

### 6.8 Автоматизации (Cron)

| Задача | Интервал | Описание |
|--------|----------|----------|
| Domain enrichment | 6ч | Обогащение доменов через внешние API |
| Auto-ban detection | При старте | Сканирование suspended аккаунтов |
| Materialized views | 1ч | Обновление analytics views |
| Batch prediction | 6ч | ML scoring всех аккаунтов |
| Notification cleanup | 24ч | Удаление уведомлений >30 дней |
| Leaderboard scoring | 24ч | Scoring выживших аккаунтов |
| Creative snapshot + scan | 6ч | Snapshot и scan decay |
| ML retrain | 7 дней | Автоматическое переобучение |

---

## 7. База данных

### Ключевые таблицы

| Таблица | Описание |
|---------|----------|
| `accounts` | Google Ads аккаунты |
| `campaigns` | Кампании |
| `ads` | Объявления |
| `keywords` | Ключевые слова |
| `billing` | Биллинг данные |
| `ban_logs` | Журнал банов |
| `domains` | Домены |
| `domain_content_analysis` | Результаты анализа контента |
| `notification_details` | Уведомления Google Ads |
| `users` | Пользователи системы |
| `tags` / `account_tags` | Теги аккаунтов (many-to-many) |
| `assessment_results` | Результаты оценки рисков |
| `ai_predictions` | AI предсказания |
| `ai_feedback` | Фидбек на предсказания |
| `ml_model_versions` | Версии ML модели |
| `ml_training_data` | Обучающие данные |
| `expert_rules` | Конфигурируемые правила |
| `best_practices` | Методички команды |
| `audit_log` | Аудит лог действий |
| `creative_snapshots` | Снэпшоты креативов |
| `cts_sites` | CTS сайты |

### Materialized Views

| View | Обновление | Описание |
|------|-----------|----------|
| `mv_ban_timing_heatmap` | 1ч | Агрегация банов по дню/часу |
| `mv_account_risk_summary` | 1ч | Summary рисков по аккаунтам |
| `mv_spend_velocity` | 1ч | Скорость расхода |
| `mv_consumable_scoring` | 1ч | Scoring расходных материалов |

---

## 8. Chrome Extension

### Перехват данных

- **Host permissions:** `ads.google.com`
- **Методы перехвата:** XHR + fetch injection
- **Буфер:** batch отправка каждые 30с
- **Очередь:** `chrome.storage.local` для offline/retry
- **Retry:** exponential backoff

### 24 RPC парсера

Парсят ответы Google Ads для:
- Аккаунты (статус, верификация, настройки)
- Кампании (бюджет, статус, тип, ставки)
- Объявления (текст, URL, статус)
- Ключевые слова (QS, CPC, статус)
- Биллинг (баланс, метод оплаты)
- Уведомления (policy violations, alerts)

---

## 9. Переменные окружения

### Server (.env)

```env
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/cts_antifraud
API_KEY=<shared-secret-for-extension>
JWT_SECRET=<jwt-signing-key>
ADMIN_PASSWORD=<admin-password>

# Optional
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# AI (минимум один для AI функций)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AI...

# Telegram (для бот-алертов)
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<default-chat-id>
TELEGRAM_ADMIN_CHAT_ID=<admin-chat-id>
TELEGRAM_ENABLED=true

# Dashboard
DASHBOARD_URL=http://localhost:5173

# ML Service (опционально, для XGBoost)
ML_SERVICE_URL=http://localhost:8000
```

### Web (.env)

```env
VITE_API_URL=http://localhost:3000
VITE_API_KEY=<api-key>
```

---

## 10. Swagger / OpenAPI

Интерактивная документация API доступна по адресу:

```
http://localhost:3000/docs
```

- Автоматическое tagging по URL prefix
- Все endpoints с описанием
- Try-it-out для тестирования
- Auth через Bearer JWT или API Key

---

## 11. Развёртывание

### Docker

```bash
docker-compose up -d
```

Сервисы:
- `postgres` — PostgreSQL 15
- `server` — Fastify API (порт 3000)
- `web` — React dashboard (порт 5173, dev) / статика через server (production)

### Production

```bash
npm run build -w packages/server
npm run build -w packages/web
npm run build -w packages/extension
NODE_ENV=production node packages/server/dist/index.js
```

### CI/CD (GitHub Actions)

4-job pipeline:
1. **Lint** — ESLint
2. **TypeCheck** — TypeScript strict
3. **Test** — Unit + Integration tests
4. **Build** — Компиляция всех пакетов

---

## 12. AI Chat — Новая функция

### Описание

Диалоговый AI-ассистент на странице аккаунта. Байер может открыть любой аккаунт и задать вопросы AI, который имеет полный контекст:

- Все метрики аккаунта (возраст, расход, QS, violations)
- Кампании (статус, бюджет, расход, CTR)
- Баны (причины, даты, типы)
- Домены
- Уведомления (policy violations, alerts)
- ML прогноз (вероятность бана, факторы)
- Assessment результат

### Использование

1. Откройте страницу аккаунта (`/accounts/:id`)
2. Нажмите кнопку "AI Chat" в правом нижнем углу
3. Задайте вопрос или выберите из предложенных

### Примеры вопросов

- "Какие основные риски у этого аккаунта?"
- "Стоит ли менять домен?"
- "Почему упал Quality Score?"
- "Как продлить lifetime аккаунта?"
- "Какие кампании стоит поставить на паузу?"

### API

```
POST /api/v1/ai/chat/:accountId
Body: { "messages": [{ "role": "user", "content": "..." }] }
Response: { "reply": "...", "model": "...", "tokens": N, "latencyMs": N }
```

---

## 13. Проверка корректности (Audit)

### Ban Timing Heatmap — Проверен

- **DOW mapping:** PostgreSQL DOW (0=Sun) корректно преобразуется в Mon-first (0=Mon) формат
- **Sparse data:** матрица 7x24 инициализируется нулями, отсутствующие комбинации обрабатываются
- **MV/Direct query:** Admin использует materialized view (cached), buyer — прямой запрос (filtered)
- **Frontend:** корректно рендерит heatmap с color intensity, tooltip, legend

### Assessment Engine — Проверен

- 14 правил покрывают все категории рисков
- Expert Rules из БД дополняют базовые правила
- Корректный расчёт severity и scoring

### AI Analysis — Проверен

- Multi-model comparison работает корректно
- Fallback на single model при недоступности остальных
- Feedback loop влияет на leaderboard
- Новый AI Chat интегрирован с полным контекстом

### ML Predictor — Проверен

- 26 фичей извлекаются корректно
- Auto-retrain: weekly + event-based (50 bans)
- Feature importance calculation работает

---

## 14. Статус реализации

| Модуль | Готовность | Комментарий |
|--------|-----------|-------------|
| DB Schema (68 миграций) | 100% | Полная схема, MV, индексы |
| Chrome Extension | 100% | Перехват, очередь, retry, popup |
| Collect Pipeline | 100% | Raw → parse → upsert → auto-score |
| 24 RPC парсера | 95% | Все основные endpoints |
| Assessment + Rules Engine | 100% | 5 факторов, 14 правил, admin UI |
| Auto-Ban Detection | 100% | Автодетекция, post-mortem |
| AI Analysis (3 модели) | 100% | Claude/GPT/Gemini, comparison |
| AI Chat | 100% | Диалоговый интерфейс по аккаунту |
| ML Ban Predictor | 100% | Logistic regression, 26 фичей |
| Domain Enrichment | 100% | 14 внешних API |
| Auth (JWT + API Key) | 100% | Роли, refresh tokens |
| Notifications (SSE + Telegram) | 100% | Real-time, inbox, bot |
| Dashboard (18 страниц) | 100% | Все страницы |
| Tags & Bulk Operations | 100% | Теги, фильтры, bulk actions |
| Audit Log | 100% | Действия, фильтры, admin UI |
| Swagger/OpenAPI | 100% | /docs, auto-tagging |
| CI/CD + Docker | 100% | GitHub Actions, 4-job pipeline |
