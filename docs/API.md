# API Reference

Base URL: `/api/v1`

All endpoints (except `/health`) require the `X-API-Key` header.

## Authentication

```
X-API-Key: <shared-secret>
```

Missing or invalid key returns `401`:
```json
{ "error": "Unauthorized", "code": "UNAUTHORIZED" }
```

## Error Format

```json
{
  "error": "Human-readable message",
  "code": "MACHINE_CODE",
  "details": {}
}
```

---

## Health

### `GET /health`

Server status and database connectivity. **No auth required.**

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "database": { "connected": true, "latency_ms": 2 },
  "last_data_received": "2026-02-28T12:00:00Z"
}
```

---

## Collect (Extension → Server)

### `POST /collect`

Chrome extension posts intercepted Google Ads data.

**Body:**
```json
{
  "profile_id": "profile-abc",
  "antidetect_browser": "octium",
  "proxy_info": {
    "ip": "1.2.3.4",
    "geo": "US",
    "org": "ISP Name",
    "asn": "AS12345"
  },
  "extension_version": "0.1.1",
  "batch": [
    {
      "type": "account",
      "timestamp": "2026-02-28T12:00:00Z",
      "data": {}
    }
  ]
}
```

**Batch item types:** `account`, `campaign`, `performance`, `billing`, `ad_review`, `status_change`, `billing_request`, `raw`, `raw_text`

**Response (200):**
```json
{ "status": "ok", "processed": 5 }
```

---

## Accounts

### `GET /accounts`

List all Google Ads accounts.

**Query:** `search`, `status`, `currency`, `limit` (default 50), `offset` (default 0)

### `GET /accounts/:google_id`

Full account detail with campaigns, billing, signals, keywords, quality scores.

### `PATCH /accounts/:google_id`

Update account metadata.

### `POST /accounts/:google_id/consumables`

Add a consumable to account.

### `DELETE /accounts/:google_id/consumables/:id`

Remove a consumable.

### `GET /accounts/:google_id/competitive-intelligence`

Competitor analysis for account's ad landscape.

### `GET /accounts/:google_id/quality-score`

Quality score distribution for account keywords.

### `GET /accounts/:google_id/keywords/low-quality`

List keywords with low quality scores.

### `GET /accounts/:google_id/quality-score/history`

Historical quality score trends.

---

## Bans

### `POST /bans`

Create a ban record.

**Body:**
```json
{
  "account_google_id": "123-456-7890",
  "ban_date": "2026-02-28",
  "ban_target": "account",
  "ban_reason_google": "Circumventing systems",
  "ban_reason_internal": "Domain flagged",
  "offer_vertical": "gambling",
  "domain": "example.com",
  "campaign_type": "pmax"
}
```

**ban_target:** `account`, `domain`, `campaign`, `ad`
**offer_vertical:** `gambling`, `nutra`, `crypto`, `dating`, `sweepstakes`, `ecom`, `finance`, `other`

### `GET /bans`

List all ban records.

### `GET /bans/:id`

Get ban record detail.

### `PATCH /bans/:id`

Update ban record metadata.

---

## Domains

### `GET /domains`

List all domains from ads with enrichment data.

### `GET /domains/:domain`

Domain detail with linked accounts and bans.

**Response:**
```json
{
  "domain": { "domain_name": "example.com", "ssl": true, "age_days": 365, "..." },
  "accounts": [],
  "bans": []
}
```

---

## Stats

### `GET /stats/overview`

Platform-wide statistics.

**Response:**
```json
{
  "total_accounts": 50,
  "total_bans": 12,
  "active_accounts": 38,
  "suspended_accounts": 8,
  "at_risk_accounts": 4,
  "avg_lifetime_hours": 720,
  "bans_by_vertical": { "gambling": 5, "nutra": 3 },
  "bans_by_target": { "account": 10, "domain": 2 },
  "recent_bans": [],
  "signals_summary": {}
}
```

---

## Analytics

### `GET /analytics/ban-timing`

Ban timing heatmap (7 days × 24 hours, Monday-first).

### `GET /analytics/overview`

Analytics overview with lifetime, ban rate, churn metrics.

### `GET /analytics/spend-velocity?account_id=X`

Spending velocity for a single account.

### `GET /analytics/spend-velocity-all`

Aggregated spending velocity across all accounts.

### `GET /analytics/ban-chain?account_id=X`

Chain of related bans for an account.

### `GET /analytics/ban-chain-all`

All ban chains.

### `GET /analytics/consumable-scoring`

Consumable effectiveness scoring.

### `GET /analytics/creative-decay?account_id=X`

Ad creative decay over time.

### `POST /analytics/post-mortem/:ban_id`

Generate post-mortem analysis for a ban.

### `POST /analytics/post-mortem-all`

Post-mortem for all bans.

### `GET /analytics/competitive-intelligence`

Ad landscape competitive analysis.

### `GET /analytics/freshness`

Data freshness/staleness indicators.

### `GET /analytics/account-risk-summary`

Risk summary per account.

---

## Assessment

### `POST /assess`

Risk scoring for domain/account/BIN combination.

**Body:**
```json
{
  "domain": "example.com",
  "account_google_id": "123-456-7890",
  "bin": "411111",
  "vertical": "gambling",
  "geo": "US"
}
```

**Response:**
```json
{
  "risk_score": 72,
  "risk_level": "high",
  "factors": [
    { "category": "domain", "score": 85, "weight": 0.3, "detail": "Domain age < 30 days" }
  ],
  "recommendations": ["Use older domain", "Diversify payment methods"],
  "comparable_accounts": {
    "total": 15, "banned": 8, "ban_rate": 0.53, "avg_lifetime_days": 12
  },
  "budget_recommendation": 150
}
```

---

## CTS Sites

### `GET /cts/sites`

List CTS site links.

### `POST /cts/sites`

Create CTS site. **Body:** `{ "domain": "example.com", "external_cts_id": "..." }`

### `PATCH /cts/sites/:id`

Update CTS site.

### `DELETE /cts/sites/:id`

Remove CTS site.

### `POST /cts/sync`

Sync with external CTS service.

### `GET /cts/sites/:id/traffic`

Traffic metrics for a CTS site.

### `POST /cts/sites/:id/link`

Link CTS site to a Google Ads account.

---

## AI Analysis

*Requires `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY`, `GEMINI_API_KEY` for multi-model).*

### `POST /ai/analyze/:accountId`

Run AI analysis on account patterns.

### `POST /ai/analyze-ban/:banLogId`

AI analysis of a specific ban event.

### `POST /ai/compare`

Compare multiple accounts. **Body:** `{ "account_ids": ["id1", "id2"] }`

### `GET /ai/history/:accountId`

Historical AI analyses for account.

### `POST /ai/compare-models/:accountId`

Compare predictions across AI models (Claude, GPT, Gemini).

### `GET /ai/leaderboard`

AI model accuracy rankings.

### `GET /ai/leaderboard/history`

Historical leaderboard data.

### `GET /ai/models`

List configured AI models and their availability.

---

## ML Predictions

### `POST /ml/train`

Train/retrain ban prediction model from historical data.

### `GET /ml/predict/:accountId`

Get ban probability prediction for account.

**Response:**
```json
{
  "ban_probability": 0.73,
  "risk_level": "high",
  "confidence": 0.85,
  "top_factors": [
    { "feature": "account_age_days", "label": "Account age", "contribution": 0.42, "value": 5, "direction": "increases_risk" }
  ],
  "predicted_days_to_ban": 7
}
```

### `POST /ml/predict-all`

Batch prediction for all active accounts.

### `GET /ml/summary`

Prediction distribution summary.

### `GET /ml/history/:accountId`

Historical predictions for account.

### `GET /ml/training-stats`

Training dataset statistics (sample counts, feature distributions).

### `GET /ml/training-export`

Export training data as CSV.

### `POST /ml/bootstrap`

Bootstrap/initialize ML training pipeline.

---

## Admin

### `GET /admin/raw-analysis`

Analyze raw payloads from extension.

### `GET /admin/rpc-payloads`

List raw RPC payloads.

### `POST /admin/backfill-parsers`

Re-parse all payloads with current parser versions.

### `POST /admin/reset-parsed-data`

Clear parsed data (keeps raw payloads).

### `POST /admin/merge-account`

Merge duplicate account records.

### `GET /admin/parsed-data`

View parsed data summary.

### `POST /admin/detect-bans`

Run ban detection on suspended accounts.

### `GET /admin/gap-diagnostics`

Data gap analysis report.

### `POST /admin/enrich-domains`

Re-run domain enrichment.

### `GET /admin/raw-payloads`

List raw payloads with pagination.

### `GET /admin/raw-payloads/:id`

Get raw payload detail.
