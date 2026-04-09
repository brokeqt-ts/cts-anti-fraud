import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronRight, Lock, Unlock, Copy, CheckCircle, Shield, Zap, Database, Bot, BarChart3, Bell, Tag, Globe, Users, Settings, Link2, BookOpen, Radio, Send } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────

interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  description?: string;
  auth: 'none' | 'jwt' | 'admin';
  body?: string;
  response?: string;
  params?: string;
  query?: string;
}

interface ApiSection {
  tag: string;
  icon: React.ReactNode;
  color: string;
  description: string;
  endpoints: Endpoint[];
}

// ── Data ───────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<string, { bg: string; color: string }> = {
  GET: { bg: 'rgba(34,197,94,0.1)', color: '#4ade80' },
  POST: { bg: 'rgba(59,130,246,0.1)', color: '#60a5fa' },
  PATCH: { bg: 'rgba(245,158,11,0.1)', color: '#fbbf24' },
  DELETE: { bg: 'rgba(239,68,68,0.1)', color: '#f87171' },
};

const API_SECTIONS: ApiSection[] = [
  {
    tag: 'Health',
    icon: <Zap size={16} />,
    color: '#4ade80',
    description: 'Проверка состояния сервера, базы данных и подключённых AI моделей',
    endpoints: [
      {
        method: 'GET',
        path: '/health',
        summary: 'Статус сервера',
        description: 'Возвращает состояние сервера, подключение к БД, доступность AI моделей (Claude, GPT, Gemini) и время работы. Используется для мониторинга и healthcheck в Docker.',
        auth: 'none',
        response: `{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "database": { "connected": true, "latency_ms": 2 },
  "last_data_received": "2026-04-09T12:00:00Z",
  "ai_models": { "claude": true, "openai": true, "gemini": false }
}`,
      },
    ],
  },
  {
    tag: 'Auth',
    icon: <Lock size={16} />,
    color: '#a78bfa',
    description: 'Аутентификация через JWT. Логин возвращает access + refresh токены. Access токен живёт 15 минут, refresh — 7 дней.',
    endpoints: [
      {
        method: 'POST',
        path: '/auth/login',
        summary: 'Логин',
        description: 'Авторизация по email и паролю. Возвращает JWT access token и refresh token. Rate limit: 10 запросов/мин.',
        auth: 'none',
        body: `{ "email": "admin@cts.local", "password": "..." }`,
        response: `{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "d4f8a2b1-...",
  "user": { "id": "uuid", "name": "Admin", "role": "admin" }
}`,
      },
      {
        method: 'POST',
        path: '/auth/refresh',
        summary: 'Обновить токен',
        description: 'Обновляет access token по refresh token. Старый refresh token отзывается, выдаётся новая пара.',
        auth: 'none',
        body: `{ "refresh_token": "d4f8a2b1-..." }`,
        response: `{ "access_token": "eyJ...", "refresh_token": "new-..." }`,
      },
      {
        method: 'POST',
        path: '/auth/logout',
        summary: 'Выход',
        description: 'Отзывает refresh token. Access token продолжает работать до истечения срока (15 мин).',
        auth: 'jwt',
        body: `{ "refresh_token": "d4f8a2b1-..." }`,
      },
      {
        method: 'GET',
        path: '/auth/me',
        summary: 'Текущий пользователь',
        description: 'Возвращает профиль текущего авторизованного пользователя: имя, email, роль, настройки.',
        auth: 'jwt',
        response: `{ "id": "uuid", "name": "Admin", "email": "admin@cts.local", "role": "admin" }`,
      },
      {
        method: 'PATCH',
        path: '/auth/me/password',
        summary: 'Смена пароля',
        description: 'Смена пароля текущего пользователя. Требует текущий пароль для подтверждения.',
        auth: 'jwt',
        body: `{ "current_password": "old", "new_password": "new" }`,
      },
    ],
  },
  {
    tag: 'Accounts',
    icon: <Users size={16} />,
    color: '#60a5fa',
    description: 'Google Ads аккаунты. Buyer видит только свои аккаунты, admin — все. Каждый аккаунт содержит кампании, ключевые слова, объявления, биллинг.',
    endpoints: [
      {
        method: 'GET',
        path: '/accounts',
        summary: 'Список аккаунтов',
        description: 'Список всех аккаунтов с пагинацией. Buyer автоматически видит только свои. Поддерживает фильтры по статусу, тегу, поиску.',
        auth: 'jwt',
        query: 'search, status, currency, tag_id, limit (50), offset (0)',
        response: `{ "total": 42, "accounts": [{ "google_account_id": "123-456-7890", "display_name": "...", "status": "ACTIVE", ... }] }`,
      },
      {
        method: 'GET',
        path: '/accounts/:google_id',
        summary: 'Детали аккаунта',
        description: 'Полная информация: основные данные + кампании + объявления + ключевые слова + биллинг + баны + уведомления + сигналы. Используется на странице account-detail.',
        auth: 'jwt',
        params: 'google_id — Google Account ID (формат: 123-456-7890)',
      },
      {
        method: 'PATCH',
        path: '/accounts/:google_id',
        summary: 'Обновить аккаунт',
        description: 'Обновление метаданных: вертикаль, заметки, привязка пользователя.',
        auth: 'jwt',
        body: `{ "offer_vertical": "gambling", "notes": "..." }`,
      },
      {
        method: 'GET',
        path: '/accounts/:google_id/quality-score',
        summary: 'Quality Score распределение',
        description: 'Распределение Quality Score по ключевым словам аккаунта. Агрегаты: средний QS, CTR, relevance, landing page score.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/accounts/:google_id/keywords/low-quality',
        summary: 'Ключевые слова с низким QS',
        description: 'Список ключевых слов с Quality Score ≤ 4. Для оптимизации кампаний.',
        auth: 'jwt',
        query: 'threshold (4)',
      },
      {
        method: 'GET',
        path: '/accounts/:google_id/quality-score/history',
        summary: 'История Quality Score',
        description: 'Снэпшоты среднего QS по дням. Для отслеживания тренда качества.',
        auth: 'jwt',
      },
    ],
  },
  {
    tag: 'Bans',
    icon: <Shield size={16} />,
    color: '#f87171',
    description: 'Журнал банов Google Ads. Записи создаются автоматически (auto-ban detection) или вручную. Каждый бан содержит причину, дату, тип и может иметь post-mortem анализ.',
    endpoints: [
      {
        method: 'GET',
        path: '/bans',
        summary: 'Список банов',
        description: 'Все баны с пагинацией и фильтрами. Buyer видит только баны своих аккаунтов.',
        auth: 'jwt',
        query: 'limit, offset, from_date, to_date, vertical, target',
        response: `{ "total": 15, "bans": [{ "id": "uuid", "account_google_id": "...", "ban_reason": "Circumventing systems", ... }] }`,
      },
      {
        method: 'POST',
        path: '/bans',
        summary: 'Записать бан',
        description: 'Ручное создание записи бана. Указывается аккаунт, дата, причина, тип (account/domain/campaign/ad), вертикаль, домен.',
        auth: 'jwt',
        body: `{
  "account_google_id": "123-456-7890",
  "ban_date": "2026-04-09",
  "ban_target": "account",
  "ban_reason_google": "Circumventing systems",
  "offer_vertical": "gambling",
  "domain": "example.com"
}`,
      },
      {
        method: 'GET',
        path: '/bans/:id',
        summary: 'Детали бана',
        description: 'Полная информация о бане: причина, дата, аккаунт, домен, post-mortem, timeline.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/bans/:id/post-mortem',
        summary: 'Post-mortem анализ',
        description: 'Генерирует AI-анализ причин бана: что пошло не так, какие факторы способствовали, рекомендации на будущее.',
        auth: 'jwt',
      },
    ],
  },
  {
    tag: 'Domains',
    icon: <Globe size={16} />,
    color: '#14b8a6',
    description: 'Домены из рекламных кампаний. Автоматический enrichment через 14 внешних API: WHOIS, SSL, DNS, Shodan, Spamhaus, VirusTotal и др.',
    endpoints: [
      {
        method: 'GET',
        path: '/domains',
        summary: 'Список доменов',
        description: 'Все домены с enrichment данными: возраст, SSL, DNS, risk score, content analysis.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/domains/:domain',
        summary: 'Детали домена',
        description: 'Полная информация: WHOIS, SSL сертификат, DNS записи, content analysis (keyword scanning, compliance), связанные аккаунты и баны.',
        auth: 'jwt',
        response: `{
  "domain": { "domain_name": "example.com", "age_days": 365, "ssl": true, ... },
  "content_analysis": { "content_risk_score": 25, "compliance_score": 85, ... },
  "accounts": [...], "bans": [...]
}`,
      },
      {
        method: 'POST',
        path: '/domains/:domain/content-analysis',
        summary: 'Анализ контента',
        description: 'Запуск анализа лендинга: сканирование ключевых слов, проверка compliance (privacy policy, terms), обнаружение red flags (fake reviews, countdown timers).',
        auth: 'admin',
      },
    ],
  },
  {
    tag: 'Analytics',
    icon: <BarChart3 size={16} />,
    color: '#f59e0b',
    description: 'Аналитика: heatmaps, spend velocity, ban chains, creative decay, competitive intelligence. Данные кешируются через materialized views (обновление каждый час).',
    endpoints: [
      {
        method: 'GET',
        path: '/analytics/ban-timing',
        summary: 'Ban Timing Heatmap',
        description: 'Матрица 7×24 (день недели × час) с количеством банов. Показывает паттерны — в какие дни/часы чаще банят. Admin видит все данные (из materialized view), buyer — только свои (прямой запрос).',
        auth: 'jwt',
        response: `{
  "heatmap": [[0,0,1,0,...], ...],
  "day_labels": ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"],
  "total_bans": 42,
  "peak_day": "Вт",
  "peak_hour": 14,
  "avg_bans_per_day": 6.0
}`,
      },
      {
        method: 'GET',
        path: '/analytics/overview',
        summary: 'Общая аналитика',
        description: 'Агрегированные метрики: lifetime аккаунтов, ban rate по вертикалям, churn analysis.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/analytics/spend-velocity',
        summary: 'Скорость расхода',
        description: 'Анализ скорости расхода бюджета. Аномально высокий spend velocity — сигнал риска.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/analytics/ban-chain',
        summary: 'Связи банов',
        description: 'Граф связей между забаненными аккаунтами: общие домены, BIN, прокси. Показывает кластеры связанных аккаунтов.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/analytics/consumable-scoring',
        summary: 'Scoring расходников',
        description: 'Оценка BIN-ов, прокси, доменов по ban rate. Помогает выбирать безопасные расходные материалы.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/analytics/creative-decay',
        summary: 'Creative Decay',
        description: 'Мониторинг деградации перформанса креативов: CTR, CPC, конверсии. Алерты когда креатив выгорает.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/analytics/competitive-intelligence',
        summary: 'Конкурентная аналитика',
        description: 'Анализ auction insights: доля показов, overlap rate, outranking share. Сравнение с конкурентами.',
        auth: 'jwt',
      },
    ],
  },
  {
    tag: 'Assessment',
    icon: <Shield size={16} />,
    color: '#ec4899',
    description: 'Оценка рисков аккаунта. Rules Engine анализирует 5 категорий факторов, применяет 14+ правил и выдаёт risk score 0-100.',
    endpoints: [
      {
        method: 'POST',
        path: '/assessment/:accountId',
        summary: 'Оценка рисков',
        description: 'Запуск полной оценки рисков: анализ аккаунта, домена, BIN, сетевых связей, поведения. Применяются базовые + кастомные expert rules. Результат: risk_score (0-100), risk_level, список факторов, рекомендации.',
        auth: 'jwt',
        response: `{
  "risk_score": 72,
  "risk_level": "high",
  "factors": [
    { "category": "domain", "score": 85, "detail": "Домен < 30 дней" },
    { "category": "network", "score": 60, "detail": "Общий BIN с забаненным" }
  ],
  "recommendations": ["Сменить домен", "Диверсифицировать платёжные методы"]
}`,
      },
    ],
  },
  {
    tag: 'AI',
    icon: <Bot size={16} />,
    color: '#8b5cf6',
    description: 'AI анализ через Claude Sonnet / GPT-4o / Gemini. Multi-model comparison, specialized prompts (domain audit, rotation strategy, appeal), AI Chat по аккаунту.',
    endpoints: [
      {
        method: 'POST',
        path: '/ai/analyze/:accountId',
        summary: 'AI анализ аккаунта',
        description: 'Multi-model анализ: каждая подключённая модель анализирует аккаунт, затем применяется стратегия агрегации (majority_vote или best_model). Возвращает risk level, уверенность, рекомендации, действия.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/chat/:accountId',
        summary: 'AI Чат по аккаунту',
        description: 'Диалоговый интерфейс — задавайте вопросы об аккаунте на русском языке. AI имеет полный контекст: метрики, кампании, баны, домены, ML прогноз, assessment. Поддерживает multi-turn conversation.',
        auth: 'jwt',
        body: `{
  "messages": [
    { "role": "user", "content": "Какие основные риски?" },
    { "role": "assistant", "content": "Основные риски..." },
    { "role": "user", "content": "А что с доменом?" }
  ]
}`,
        response: `{
  "reply": "Домен example.com имеет возраст 15 дней...",
  "model": "claude-sonnet-4-20250514",
  "tokens": 1234,
  "latencyMs": 3200
}`,
      },
      {
        method: 'POST',
        path: '/ai/analyze-ban/:banLogId',
        summary: 'AI анализ бана',
        description: 'Глубокий анализ конкретного бана: причины, факторы, что можно было сделать иначе.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/compare-models/:accountId',
        summary: 'Сравнение моделей',
        description: 'Параллельный запрос ко всем подключённым моделям. Сравнение: agreement level, divergence points, латентность, стоимость.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/audit-domain/:domainId',
        summary: 'AI аудит домена',
        description: 'Специализированный промпт для анализа домена: compliance, red flags, рекомендации по улучшению.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/rotation-strategy/:banLogId',
        summary: 'Стратегия ротации',
        description: 'AI генерирует план ротации после бана: какой домен, BIN, прокси использовать, какие настройки менять.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/appeal-strategy/:banLogId',
        summary: 'Стратегия апелляции',
        description: 'AI генерирует стратегию апелляции: шансы успеха, текст апелляции, какие аргументы использовать.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/farm-analysis',
        summary: 'Анализ фарма',
        description: 'Анализ группы аккаунтов (2-20): корреляции, общие паттерны, риски обнаружения связей.',
        auth: 'jwt',
        body: `{ "account_ids": ["123-456-7890", "098-765-4321"] }`,
      },
      {
        method: 'GET',
        path: '/ai/leaderboard',
        summary: 'Лидерборд моделей',
        description: 'Рейтинг AI моделей по точности предсказаний, учитывая фидбек пользователей.',
        auth: 'jwt',
        query: 'period (all, 7d, 30d, 90d)',
      },
      {
        method: 'GET',
        path: '/ai/models',
        summary: 'Список моделей',
        description: 'Какие AI модели подключены и доступны. Показывает статус конфигурации каждой.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ai/predictions/:id/feedback',
        summary: 'Фидбек на предсказание',
        description: 'Like/dislike на AI предсказание. Влияет на leaderboard и обучение.',
        auth: 'jwt',
        body: `{ "vote": "up", "comment": "Точный прогноз" }`,
      },
    ],
  },
  {
    tag: 'ML',
    icon: <Database size={16} />,
    color: '#14b8a6',
    description: 'Machine Learning: Logistic Regression на 26 фичах. Предсказывает вероятность бана, дни до бана, топ-факторы риска. Auto-retrain еженедельно.',
    endpoints: [
      {
        method: 'GET',
        path: '/ml/predict/:accountId',
        summary: 'Предсказание бана',
        description: 'ML прогноз для аккаунта: вероятность бана (0-1), уровень риска, прогноз дней до бана, топ-5 факторов с direction (increases/decreases risk).',
        auth: 'jwt',
        response: `{
  "ban_probability": 0.73,
  "risk_level": "high",
  "predicted_days_to_ban": 7,
  "top_factors": [
    { "feature": "account_age_days", "label": "Возраст аккаунта", "contribution": 0.42, "value": 5, "direction": "increases_risk" }
  ]
}`,
      },
      {
        method: 'GET',
        path: '/ml/status',
        summary: 'Статус модели',
        description: 'Текущая модель: версия, дата обучения, accuracy, количество обучающих примеров.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/ml/retrain',
        summary: 'Переобучение',
        description: 'Ручной запуск переобучения модели на всех данных из БД. Автоматически запускается еженедельно и каждые 50 банов.',
        auth: 'admin',
      },
      {
        method: 'GET',
        path: '/ml/features/:accountId',
        summary: 'Feature vector',
        description: 'Все 26 фичей для аккаунта: account_age_days, policy_violation_count, total_spend_usd, bin_ban_rate и др.',
        auth: 'jwt',
      },
      {
        method: 'GET',
        path: '/ml/feature-importance',
        summary: 'Важность фичей',
        description: 'Ранжирование 26 фичей по влиянию на предсказание. Для понимания, что модель считает важным.',
        auth: 'jwt',
      },
    ],
  },
  {
    tag: 'Notifications',
    icon: <Bell size={16} />,
    color: '#f59e0b',
    description: 'Система уведомлений: in-app inbox, SSE real-time стрим, Telegram бот. Типы: ban alerts, risk warnings, creative decay, system.',
    endpoints: [
      {
        method: 'GET',
        path: '/notifications',
        summary: 'Список уведомлений',
        description: 'Inbox с пагинацией. Фильтры по типу, severity, прочитанности.',
        auth: 'jwt',
        query: 'limit (20), offset (0), unread_only (false)',
      },
      {
        method: 'GET',
        path: '/notifications/unread-count',
        summary: 'Непрочитанные',
        description: 'Количество непрочитанных уведомлений. Используется для badge на колокольчике.',
        auth: 'jwt',
        response: `{ "count": 5 }`,
      },
      {
        method: 'GET',
        path: '/notifications/stream',
        summary: 'SSE стрим',
        description: 'Server-Sent Events для real-time уведомлений. Авторизация через ?token=JWT (EventSource не поддерживает заголовки). Keep-alive пинги каждые 30с.',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/notifications/read-all',
        summary: 'Прочитать все',
        description: 'Отметить все уведомления как прочитанные.',
        auth: 'jwt',
      },
    ],
  },
  {
    tag: 'Tags',
    icon: <Tag size={16} />,
    color: '#ec4899',
    description: 'Теги для группировки аккаунтов: по вертикали, ГЕО, проекту. Bulk assign, фильтрация в списке аккаунтов.',
    endpoints: [
      {
        method: 'GET',
        path: '/tags',
        summary: 'Список тегов',
        auth: 'jwt',
        description: 'Все теги с цветами.',
      },
      {
        method: 'POST',
        path: '/tags',
        summary: 'Создать тег',
        auth: 'jwt',
        body: `{ "name": "VIP", "color": "#8b5cf6" }`,
      },
      {
        method: 'POST',
        path: '/accounts/:google_id/tags/:tag_id',
        summary: 'Назначить тег',
        auth: 'jwt',
        description: 'Привязать тег к аккаунту.',
      },
      {
        method: 'POST',
        path: '/tags/bulk-assign',
        summary: 'Bulk assign',
        auth: 'jwt',
        description: 'Назначить тег нескольким аккаунтам одновременно.',
        body: `{ "google_account_ids": ["123-456-7890", "..."], "tag_id": "uuid" }`,
      },
    ],
  },
  {
    tag: 'Collect',
    icon: <Radio size={16} />,
    color: '#60a5fa',
    description: 'Приём данных от Chrome Extension. Extension перехватывает XHR/fetch ответы Google Ads и отправляет батчами.',
    endpoints: [
      {
        method: 'POST',
        path: '/collect',
        summary: 'Отправить данные',
        description: 'Основной endpoint для Chrome Extension. Принимает батч перехваченных данных. Типы: account, campaign, performance, billing, ad_review, status_change, raw.',
        auth: 'jwt',
        body: `{
  "profile_id": "profile-abc",
  "antidetect_browser": "adspower",
  "extension_version": "0.1.1",
  "batch": [
    { "type": "account", "timestamp": "2026-04-09T12:00:00Z", "data": {...} }
  ]
}`,
        response: `{ "status": "ok", "processed": 5 }`,
      },
    ],
  },
  {
    tag: 'Search',
    icon: <Search size={16} />,
    color: '#8b5cf6',
    description: 'Глобальный поиск по аккаунтам, доменам, банам. Поддерживает операторы: vertical:, status:, bin:, domain:.',
    endpoints: [
      {
        method: 'GET',
        path: '/search',
        summary: 'Глобальный поиск',
        description: 'Поиск по Google Account ID, имени аккаунта, домену, причине бана. Операторы: vertical:gambling, status:banned, bin:4111.',
        auth: 'jwt',
        query: 'q — поисковый запрос',
        response: `{
  "accounts": [{ "google_account_id": "...", "display_name": "..." }],
  "domains": [{ "domain_name": "example.com" }],
  "bans": [{ "id": "uuid", "ban_reason": "..." }]
}`,
      },
    ],
  },
  {
    tag: 'Admin',
    icon: <Settings size={16} />,
    color: '#94a3b8',
    description: 'Административные операции: управление пользователями, API ключами, expert rules, audit log. Только для роли admin.',
    endpoints: [
      {
        method: 'GET',
        path: '/admin/users',
        summary: 'Список пользователей',
        auth: 'admin',
        description: 'Все пользователи системы: имя, email, роль, статус, последняя активность.',
      },
      {
        method: 'POST',
        path: '/admin/users',
        summary: 'Создать пользователя',
        auth: 'admin',
        body: `{ "name": "Buyer 1", "email": "buyer@cts.local", "password": "...", "role": "buyer" }`,
      },
      {
        method: 'GET',
        path: '/admin/rules',
        summary: 'Expert Rules',
        auth: 'admin',
        description: 'Список кастомных правил оценки рисков. Каждое правило: condition (field + operator + value), severity, message template.',
      },
      {
        method: 'POST',
        path: '/admin/rules',
        summary: 'Создать правило',
        auth: 'admin',
        body: `{
  "name": "High BIN ban rate",
  "category": "bin",
  "condition": { "field": "bin_ban_rate", "operator": ">", "value": 80 },
  "severity": "critical",
  "message_template": "BIN {bin} имеет {ban_rate}% бан рейт"
}`,
      },
      {
        method: 'GET',
        path: '/admin/audit',
        summary: 'Audit Log',
        auth: 'admin',
        description: 'Лог всех действий: создание банов, обновление аккаунтов, управление пользователями. Фильтры по action, user, entity, дате.',
        query: 'action, user_id, entity_type, from_date, to_date, limit, offset',
      },
    ],
  },
  {
    tag: 'CTS',
    icon: <Link2 size={16} />,
    color: '#14b8a6',
    description: 'Интеграция с CTS (трекер): сайты, трафик, синхронизация. Связь доменов с аккаунтами.',
    endpoints: [
      {
        method: 'GET',
        path: '/cts/sites',
        summary: 'Список CTS сайтов',
        auth: 'jwt',
      },
      {
        method: 'POST',
        path: '/cts/sites',
        summary: 'Создать сайт',
        auth: 'admin',
        body: `{ "domain": "example.com", "external_cts_id": "..." }`,
      },
      {
        method: 'GET',
        path: '/cts/sites/:id/traffic',
        summary: 'Трафик сайта',
        auth: 'jwt',
        description: 'Данные трафика CTS сайта по дням.',
        query: 'range (7d, 30d, 90d)',
      },
    ],
  },
  {
    tag: 'Best Practices',
    icon: <BookOpen size={16} />,
    color: '#60a5fa',
    description: 'Методички команды: ban prevention, domain selection, budget strategy, creative guidelines. Интегрированы в AI промпты.',
    endpoints: [
      {
        method: 'GET',
        path: '/best-practices',
        summary: 'Список методичек',
        auth: 'jwt',
        query: 'category, vertical',
      },
      {
        method: 'POST',
        path: '/best-practices',
        summary: 'Создать методичку',
        auth: 'admin',
        body: `{
  "category": "ban_prevention",
  "offer_vertical": "gambling",
  "title": "Настройка кампании для gambling",
  "content": "1. Использовать домен старше 90 дней...",
  "priority": 1
}`,
      },
    ],
  },
  {
    tag: 'Telegram',
    icon: <Send size={16} />,
    color: '#3b82f6',
    description: 'Telegram бот: алерты банов, creative decay, команды (/status, /help). Подключение через deep-link.',
    endpoints: [
      {
        method: 'GET',
        path: '/telegram/bot-info',
        summary: 'Информация о боте',
        auth: 'none',
        description: 'Имя бота, статус подключения.',
      },
      {
        method: 'POST',
        path: '/telegram/connect',
        summary: 'Подключить Telegram',
        auth: 'jwt',
        description: 'Генерирует deep-link для подключения Telegram аккаунта.',
      },
      {
        method: 'GET',
        path: '/telegram/connect/status',
        summary: 'Статус подключения',
        auth: 'jwt',
      },
    ],
  },
];

// ── Components ─────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const s = METHOD_STYLES[method] ?? METHOD_STYLES['GET']!;
  return (
    <span
      className="inline-flex items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-bold"
      style={{ background: s.bg, color: s.color, minWidth: 52 }}
    >
      {method}
    </span>
  );
}

function AuthBadge({ auth }: { auth: string }) {
  if (auth === 'none') return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-green)' }}>
      <Unlock size={10} /> Public
    </span>
  );
  if (auth === 'admin') return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#f87171' }}>
      <Lock size={10} /> Admin
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      <Lock size={10} /> JWT
    </span>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="label-xs">{label}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-xs transition" style={{ color: 'var(--text-muted)' }}>
          {copied ? <><CheckCircle size={10} /> Скопировано</> : <><Copy size={10} /> Копировать</>}
        </button>
      </div>
      <pre
        className="rounded-lg p-3 text-xs overflow-x-auto font-mono"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', lineHeight: 1.6 }}
      >
        {code}
      </pre>
    </div>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  const hasDetails = ep.description || ep.body || ep.response || ep.params || ep.query;

  return (
    <div
      className="rounded-lg transition"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <button
        onClick={() => hasDetails && setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        style={{ cursor: hasDetails ? 'pointer' : 'default' }}
      >
        <MethodBadge method={ep.method} />
        <code className="text-sm font-mono flex-1" style={{ color: 'var(--text-primary)' }}>{ep.path}</code>
        <span className="text-xs hidden sm:block" style={{ color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.summary}</span>
        <AuthBadge auth={ep.auth} />
        {hasDetails && (
          open ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
        )}
      </button>

      {open && hasDetails && (
        <div className="px-4 pb-4 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="pt-3">
            <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{ep.summary}</h4>
            {ep.description && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{ep.description}</p>
            )}
          </div>
          {ep.params && (
            <div>
              <span className="label-xs">Параметры</span>
              <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{ep.params}</p>
            </div>
          )}
          {ep.query && (
            <div>
              <span className="label-xs">Query параметры</span>
              <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{ep.query}</p>
            </div>
          )}
          {ep.body && <CodeBlock code={ep.body} label="Request Body" />}
          {ep.response && <CodeBlock code={ep.response} label="Response" />}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export function ApiDocsPage() {
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return API_SECTIONS
      .filter((s) => !activeTag || s.tag === activeTag)
      .map((section) => ({
        ...section,
        endpoints: section.endpoints.filter(
          (ep) =>
            !q ||
            ep.path.toLowerCase().includes(q) ||
            ep.summary.toLowerCase().includes(q) ||
            (ep.description ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.endpoints.length > 0);
  }, [search, activeTag]);

  const totalEndpoints = API_SECTIONS.reduce((s, sec) => s + sec.endpoints.length, 0);

  return (
    <div className="py-5 px-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>API Documentation</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {totalEndpoints} endpoints | Base URL: <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>/api/v1</code>
        </p>
      </div>

      {/* Auth info cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        <div className="card-static p-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} style={{ color: '#a78bfa' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>JWT Bearer Token</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Для Dashboard. Получить через POST /auth/login</p>
          <code className="text-xs mt-1 block font-mono" style={{ color: 'var(--text-secondary)' }}>Authorization: Bearer {'<token>'}</code>
        </div>
        <div className="card-static p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={14} style={{ color: '#60a5fa' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>API Key</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Для Chrome Extension</p>
          <code className="text-xs mt-1 block font-mono" style={{ color: 'var(--text-secondary)' }}>X-API-Key: {'<key>'}</code>
        </div>
      </div>

      {/* Search + Tag Filter */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Поиск по endpoints..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-9"
          />
        </div>
      </div>

      {/* Tag pills */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        <button
          onClick={() => setActiveTag(null)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
          style={{
            background: !activeTag ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
            color: !activeTag ? '#a78bfa' : 'var(--text-muted)',
            border: `1px solid ${!activeTag ? 'rgba(139,92,246,0.3)' : 'var(--border-subtle)'}`,
          }}
        >
          Все ({totalEndpoints})
        </button>
        {API_SECTIONS.map((s) => (
          <button
            key={s.tag}
            onClick={() => setActiveTag(activeTag === s.tag ? null : s.tag)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5"
            style={{
              background: activeTag === s.tag ? `${s.color}18` : 'var(--bg-card)',
              color: activeTag === s.tag ? s.color : 'var(--text-muted)',
              border: `1px solid ${activeTag === s.tag ? `${s.color}40` : 'var(--border-subtle)'}`,
            }}
          >
            {s.icon}
            {s.tag} ({s.endpoints.length})
          </button>
        ))}
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {filtered.map((section) => (
          <div key={section.tag}>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: `${section.color}15`, color: section.color }}>
                {section.icon}
              </div>
              <div>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{section.tag}</h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{section.description}</p>
              </div>
            </div>
            <div className="space-y-1.5 ml-9">
              {section.endpoints.map((ep) => (
                <EndpointCard key={`${ep.method}-${ep.path}`} ep={ep} />
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Search size={24} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ничего не найдено</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-xs" style={{ color: 'var(--text-ghost)' }}>
          CTS Anti-Fraud API v1.0 | Swagger UI: <code>/docs</code> | Формат ошибок: {'{ error, code, details? }'}
        </p>
      </div>
    </div>
  );
}
