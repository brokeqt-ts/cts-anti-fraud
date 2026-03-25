# SKILL: Fastify Backend Patterns

## Overview

The server is the central data collector and API layer. It receives data from Chrome Extensions, stores it in PostgreSQL, and will later serve the dashboard and analytics.

## Project Structure

```
packages/server/
├── src/
│   ├── index.ts              # App entry point
│   ├── app.ts                # Fastify app factory (for testing)
│   ├── config/
│   │   └── env.ts            # Environment variable parsing + validation
│   ├── plugins/
│   │   ├── database.ts       # pg Pool as Fastify plugin
│   │   ├── auth.ts           # API key verification
│   │   └── rate-limit.ts     # Rate limiting config
│   ├── routes/
│   │   ├── collect.route.ts  # POST /api/v1/collect
│   │   └── health.route.ts   # GET /api/v1/health
│   ├── handlers/
│   │   ├── collect.handler.ts
│   │   └── health.handler.ts
│   ├── services/
│   │   ├── payload.service.ts   # Normalize + store extension payloads
│   │   └── account.service.ts   # Account upsert logic
│   ├── repositories/
│   │   ├── raw-payload.repo.ts
│   │   ├── account.repo.ts
│   │   └── campaign.repo.ts
│   └── utils/
│       └── logger.ts
├── knexfile.ts
├── migrations/
├── package.json
└── tsconfig.json
```

## Fastify App Factory Pattern

```typescript
// app.ts — exportable for testing
import Fastify from 'fastify';
import { envConfig } from './config/env';
import { databasePlugin } from './plugins/database';
import { authPlugin } from './plugins/auth';
import { collectRoutes } from './routes/collect.route';
import { healthRoutes } from './routes/health.route';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: envConfig.LOG_LEVEL,
      transport: envConfig.NODE_ENV === 'development' 
        ? { target: 'pino-pretty' } 
        : undefined,
    },
  });

  // Plugins
  await app.register(databasePlugin);
  await app.register(authPlugin);
  
  // Routes
  await app.register(collectRoutes, { prefix: '/api/v1' });
  await app.register(healthRoutes, { prefix: '/api/v1' });

  return app;
}
```

## JSON Schema Validation

Fastify validates request/response with JSON Schema. Define schemas alongside routes:

```typescript
// routes/collect.route.ts
const collectBodySchema = {
  type: 'object',
  required: ['profileId', 'extensionVersion', 'payloads'],
  properties: {
    profileId: { type: 'string', minLength: 1 },
    extensionVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    payloads: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['url', 'data', 'timestamp', 'source'],
        properties: {
          url: { type: 'string' },
          data: { type: 'object' },  // Raw JSON from Google Ads
          timestamp: { type: 'number' },
          source: { type: 'string', enum: ['fetch', 'xhr'] },
        },
      },
    },
  },
} as const;
```

## Database Plugin

```typescript
// plugins/database.ts
import fp from 'fastify-plugin';
import { Pool } from 'pg';

export const databasePlugin = fp(async (app) => {
  const pool = new Pool({ connectionString: app.config.DATABASE_URL });
  
  // Verify connection
  await pool.query('SELECT 1');
  
  app.decorate('db', pool);
  app.addHook('onClose', () => pool.end());
});
```

## Auth Plugin (simple API key)

```typescript
// plugins/auth.ts
import fp from 'fastify-plugin';

export const authPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check
    if (request.url === '/api/v1/health') return;
    
    const apiKey = request.headers['x-api-key'];
    if (apiKey !== app.config.API_KEY) {
      reply.code(401).send({ error: 'Unauthorized', code: 'INVALID_API_KEY' });
    }
  });
});
```

## Error Handling

Consistent error format across all endpoints:

```typescript
interface ApiError {
  error: string;        // Human-readable message
  code: string;         // Machine-readable code (VALIDATION_ERROR, NOT_FOUND, etc.)
  details?: unknown;    // Optional additional context
}
```

## Collector Endpoint Logic

1. Receive batch from extension
2. Validate schema (Fastify does this automatically)
3. Store raw payloads in `raw_payloads` table (ALWAYS — even if parsing fails)
4. Attempt to extract and upsert structured data:
   - Account info → `accounts` table (upsert by google_account_id)
   - Campaign data → `campaigns` table (upsert by campaign + account)
   - Billing → `payment_methods` table
5. Return success with count of processed items

**Critical:** Never fail the whole batch if one payload fails to parse. Process each independently, log errors, return partial success.
