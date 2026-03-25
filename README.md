# CTS Anti-Fraud Analytics

Internal platform for Google Ads campaign monitoring, ban prediction, and anti-fraud intelligence. Built for a media buying team running Google Ads through anti-detect browsers.

## Architecture

```
Chrome Extension (in anti-detect browser)
  │ Intercepts Google Ads XHR/fetch responses
  ▼
Fastify Backend (collector + API)
  │ Validates, normalizes, stores
  ▼
PostgreSQL (structured data + raw payloads)
  │
  ├── React Dashboard (visualization + analytics)
  ├── ML Engine (TypeScript logistic regression, ban prediction)
  └── AI Analysis (Claude/GPT/Gemini multi-model comparison)
```

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `packages/shared` | TypeScript types, enums, constants | ✅ Complete |
| `packages/server` | Fastify backend + Knex migrations + ML/AI | ✅ Complete |
| `packages/extension` | Chrome Extension MV3 | ✅ Complete |
| `packages/web` | React + Tailwind dashboard | ✅ Complete |

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example packages/server/.env
# Edit .env — set DATABASE_URL and API_KEY

# Create database and run migrations
createdb cts_antifraud
npm run dev:server  # migrations run automatically

# Start dashboard (separate terminal)
npm run dev:web

# Build extension
npm run build -w packages/extension
# Load packages/extension/dist/ as unpacked extension in anti-detect browser
```

## Docker

```bash
docker-compose up -d
# Server on http://localhost:3000 with PostgreSQL
```

## Development Commands

```bash
npm run dev:server          # Start Fastify dev server
npm run dev:web             # Start Vite dev server
npm run build               # Build all packages
npm run lint                # ESLint across all packages
npm run typecheck           # TypeScript check
npm run test                # Run tests (vitest)
npm run migrate -w packages/server  # Run migrations manually
```

## Key Features

- **Data Collection**: Chrome Extension intercepts Google Ads responses (no API required)
- **22 RPC Parsers**: Accounts, campaigns, billing, keywords, notifications, ads, and more
- **Ban Detection**: Auto-detects suspended accounts, creates ban records with snapshots
- **8 Killer Features**: Competitive intelligence, creative decay, spend velocity, ban chains, timing heatmap, consumable scoring, safe page score, post-mortem
- **ML Predictions**: TypeScript logistic regression with 26 features, auto-scoring
- **AI Analysis**: Multi-model comparison (Claude, GPT, Gemini) with leaderboard
- **Risk Assessment**: Pre-launch scoring combining domain, account, BIN, vertical
- **Anti-Detect Support**: Octium, Dolphin Anty, AdsPower, GoLogin, Octo Browser, Multilogin

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) — setup, configuration, production
- [API Reference](docs/API.md) — all 60+ endpoints
- [Product Vision](docs/VISION.md) — roadmap and strategy
- [Architecture Decisions](docs/ADR.md) — technical rationale
- [Audit Report](docs/AUDIT_REPORT.md) — spec compliance and code review
