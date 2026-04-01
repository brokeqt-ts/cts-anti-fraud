# CTS Anti-Fraud — План реализации

> Дата составления: 2026-03-26
> Обновлено: 2026-04-01
> Текущее состояние: UX P2 в процессе (UX-6 Теги ✅)
> Последняя миграция: 059 (drop_health_score)
> Выполненные задачи: [IMPLEMENTATION_PLAN_DONE.md](IMPLEMENTATION_PLAN_DONE.md)

---

## UX IMPROVEMENTS: Улучшения существующих функций

### P1 — Высокий импакт

#### ~~UX-1: Глобальный поиск (Cmd+K / Ctrl+K)~~ ✅ Перенесена в DONE

#### ~~UX-2: Фильтр по датам на всех страницах~~ ✅ Перенесена в DONE

#### ~~UX-3: Account Health Score (автоматический)~~ ✅ Перенесена в DONE

#### ~~UX-4: Real-time уведомления (SSE)~~ ✅ Перенесена в DONE

#### ~~UX-5: Фильтрация мусорных уведомлений~~ ✅ Перенесена в DONE

---

### P2 — Средний приоритет

#### ~~UX-6: Группировка аккаунтов (теги/проекты)~~ ✅ Перенесена в DONE

#### ~~UX-7: Ban Chain граф-визуализация~~ ✅ Перенесена в DONE

#### UX-8: Автоматические отчёты (Weekly Digest)
**Оценка:** 1-2 дня
**Зависимости:** Telegram bot

Каждый понедельник в Telegram: баны за неделю, горящие домены/BIN,
изменения risk score, creative decay alerts.

#### UX-9: Quick Actions (Command Palette)
**Оценка:** 0.5 дня (вместе с UX-1)
**Зависимости:** UX-1

Действия из поисковой палитры: "Записать бан", "Проверить домен",
"Assessment", "AI анализ" — без навигации по меню.

#### UX-10: Сравнение аккаунтов side-by-side
**Оценка:** 1-2 дня
**Зависимости:** нет

Выбрать 2-3 аккаунта → табличное сравнение: lifetime, spend, настройки,
домены, quality score. Для A/B анализа.

---

### P3 — Стратегические улучшения

#### ~~UX-11: Timeline аккаунта (Activity Log)~~ ✅ Перенесена в DONE

#### UX-12: Anomaly Detection алерты
**Оценка:** 2-3 дня

Автоалерты: spend +200%/день, QS < 3, новый policy violation, домен в blocklist.
Настраиваемые пороги. Telegram + in-app.

#### UX-13: Предиктивный countdown "Дней до бана"
**Оценка:** 1 день
**Зависимости:** ML predictor (уже есть)

Визуальный индикатор "Estimated days until ban: ~12" на карточке аккаунта.
На основе существующего logistic regression.

#### UX-14: Bulk операции
**Оценка:** 1-2 дня

Массовые: теги, AI анализ, assessment для группы аккаунтов.
Checkbox на списке → действие. Как в Google Ads Editor.

#### UX-15: Кастомизируемый Dashboard
**Оценка:** 3-5 дней

Drag-and-drop виджеты: каждый байер настраивает под себя.
Сохранение layout в localStorage.

#### ~~UX-16: Audit Log~~ ✅ Перенесена в DONE

#### UX-17: "Сегодня важно" блок на дашборде
**Оценка:** 0.5 дня

Топ-3 действия на сегодня: аккаунты с высоким риском, creative decay,
домены требующие внимания. Как WordStream "20 Minute Work Week".

---

## PHASE 2.5: Средний приоритет

### ~~ЗАДАЧА 1: Методички → AI~~ ✅ Перенесена в DONE

---

### ЗАДАЧА 2: Expert Rules Engine v2
**Приоритет:** P2
**Оценка:** 2-3 дня
**Зависимости:** нет

#### Шаг 2.1: Миграция — конфигурируемые правила
**Файл:** `packages/server/src/migrations/20260326_056_create_expert_rules.ts`

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

#### Шаг 2.2: Rules Engine v2
**Файл:** `packages/server/src/services/rules-engine-v2.ts`

```
- Загрузка правил из БД (кеш 5 мин)
- Поддержка операторов: >, <, >=, <=, ==, !=, in, not_in, contains, regex
- Поддержка составных условий: AND, OR
- Поддержка шаблонов сообщений с переменными
- Обратная совместимость: хардкод правила из rules-engine.ts как default seed
```

#### Шаг 2.3: Admin UI — редактор правил
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

### ЗАДАЧА 3: Advanced ML (XGBoost)
**Приоритет:** P3
**Оценка:** 5-7 дней
**Зависимости:** 200+ кейсов в базе

#### Шаг 3.1: Python ML сервис
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

#### Шаг 3.2: Feature engineering
```python
Расширить до 50+ фичей:
- Все 26 текущих из feature-extraction.service.ts
- Временные: hour_of_creation, day_of_week, days_since_last_ban_in_vertical
- Поведенческие: spend_acceleration, budget_change_count, domain_switch_count
- Сетевые: shared_proxy_ban_rate, shared_payment_ban_rate
- Текстовые: keyword_risk_score (TF-IDF на забаненных ключах)
```

#### Шаг 3.3: Интеграция с Node.js сервером
**Файл:** `packages/server/src/services/ml/ml-service-client.ts`

```
HTTP-клиент к Python ML сервису:
- POST /train → запуск обучения
- POST /predict → предсказание для аккаунта
- GET /health → проверка доступности
- Fallback на встроенный ban-predictor.ts если ML сервис недоступен
```

#### Шаг 3.4: Docker
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

### ЗАДАЧА 4: Facebook / TikTok Ads Extension
**Оценка:** 7-10 дней
**Зависимости:** нет

```
Что нужно:
1. packages/extension/src/interceptors/ — добавить facebook-injector.ts, tiktok-injector.ts
2. manifest.json — добавить host_permissions для facebook.com/ads, business.tiktok.com
3. Новые парсеры на сервере для форматов Facebook/TikTok API
4. Абстрагировать collect pipeline для multi-platform
5. Dashboard: фильтр по платформе (Google/Facebook/TikTok)
6. Новые миграции: platform поле на accounts, campaigns
```

---

### ЗАДАЧА 5: Keitaro / Binom интеграция
**Оценка:** 3-5 дней

```
1. Новый сервис: tracker-integration.service.ts
2. Поддержка API Keitaro и Binom
3. Импорт: конверсии, ROI, click data
4. Связка с аккаунтами по campaign_id / sub_id
5. Dashboard: ROI колонка в таблице кампаний
```

---

### ЗАДАЧА 6: Авторотация доменов
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

---

### ЗАДАЧА 7: A/B тесты антифрода
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
Спринт 1 (UX P1):
  ├── UX-1: Глобальный поиск Cmd+K (1д)
  ├── UX-2: Date range picker (1д)
  ├── UX-5: Фильтрация мусорных уведомлений (0.5д)
  └── UX-3: Account Health Score (1-2д)

Спринт 2 (UX P1 + P2):
  ├── UX-4: Real-time уведомления SSE (2д)
  ├── UX-6: Теги/группы аккаунтов (2д)
  └── UX-17: "Сегодня важно" блок (0.5д)

Спринт 3 (UX P2 + Existing):
  ├── UX-8: Weekly Digest (1-2д)
  ├── Задача 2: Rules Engine v2 (2-3д)
  └── UX-10: Сравнение аккаунтов (1-2д)

Спринт 4 (UX P3):
  ├── UX-7: Ban Chain граф (2-3д)
  ├── UX-11: Timeline аккаунта (1-2д)
  ├── UX-12: Anomaly Detection (2-3д)
  └── UX-13: Countdown до бана (1д)

Phase 3 (после накопления данных):
  ├── Задача 3: Advanced ML XGBoost (5-7д)
  ├── Задача 4: Facebook/TikTok Extension
  ├── Задача 5: Keitaro/Binom
  ├── Задача 6: Авторотация доменов
  └── Задача 7: A/B тесты
```

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
