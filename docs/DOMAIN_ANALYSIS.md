# Domain Content Analyzer — Полный список проверок

> Обновлено: 2026-03-26
> Сервис: `packages/server/src/services/domain-content-analyzer.ts` + `domain-external-apis.ts`
> Всего проверок: **26**

---

## Локальный анализ HTML (12 проверок, без API)

| # | Модуль | Что проверяет |
|---|---|---|
| 1 | **Серые ключевые слова** | 150+ ключей по 7 вертикалям (gambling, nutra, crypto, finance, sweepstakes, dating, pharma). Severity: critical/warning/info |
| 2 | **Compliance** | Privacy Policy, Terms of Service, контакты, дисклеймер, About, Cookie Consent, 18+ |
| 3 | **Структурные красные флаги** | Таймеры, фейковые отзывы, до/после, скрытый текст, агрессивные CTA, попапы, автовидео, JS-редиректы, обфусцированный eval, iframe |
| 4 | **Цепочка редиректов** | Количество хопов, смена домена, несовпадение с URL объявления |
| 5 | **HTTP заголовки безопасности** | HSTS, CSP, X-Frame-Options, X-Content-Type, Referrer-Policy, Permissions-Policy, Server |
| 6 | **Риск TLD** | .xyz/.top/.click = high, .io/.co/.me = medium, .com/.org = low |
| 7 | **robots.txt** | Блокировка Googlebot, наличие Sitemap, запрещённые пути |
| 8 | **Анализ форм** | Сбор персональных/платёжных данных, внешние form targets |
| 9 | **Сторонние скрипты** | GA, GTM, Яндекс Метрика, FB Pixel, TikTok, Google Ads, Keitaro, Binom, PropellerAds |
| 10 | **Репутация ссылок** | URL-сокращатели, affiliate сети (ClickBank, Digistore24), TDS-трекеры (Keitaro, Binom, Voluum) |
| 11 | **Schema.org** | JSON-LD, типы (Organization, Product, FAQ, Breadcrumbs), бонус легитимности |
| 12 | **Метрики страницы** | Слова, ссылки, формы, скрипты, iframe, язык, OpenGraph |

---

## Внешние API — без ключа (7 проверок)

| # | API | Что проверяет | Таймаут |
|---|---|---|---|
| 13 | **Google PageSpeed** | Performance Score (mobile), LCP, CLS, TBT | 15с |
| 14 | **Wayback Machine** | Первый/последний снэпшот, возраст домена в архиве | 3с |
| 15 | **crt.sh** | Сертификаты, поддомены, история SSL, издатели | 8с |
| 16 | **Shodan InternetDB** | Открытые порты, уязвимости, хостнеймы | 5с |
| 17 | **Spamhaus/SURBL/URIBL** | Домен/IP в спам-блоклистах (DNS lookup) | 5с |
| 18 | **CommonCrawl** | Присутствие в веб-краулах, количество страниц | 5с |
| 19 | **OpenPhish** | Проверка по фиду фишинговых URL (кеш 1ч) | 10с |

---

## Внешние API — с ключом (7 проверок)

| # | API | Переменная | Лимит | Что проверяет |
|---|---|---|---|---|
| 20 | **Google Safe Browsing** | `GOOGLE_SAFE_BROWSING_KEY` | 10K/день | Malware, фишинг, unwanted software |
| 21 | **VirusTotal** | `VIRUSTOTAL_API_KEY` | 500/день | 70+ антивирусов, репутация, категории |
| 22 | **AbuseIPDB** | `ABUSEIPDB_API_KEY` | 1K/день | Жалобы на IP, abuse score, ISP, Tor |
| 23 | **URLhaus** | — (бесплатный) | fair use | Malware URL база |
| 24 | **SerpAPI** | `SERPAPI_KEY` | 100/мес | Google индексация (`site:domain.com`) |
| 25 | **Node.js DNS** | — | локально | SPF, DKIM, DMARC, MX, CAA записи |
| 26 | **RDAP** | — | бесплатно | WHOIS данные (уже в domain-enrichment) |

---

## Формула риска

```
Content Risk = min(100,
    keywords    * 0.25
  + compliance  * 0.20   (инвертировано: 100 - score)
  + structure   * 0.20
  + redirects   * 0.10
  + tld_risk    * 0.10
  + links       * 0.10
  + security    * 0.05   (инвертировано: 100 - score)
)
```

Compliance получает бонус за Schema.org (до +30).

---

## Доступ

| Метод | Эндпоинт | Кто |
|---|---|---|
| `POST` | `/domains/:domain/content-analysis` | Админ |
| `POST` | `/domains/content-analysis/scan` | Админ (батч до 20) |
| `GET` | `/domains/:domain` | Авторизованный (включает `content_analysis`) |
| TG | `/scan domain.com` | Привязанный пользователь |

---

## Автоматизация

- Cron каждые 6ч → до 10 доменов за цикл
- Повторный анализ через 7 дней
- LLM: `analysis_summary` (текст) + `llm_context` (JSON)
