# Domain Content Analyzer — Full Check List

> Last updated: 2026-03-26
> Service: `packages/server/src/services/domain-content-analyzer.ts`

---

## Level 1: Local HTML Analysis (no external APIs)

### 1. Grey Keywords Scanner (150+ keywords, 7 verticals)

| Vertical | Example Keywords |
|---|---|
| Gambling | casino, slots, betting, ставки, рулетка, jackpot, free spins, 1xbet, pin-up, покер |
| Nutra | похудение, weight loss, clinically proven, FDA approved, до и после, -30 кг, fat burner |
| Crypto | guaranteed returns, passive income, auto-trading, bitcoin investment, 100% profit |
| Finance | instant loan, guaranteed approval, no credit check, займ без отказа, микрозайм |
| Sweepstakes | you have won, claim your prize, free iphone, spin the wheel, вы выиграли |
| Dating | hookup, adult dating, hot singles, знакомства без обязательств |
| Pharma | buy without prescription, online pharmacy, cheap viagra, без рецепта |
| Generic | limited time only, осталось мест, последний шанс, exclusive offer |

Severity levels: `critical` (20 pts), `warning` (10 pts), `info` (3 pts).

### 2. Compliance Checker

| Check | Points |
|---|---|
| Privacy Policy | +25 |
| Terms of Service | +20 |
| Contact Info (email, phone, address) | +20 |
| Disclaimer | +15 |
| About Page | +10 |
| Cookie Consent (GDPR) | +5 |
| Age Verification (18+/21+) | +5 |

Score: 0-100, higher = more compliant.

### 3. Structural Red Flags

| Flag | Severity | Description |
|---|---|---|
| Countdown timer | warning | Urgency pressure tactic |
| Fake reviews | warning | 3+ identical star rating patterns |
| Before/After | warning | Requires disclaimers for Google Ads |
| Hidden text | critical | CSS: color=transparent, font-size:0, text-indent:-9999 |
| Aggressive CTA | info | 3+ buy-now buttons |
| Popup/overlay | warning | position:fixed + high z-index |
| Auto-play video | info | `<video autoplay>` |
| JS redirect | critical | `window.location` to external URL |
| Obfuscated JS | critical | `eval(atob(...))` / `eval(unescape(...))` |
| Excessive iframes | warning | 3+ iframes |

### 4. Redirect Chain Analysis

- Hop count (>2 hops = +15 per hop)
- Domain change across chain (+20)
- URL mismatch with declared ad URL (+30)
- >5 hops = 60+ score

### 5. HTTP Security Headers

| Header | Points |
|---|---|
| Strict-Transport-Security (HSTS) | +25 |
| Content-Security-Policy (CSP) | +25 |
| X-Frame-Options | +15 |
| X-Content-Type-Options | +10 |
| Referrer-Policy | +15 |
| Permissions-Policy | +10 |

Also captures: `Server` header, `X-Powered-By`.

### 6. TLD Risk Scoring

| Risk | Score | TLDs |
|---|---|---|
| High | 80 | .xyz, .top, .click, .club, .icu, .buzz, .gq, .cf, .tk, .ml, .ga, .monster, .sbs |
| Medium | 40 | .io, .co, .me, .cc, .biz, .info, .site, .online, .store, .shop, .live, .space |
| Low | 5 | .com, .org, .net, .edu, .gov, .mil |
| Country | 15 | 2-letter country TLDs (.de, .uk, .ru, etc.) |

### 7. robots.txt Analysis

- File exists
- Blocks Googlebot (Disallow: / for Googlebot)
- Blocks all bots (Disallow: / for *)
- Sitemap presence and URLs
- Disallowed paths list

### 8. Form Target Analysis

- Form count and methods (GET/POST)
- Personal data collection (email, phone, name, address fields)
- Payment data collection (card, cvv, billing fields)
- External form action targets (different domain)

### 9. Third-party Script Cataloger

| Category | Scripts Detected |
|---|---|
| Analytics | Google Analytics, GTM, Yandex Metrica (src + inline patterns) |
| Advertising | Facebook Pixel, TikTok Pixel, Google Ads, AdSense, LinkedIn Insight |
| Suspicious | Keitaro TDS, Binom TDS, PropellerAds, ExoClick, Clickadu, TrafficJunky |
| CDN | Cloudflare CDN, jsDelivr, UNPKG, Google CDN |

Inline detection: `gtag()`, `fbq()`, `ym()`, TDS redirect patterns.

### 10. External Link Reputation

| Type | Domains Checked |
|---|---|
| URL Shorteners | bit.ly, tinyurl.com, cutt.ly, rb.gy, is.gd, v.gd, shorturl.at |
| Affiliate Networks | ClickBank, Digistore24, WarriorPlus, BuyGoods, JVZoo |
| TDS/Trackers | Keitaro, Binom, BeMob, Voluum, clktrk, trk.as |

### 11. Schema.org / Structured Data

- JSON-LD presence
- Schema types: Organization, Product, WebSite, FAQ, LocalBusiness, BreadcrumbList
- Legitimacy bonus: +10 JSON-LD, +10 Organization, +5 Breadcrumbs, +5 FAQ

### 12. Page Metrics

- Word count
- Total links / external links / outbound domains
- Form, image, script, iframe counts
- Page title, meta description
- OpenGraph tags (og:title, og:description, og:image, og:type)
- Language detection (ru/en based on character distribution)

---

## Level 2: External APIs

### 13. Google PageSpeed Insights

- **API**: `googleapis.com/pagespeedonline/v5`
- **Key**: Not required (optional for higher quota)
- **Timeout**: 15s
- **Metrics**: Performance Score (0-100), FCP, LCP, CLS, Speed Index, TBT
- **Strategy**: Mobile

### 14. Wayback Machine

- **API**: `web.archive.org/cdx/search/cdx`
- **Key**: Not required
- **Timeout**: 3s per request, 2 parallel requests
- **Metrics**: First/last snapshot dates, domain archive age (days)

### 15. Google Safe Browsing

- **API**: `safebrowsing.googleapis.com/v4/threatMatches:find`
- **Key**: `GOOGLE_SAFE_BROWSING_KEY` (free, 10K req/day)
- **Timeout**: 5s
- **Threats checked**: Malware, Social Engineering, Unwanted Software, Potentially Harmful Application
- **Skipped if key not set**

### 16. VirusTotal

- **API**: `virustotal.com/api/v3/domains`
- **Key**: `VIRUSTOTAL_API_KEY` (free, 4 req/min)
- **Timeout**: 10s
- **Metrics**: Malicious/suspicious/harmless detections, reputation score, domain categories
- **Skipped if key not set**

---

## Composite Risk Score Formula

```
Content Risk Score = min(100,
    keyword_risk     * 0.25
  + (100 - compliance) * 0.20
  + structure_risk   * 0.20
  + redirect_risk    * 0.10
  + tld_risk         * 0.10
  + link_reputation  * 0.10
  + (100 - security) * 0.05
)
```

Compliance score includes Schema.org legitimacy bonus (up to +30).

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/domains/:domain/content-analysis` | Admin | Scan single domain (works for any domain, not just DB) |
| POST | `/domains/content-analysis/scan` | Admin | Batch scan up to 20 domains from DB |
| GET | `/domains/:domain` | Auth | Domain detail (includes `content_analysis` if available) |

## Telegram Bot

```
/scan example.com
```

Returns full analysis with risk scores, keywords, compliance, red flags, redirects.

## LLM Integration

Each analysis generates:
- `analysis_summary` — human-readable text report for AI prompt injection
- `llm_context` — structured JSON with all metrics for programmatic AI analysis

## Automation

- Runs after domain enrichment cron (every 6 hours)
- Analyzes up to 10 domains per cycle
- Re-analyzes domains not scanned in 7+ days
