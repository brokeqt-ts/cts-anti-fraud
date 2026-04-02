# CTS Anti-Fraud — Реализованные задачи

> Дата составления: 2026-03-24
> Обновлено: 2026-04-01
> Статус: Phase 1 + Phase 2 + Phase 2.5 + UX P1/P2 завершены

---

## Статус компонентов

| Компонент | Готовность | Комментарий |
|-----------|-----------|-------------|
| DB Schema (54 миграции) | 100% | Полная схема, materialized views, индексы |
| Chrome Extension | 100% | Перехват, очередь, retry, fingerprint, popup |
| Collect Pipeline | 100% | Raw storage → парсинг → upsert → auto-scoring |
| 24 RPC парсера | 95% | Все основные endpoint'ы Google Ads |
| Assessment + Rules Engine | 100% | 5 факторов, 14 правил, UI готов |
| Auto-Ban Detection | 100% | Автодетекция, post-mortem, уведомления |
| AI Analysis (Claude/GPT/Gemini) | 95% | Адаптеры, промпты, сравнение моделей |
| ML Ban Predictor | 100% | Logistic regression, 26 фичей, explainability |
| Leaderboard | 100% | Composite scoring, period filtering |
| Notification System | 100% | Inbox + admin panel + Telegram |
| Domain Enrichment | 100% | 14 external APIs, WHOIS/RDAP, hard/soft scoring |
| Auth (JWT + API Key) | 100% | Роли, refresh tokens, extension download |
| CI/CD + Docker | 100% | GitHub Actions, 4-job pipeline |
| Dashboard (16 страниц) | 100% | Все страницы реализованы |
| UX-6 Account Tags | 100% | Теги, конструктор, фильтр, assign/unassign |
| Telegram Bot | 100% | Алерты банов, creative decay, команды |
| AI Feedback Loop | 100% | Like/dislike, corrections, leaderboard влияние |
| Creative Decay Alerts | 100% | Снэпшоты, cron сканирование, Telegram |
| Смена пароля пользователем | 100% | PATCH /auth/me/password + UI с подтверждением |
| Real CTS Integration | 100% | HttpCTSAdapter + MockCTSAdapter + factory |

---

## PHASE 1: Выполнено

- DB Schema + Chrome Extension MVP + Collect endpoint
- Полная схема базы данных (5 уровней данных + consumables + predictions)
- Chrome Extension (перехват, очередь, retry, fingerprint, popup)
- POST /api/v1/collect + GET /api/v1/health

## PHASE 2: Выполнено

### ЗАДАЧА 1: Telegram Bot ✅
- `TelegramBotService` — sendMessage, sendBanAlert, sendRiskAlert, sendCreativeDecayAlert
- Retry с exponential backoff, rate limiting
- Интеграция с auto-ban-detector и notification.service
- Миграции 051 (telegram в notification_settings), 052 (telegram_chat_id в users)
- Admin UI — toggle Telegram, test кнопка

### ЗАДАЧА 2: AI Feedback Loop ✅
- Миграция 053 — таблица ai_feedback
- Repository, Service, Handler, Routes
- POST /ai/predictions/:id/feedback, GET /ai/feedback/stats
- Frontend — кнопки 👍/👎 в AI Analysis, счётчики
- Влияние на leaderboard (фактор user_satisfaction 10%)

### ЗАДАЧА 3: Creative Decay Alerts ✅
- Миграция 054 — таблица creative_snapshots
- `CreativeDecayService` — snapshotCreativePerformance, detectDecay, getDecayTrends
- Cron каждые 6ч — snapshot + scan + Telegram алерт
- POST /analytics/creative-decay/scan (admin)
- Frontend — таблица decay в Analytics, кнопка "Сканировать"

### ЗАДАЧА 4: Смена пароля пользователем ✅
- PATCH /api/v1/auth/me/password
- Frontend — форма с текущим паролем, новым и подтверждением
- Автосинхронизация ADMIN_PASSWORD в dev (FORCE_ADMIN_PASSWORD_RESET для prod)

### ЗАДАЧА 5: Real CTS Integration ✅
- `HttpCTSAdapter` — fetchSites, pushEvent, fetchTraffic с retry и timeout
- `MockCTSAdapter` — для development без реального CTS
- `createCTSAdapter()` — фабрика по CTS_API_URL + CTS_API_KEY env vars
- Auto-sync cron

---

## PHASE 2.5: Выполнено

### ЗАДАЧА 1: Методички → AI ✅
- Миграция 055 — таблица best_practices (category, offer_vertical, title, content, priority)
- CRUD: GET/POST/PATCH/DELETE /api/v1/best-practices
- Фильтры по категории и вертикали
- Frontend — страница best-practices.tsx (список, создание, редактирование, удаление)
- Интеграция с AI промптом — загрузка relevant best practices по вертикали
- 6 категорий: ban_prevention, domain_selection, budget_strategy, creative_guidelines, campaign_setup, appeal_strategy
- Поле campaign_type удалено (не использовалось командой)
- Кнопки CSV удалены из users и best-practices страниц

### Domain Analyzer improvements (2026-03-31) ✅
- 14 external APIs: crt.sh, WHOIS/RDAP, Shodan, DNS, Spamhaus/SURBL/URIBL, CommonCrawl, OpenPhish, AbuseIPDB, URLhaus, SerpAPI, Safe Browsing, VirusTotal
- Hard/soft risk scoring architecture (hardRisk uncancellable by bonuses)
- Graduated keyword floor (65/55/35 based on signal strength)
- Cloudflare challenge detection (skip compliance for bot-check pages)
- WHOIS domain age penalties (<7d hard +20, <30d hard +15, <90d soft +10)
- Domain-name keyword scanning fallback for blocked/SPA sites
- Extension: server URL now replaced at download time (not just build time)
- 40-domain benchmark test (20 trusted avg=0, 20 suspicious avg=64, gap=64pts)

### UX-11: Timeline аккаунта (Activity Log) ✅
- Расширенный timeline: 9 типов событий (created, campaign, ban, ban_resolved, suspended, restored, critical, warning, info)
- Фильтры: Все / Баны / Сигналы / Уведомления / Кампании
- Ban resolved события (когда бан снят)
- Все уведомления без лимитов (убраны ограничения 8/5)
- INFO уведомления включены в ленту
- Лимит по умолчанию 10, expand показывает все

### UX-5: Фильтрация мусорных уведомлений ✅
- Blacklist 25 типов Google Ads UI шума в `notifications-parser.ts`
- `isBlacklisted()` проверяет type, label, паттерн `_PROMO$`
- Фильтрация до записи в БД — шум не попадает в `notification_details`
- Client-side regex фильтр для уже существующих записей в БД
- Покрывает: feature flags, промо баннеры, UI chrome

### UX-4: Real-time уведомления (SSE) ✅
- SSE bus (`sse-bus.ts`): управление подключёнными клиентами, broadcast по userId
- `GET /api/v1/notifications/stream` — SSE endpoint с keep-alive пингами
- Auth через `?token=` query param (EventSource не поддерживает заголовки)
- `notification.service` пушит в SSE при каждом `createNotification()`
- `useNotificationStream` hook: auto-reconnect, unread count, last notification
- `ToastNotifications` компонент: анимированные тосты с auto-dismiss 6с
- Интеграция в Layout — тосты появляются на любой странице

### UX-3: Account Health Score (автоматический) ✅
- Миграция 064: `health_score` колонка в accounts
- Сервис `health-score.service.ts`: расчёт 0-100 на основе 9 факторов
  (статус, баны, сигналы, policy violations, возраст, вертикаль, верификация, кампании)
- Обновляется при каждом collect через `updateAccountHealthScore()`
- Цветной HealthBadge в списке аккаунтов (зелёный ≥80, жёлтый ≥50, оранжевый ≥25, красный <25)
- Fallback на старый risk level если score ещё не рассчитан

### UX-2: Фильтр по датам (DateRangePicker) ✅
- Компонент DateRangePicker: пресеты (Сегодня / 7д / 30д / 90д) + произвольный диапазон
- Бэкенд: from_date/to_date на bans и notifications эндпоинтах
- Фронтенд: добавлен на страницы банов и уведомлений
- Подсветка активного фильтра, кнопка "Сбросить"

### UX-1: Глобальный поиск (Cmd+K / Ctrl+K) ✅
- `GET /api/v1/search?q=...` — поиск по accounts (google_id, display_name), domains, bans (reason, account, domain)
- `CommandPalette` компонент: Ctrl+K / Cmd+K, debounce 250ms, keyboard nav (↑↓ Enter Esc)
- Результаты по типам с иконками (User/Globe/AlertTriangle), клик → навигация
- Подключён в Layout — доступен с любой страницы
- Операторы поиска: vertical:, status:, bin:, domain:, type:, reason:, country:
- Поддержка оператор + свободный текст (status:banned 812)
- Автопробел после выбора значения оператора

### UX-6: Группировка аккаунтов (теги/проекты) ✅
- Миграция 058: таблицы `tags` (name, color) + `account_tags` (many-to-many)
- Миграция 059: удалена колонка `health_score`, заменена на Risk Score badge
- CRUD API: GET/POST/PATCH/DELETE `/api/v1/tags`
- Assign/unassign: POST/DELETE `/api/v1/accounts/:id/tags/:tag_id`
- Bulk assign: POST `/api/v1/tags/bulk-assign`
- Server-side фильтр `?tag_id=` на списке аккаунтов
- Теги в ответе accounts list (batch query)
- Конструктор тегов из пресетов (Вертикаль/ГЕО/Статус/Проект) + текстовый ввод
- Tag filter pills с кнопками удаления (X)
- Колонка "Теги" в таблице с бейджами + кнопка "+" для assign/unassign
- Optimistic updates через page-level `tagOverrides` state
- Все dropdown через React Portal (`createPortal`) для корректного z-index
- Risk Score badge (Высокий/Средний/Низкий) вместо Health Score

### UX-14: Bulk операции ✅
- Чекбоксы в списке аккаунтов: индивидуальные + "выбрать все" в заголовке
- Floating bulk action bar: появляется при выборе, показывает количество выбранных
- Bulk assign тег: dropdown с выбором тега → `POST /tags/bulk-assign` для всех выбранных
- Bulk assessment: запуск оценки рисков по всем выбранным аккаунтам
- Bulk CSV export: скачивание CSV только по выбранным аккаунтам
- Кнопка "X" для снятия выделения
- Чекбоксы видны при hover, подсвечены при выборе (#818cf8)

### UX-16: Audit Log ✅
- Миграция 060: таблица `audit_log` (user_id, user_name, action, entity_type, entity_id, details JSONB, ip_address)
- Сервис `audit.service.ts`: `logAudit()` + helper `audit(pool, request, action, opts)`
- GET `/api/v1/admin/audit` — список с фильтрами (action, user_id, entity_type, from_date, to_date) + пагинация
- Аудит подключён к: bans.handler (ban.create), accounts.handler (account.update),
  admin-users.handler (user.create, user.update, user.delete), tags.handler (tag.create, tag.delete),
  extension.handler (extension.download), admin-notifications.handler (settings.update)
- Frontend: страница `/admin/audit` с таблицей, фильтрами по действиям, пагинацией
- Раскрываемые строки: клик показывает JSON details
- Навигация: пункт "Аудит" в sidebar (только для admin)
- Индексы: user_id, action, created_at DESC, (entity_type, entity_id)

---

## Конвенции (из CLAUDE.md)

- **Файлы:** kebab-case (`creative-decay.service.ts`)
- **Миграции:** `YYYYMMDD_NNN_description.ts` (следующая: `20260326_055_...`)
- **Типы:** PascalCase, export из `packages/shared`
- **Константы:** SCREAMING_SNAKE_CASE
- **Тесты:** рядом с файлом или в `__tests__/`
- **No `any`** — использовать `unknown` + narrow
- **Branded types** для ID
- **API prefix:** `/api/v1/`
- **Error format:** `{ error: string, code: string, details?: unknown }`
