# CTS Anti-Fraud — План реализации Phase 3+

> Дата составления: 2026-03-26
> Текущее состояние: Phase 2 завершена полностью
> Последняя миграция: 054 (create_creative_snapshots)
> Выполненные задачи: [IMPLEMENTATION_PLAN_DONE.md](IMPLEMENTATION_PLAN_DONE.md)

---

## PHASE 2.5: Средний приоритет

### ЗАДАЧА 1: Методички → AI
**Приоритет:** P2
**Оценка:** 3-4 дня
**Зависимости:** нет

#### Шаг 1.1: Миграция — таблица best practices
**Файл:** `packages/server/src/migrations/20260326_055_create_best_practices.ts`

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

**СТОП-ТОЧКА:** Миграция накатывается и откатывается чисто.

#### Шаг 1.2: CRUD для методичек
**Файлы:** repository, handler, route (стандартный CRUD)

```
GET    /api/v1/best-practices?category=...&vertical=...&campaign_type=...
POST   /api/v1/best-practices (admin)
PATCH  /api/v1/best-practices/:id (admin)
DELETE /api/v1/best-practices/:id (admin)
```

#### Шаг 1.3: Интеграция с AI промптом
**Файл:** `packages/server/src/services/ai/prompts/account-analysis.prompt.ts`

```
Модифицировать промпт:
- Загрузить relevant best_practices по campaign_type + offer_vertical
- Добавить секцию в промпт:
  "Методичка команды для данного типа кампании: ..."
- AI должен сверять настройки аккаунта с best practices
- В ответе: отдельная секция "Соответствие методичке" с оценкой 0-100%
```

#### Шаг 1.4: Frontend — страница методичек
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
Неделя 1-2:
  └── Задача 1: Методички → AI (3-4 дня)        ← P2

Неделя 3:
  └── Задача 2: Rules Engine v2 (2-3 дня)        ← P2

Неделя 4-5:
  └── Задача 3: Advanced ML XGBoost (5-7 дней)   ← P3 (нужно 200+ кейсов)

Phase 3 (после накопления данных):
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
