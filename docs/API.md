# API Reference

> **Полная документация:** см. [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) раздел 4.
>
> **Интерактивная документация (Swagger UI):** `/docs` на сервере

Base URL: `/api/v1`

## Аутентификация

Два метода (любой на выбор):

| Метод | Заголовок | Использование |
|-------|----------|---------------|
| JWT Bearer | `Authorization: Bearer <token>` | Dashboard (фронтенд) |
| API Key | `X-API-Key: <key>` | Chrome Extension |

### Получение JWT

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "..." }
```

Response:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "user": { "id": "...", "name": "...", "role": "admin" }
}
```

### Обновление токена

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refresh_token": "..." }
```

## Error Format

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "details": {}
}
```

## Роли

- **admin** — полный доступ ко всем аккаунтам и настройкам
- **buyer** — доступ только к своим аккаунтам (фильтрация на бэкенде)

---

## Категории API

| Категория | Endpoints | Описание |
|-----------|----------|----------|
| Health | 1 | `GET /health` — статус сервера |
| Auth | 5 | Login, refresh, logout, me, change password |
| Accounts | 4 | CRUD аккаунтов |
| Bans | 5 | Журнал банов, post-mortem |
| Domains | 4 | Анализ доменов, enrichment |
| Analytics | 15 | Heatmap, spend velocity, ban chain, creative decay |
| Assessment | 1 | Оценка рисков |
| AI | 16 | Анализ, чат, сравнение моделей, feedback |
| ML | 5 | Прогнозы, retrain, features |
| Notifications | 8 | Inbox, SSE стрим, настройки |
| Tags | 7 | Теги, assign/unassign |
| Search | 1 | Глобальный поиск |
| Collect | 1 | Приём данных от extension |
| Stats | 5 | Overview, activity, buyer performance |
| Admin | 16 | Пользователи, настройки, правила, аудит |
| CTS | 6 | Интеграция с CTS трекером |
| Telegram | 4 | Бот интеграция |
| Best Practices | 4 | Методички CRUD |
| Extension | 2 | Скачивание CRX |

**Итого: ~100+ endpoints**

Подробное описание каждого endpoint — в [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md) или в Swagger UI (`/docs`).

---

## Примеры запросов

### Сбор данных (Extension → Server)

```http
POST /api/v1/collect
X-API-Key: <api-key>
Content-Type: application/json

{
  "profile_id": "profile-abc",
  "antidetect_browser": "octium",
  "extension_version": "0.1.1",
  "batch": [
    { "type": "account", "timestamp": "2026-02-28T12:00:00Z", "data": {} }
  ]
}
```

### AI Chat по аккаунту

```http
POST /api/v1/ai/chat/123-456-7890
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Какие основные риски у этого аккаунта?" }
  ]
}
```

Response:
```json
{
  "reply": "Основные риски аккаунта 123-456-7890:\n1. ...",
  "model": "claude-sonnet-4-20250514",
  "tokens": 1234,
  "latencyMs": 3200
}
```

### Оценка рисков

```http
POST /api/v1/assessment/123-456-7890
Authorization: Bearer <jwt>
```

### Ban Timing Heatmap

```http
GET /api/v1/analytics/ban-timing
Authorization: Bearer <jwt>
```

Response:
```json
{
  "heatmap": [[0,0,1,...], ...],
  "day_labels": ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"],
  "total_bans": 42,
  "peak_day": "Вт",
  "peak_hour": 14,
  "avg_bans_per_day": 6.0,
  "day_totals": [5,8,7,6,5,6,5],
  "hour_totals": [0,0,0,1,2,3,...]
}
```
