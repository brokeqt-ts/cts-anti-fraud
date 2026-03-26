# Domain Content Analyzer — Полный список проверок

> Обновлено: 2026-03-26
> Сервис: `packages/server/src/services/domain-content-analyzer.ts`

---

## Level 1: Локальный анализ HTML (без внешних API)

### 1. Сканер серых ключевых слов (150+ ключей, 7 вертикалей)

| Вертикаль | Примеры ключей |
|---|---|
| Gambling | casino, slots, betting, ставки, рулетка, jackpot, free spins, 1xbet, pin-up, покер |
| Nutra | похудение, weight loss, clinically proven, FDA approved, до и после, -30 кг, fat burner |
| Crypto | guaranteed returns, passive income, auto-trading, bitcoin investment, 100% profit |
| Finance | instant loan, guaranteed approval, no credit check, займ без отказа, микрозайм |
| Sweepstakes | you have won, claim your prize, free iphone, spin the wheel, вы выиграли |
| Dating | hookup, adult dating, hot singles, знакомства без обязательств |
| Pharma | buy without prescription, online pharmacy, cheap viagra, без рецепта |
| Generic | limited time only, осталось мест, последний шанс, exclusive offer |

Уровни серьёзности: `critical` (20 очков), `warning` (10 очков), `info` (3 очка).

### 2. Проверка compliance (соответствие требованиям)

| Проверка | Очки |
|---|---|
| Privacy Policy (Политика конфиденциальности) | +25 |
| Terms of Service (Пользовательское соглашение) | +20 |
| Контактная информация (email, телефон, адрес) | +20 |
| Disclaimer (Отказ от ответственности) | +15 |
| About Page (О компании) | +10 |
| Cookie Consent (GDPR баннер) | +5 |
| Подтверждение возраста (18+/21+) | +5 |

Скор: 0-100, чем выше — тем лучше соответствие.

### 3. Структурные красные флаги

| Флаг | Серьёзность | Описание |
|---|---|---|
| Таймер обратного отсчёта | warning | Тактика давления срочностью |
| Фейковые отзывы | warning | 3+ одинаковых паттерна ★★★★★ |
| До/После | warning | Требует дисклеймеров для Google Ads |
| Скрытый текст | critical | CSS: color=transparent, font-size:0, text-indent:-9999 |
| Агрессивные CTA | info | 3+ кнопок "Купить сейчас" |
| Попап/оверлей | warning | position:fixed + высокий z-index |
| Автовоспроизведение видео | info | `<video autoplay>` |
| JS-редирект | critical | `window.location` на внешний URL |
| Обфусцированный JS | critical | `eval(atob(...))` / `eval(unescape(...))` |
| Много iframe | warning | 3+ iframe на странице |

### 4. Анализ цепочки редиректов

- Количество хопов (>2 хопов = +15 за каждый)
- Смена домена в цепочке (+20)
- Несовпадение с URL объявления (+30)
- >5 хопов = 60+ скор

### 5. HTTP заголовки безопасности

| Заголовок | Очки |
|---|---|
| Strict-Transport-Security (HSTS) | +25 |
| Content-Security-Policy (CSP) | +25 |
| X-Frame-Options | +15 |
| X-Content-Type-Options | +10 |
| Referrer-Policy | +15 |
| Permissions-Policy | +10 |

Также фиксируются: заголовок `Server`, `X-Powered-By`.

### 6. Оценка риска TLD (домена верхнего уровня)

| Риск | Скор | TLD |
|---|---|---|
| Высокий | 80 | .xyz, .top, .click, .club, .icu, .buzz, .gq, .cf, .tk, .ml, .ga, .monster, .sbs |
| Средний | 40 | .io, .co, .me, .cc, .biz, .info, .site, .online, .store, .shop, .live, .space |
| Низкий | 5 | .com, .org, .net, .edu, .gov, .mil |
| Страновой | 15 | Двухбуквенные национальные TLD (.de, .uk, .ru и т.д.) |

### 7. Анализ robots.txt

- Существует ли файл
- Блокирует ли Googlebot (Disallow: / для Googlebot)
- Блокирует ли всех ботов (Disallow: / для *)
- Наличие Sitemap и URL-ы
- Список заблокированных путей

### 8. Анализ форм

- Количество форм и их методы (GET/POST)
- Сбор персональных данных (поля email, phone, name, address)
- Сбор платёжных данных (поля card, cvv, billing)
- Внешние targets форм (action на другой домен)

### 9. Каталог сторонних скриптов

| Категория | Обнаруживаемые скрипты |
|---|---|
| Аналитика | Google Analytics, GTM, Яндекс Метрика (src + inline паттерны) |
| Реклама | Facebook Pixel, TikTok Pixel, Google Ads, AdSense, LinkedIn Insight |
| Подозрительные | Keitaro TDS, Binom TDS, PropellerAds, ExoClick, Clickadu, TrafficJunky |
| CDN | Cloudflare CDN, jsDelivr, UNPKG, Google CDN |

Inline-детекция: `gtag()`, `fbq()`, `ym()`, паттерны TDS-редиректов.

### 10. Репутация внешних ссылок

| Тип | Проверяемые домены |
|---|---|
| URL-сокращатели | bit.ly, tinyurl.com, cutt.ly, rb.gy, is.gd, v.gd, shorturl.at |
| Партнёрские сети | ClickBank, Digistore24, WarriorPlus, BuyGoods, JVZoo |
| TDS/Трекеры | Keitaro, Binom, BeMob, Voluum, clktrk, trk.as |

### 11. Schema.org / Структурированные данные

- Наличие JSON-LD
- Типы Schema: Organization, Product, WebSite, FAQ, LocalBusiness, BreadcrumbList
- Бонус легитимности: +10 за JSON-LD, +10 за Organization, +5 за Breadcrumbs, +5 за FAQ

### 12. Метрики страницы

- Количество слов
- Всего ссылок / внешние ссылки / домены исходящих ссылок
- Количество форм, изображений, скриптов, iframe
- Заголовок страницы, мета-описание
- OpenGraph теги (og:title, og:description, og:image, og:type)
- Определение языка (ru/en по распределению символов)

---

## Level 2: Внешние API

### 13. Google PageSpeed Insights

- **API**: `googleapis.com/pagespeedonline/v5`
- **Ключ**: Не требуется (опционально для увеличения квоты)
- **Таймаут**: 15 сек
- **Метрики**: Performance Score (0-100), FCP, LCP, CLS, Speed Index, TBT
- **Стратегия**: Mobile

### 14. Wayback Machine

- **API**: `web.archive.org/cdx/search/cdx`
- **Ключ**: Не требуется
- **Таймаут**: 3 сек на запрос, 2 запроса параллельно
- **Метрики**: Даты первого/последнего снэпшота, возраст домена по архиву (дни)

### 15. Google Safe Browsing

- **API**: `safebrowsing.googleapis.com/v4/threatMatches:find`
- **Ключ**: `GOOGLE_SAFE_BROWSING_KEY` (бесплатно, 10K запросов/день)
- **Таймаут**: 5 сек
- **Проверяемые угрозы**: Malware, Social Engineering, Unwanted Software, Potentially Harmful Application
- **Пропускается если ключ не задан**

### 16. VirusTotal

- **API**: `virustotal.com/api/v3/domains`
- **Ключ**: `VIRUSTOTAL_API_KEY` (бесплатно, 4 запроса/мин)
- **Таймаут**: 10 сек
- **Метрики**: Malicious/suspicious/harmless детекции, репутация, категории домена
- **Пропускается если ключ не задан**

---

## Формула итогового скора риска

```
Content Risk Score = min(100,
    keyword_risk       * 0.25    (серые ключевые слова)
  + (100 - compliance) * 0.20    (отсутствие обязательных страниц)
  + structure_risk     * 0.20    (красные флаги в структуре)
  + redirect_risk      * 0.10    (цепочка редиректов)
  + tld_risk           * 0.10    (рискованный TLD)
  + link_reputation    * 0.10    (подозрительные ссылки)
  + (100 - security)   * 0.05    (отсутствие заголовков безопасности)
)
```

Compliance скор получает бонус за структурированные данные Schema.org (до +30).

---

## API эндпоинты

| Метод | Эндпоинт | Доступ | Описание |
|---|---|---|---|
| POST | `/domains/:domain/content-analysis` | Админ | Сканирование одного домена (работает для любого, не только из БД) |
| POST | `/domains/content-analysis/scan` | Админ | Пакетное сканирование до 20 доменов из БД |
| GET | `/domains/:domain` | Авторизация | Детали домена (включает `content_analysis` если есть) |

## Telegram бот

```
/scan example.com
```

Возвращает полный анализ со скорами риска, ключевыми словами, compliance, красными флагами, редиректами.

## Интеграция с LLM

Каждый анализ генерирует:
- `analysis_summary` — текстовый отчёт для вставки в AI промпт
- `llm_context` — структурированный JSON со всеми метриками для программного AI-анализа

## Автоматизация

- Запускается после обогащения доменов каждые 6 часов
- Анализирует до 10 доменов за цикл
- Переанализирует домены, не сканированные более 7 дней
