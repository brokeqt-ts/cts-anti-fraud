# Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL 15+
- npm 9+

## Local Development

### 1. Clone and install

```bash
git clone <repo-url>
cd cts-antifraud
npm install
```

### 2. Configure environment

```bash
cp .env.example packages/server/.env
```

Edit `packages/server/.env` — set `DATABASE_URL` and `API_KEY` at minimum.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `API_KEY` | Yes | — | Shared secret for extension ↔ server auth |
| `PORT` | No | `3000` | HTTP listen port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `LOG_LEVEL` | No | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |
| `ANTHROPIC_API_KEY` | No | — | Claude API key (for AI analysis endpoints) |
| `OPENAI_API_KEY` | No | — | OpenAI API key (for multi-model comparison) |
| `GEMINI_API_KEY` | No | — | Google Gemini API key (for multi-model comparison) |

### 3. Create database

```bash
createdb cts_antifraud
# Or via psql:
# psql -c "CREATE DATABASE cts_antifraud;"
```

### 4. Run migrations

Migrations run automatically on server start. To run manually:

```bash
npm run migrate -w packages/server
```

### 5. Start development servers

```bash
# Terminal 1 — API server (port 3000)
npm run dev:server

# Terminal 2 — Web dashboard (port 5173)
npm run dev:web
```

### 6. Build Chrome Extension

```bash
npm run build -w packages/extension
```

Load `packages/extension/dist/` as an unpacked extension in your anti-detect browser.

## Production Deployment

### Build all packages

```bash
npm ci
npm run build
```

This builds:
- `packages/shared/dist/` — shared types
- `packages/server/dist/` — compiled server
- `packages/web/dist/` — static dashboard (served by Fastify)
- `packages/extension/dist/` — Chrome extension

### Start server

```bash
cd packages/server
NODE_ENV=production node dist/index.js
```

The server:
- Runs Knex migrations on startup
- Serves the API at `/api/v1/`
- Serves the web dashboard at `/` (if `packages/web/dist/` exists)
- Starts background tasks (domain enrichment, auto-ban detection, ML scoring, MV refresh)

### Docker

See `Dockerfile` and `docker-compose.yml` in the project root.

```bash
docker-compose up -d
```

This starts PostgreSQL and the server. The web dashboard is bundled into the server image.

## Testing

### Unit tests (no database required)

```bash
npx vitest run
```

### Integration tests (requires PostgreSQL)

```bash
export TEST_DATABASE_URL=postgresql://test:test@localhost:5432/cts_test
createdb cts_test
npx vitest run
```

Integration tests auto-skip when `TEST_DATABASE_URL` is not set.

## Background Tasks

The server runs these automated tasks:

| Task | Delay | Interval | Description |
|---|---|---|---|
| Domain enrichment | 30s | 6h | WHOIS/SSL/page checks for new domains |
| Auto-ban detection | 15s | — | Catches suspended accounts missed by extension |
| MV refresh | 30s | 1h | Refreshes materialized views for analytics |
| ML batch scoring | 60s | 6h | Re-scores all accounts with latest model |

## Chrome Extension Setup

1. Build: `npm run build -w packages/extension`
2. Open anti-detect browser → Extensions → Developer mode
3. "Load unpacked" → select `packages/extension/dist/`
4. Click extension icon → enter server URL and API key
5. Navigate to `ads.google.com` — data collection starts automatically

The extension works with: Octium, Mimic (Multilogin), Dolphin Anty, AdsPower, GoLogin, Octo Browser.
