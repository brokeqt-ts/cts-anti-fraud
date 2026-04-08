import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import bcrypt from 'bcrypt';
import type pg from 'pg';
import knexLib from 'knex';
import { env } from './config/env.js';
import { getPool } from './config/database.js';
import knexConfig from './config/knexfile.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { collectRoutes } from './routes/collect.js';
import { healthRoutes } from './routes/health.js';
import { adminRoutes } from './routes/admin.js';
import { bansRoutes } from './routes/bans.js';
import { accountsRoutes } from './routes/accounts.js';
import { statsRoutes } from './routes/stats.js';
import { domainsRoutes } from './routes/domains.js';
import { ctsRoutes } from './routes/cts.js';
import { analyticsRoutes } from './routes/analytics.js';
import { assessmentRoutes } from './routes/assessment.js';
import { mlRoutes } from './routes/ml.js';
import { aiRoutes } from './routes/ai.js';
import { extensionRoutes } from './routes/extension.js';
import { notificationsRoutes } from './routes/notifications.js';
import { telegramRoutes } from './routes/telegram.js';
import { bestPracticesRoutes } from './routes/best-practices.js';
import { searchRoutes } from './routes/search.js';
import { tagsRoutes } from './routes/tags.js';
import { CollectService } from './services/collect.service.js';
import { runDomainEnrichmentCycle } from './services/domain-enrichment.service.js';
import { analyzeAllDomains } from './services/domain-content-analyzer.js';
import { scanAllSuspendedAccounts } from './services/auto-ban-detector.js';
import { MaterializedViewService } from './services/materialized-view.service.js';
import { batchPredictAll } from './services/ai/auto-scoring.service.js';

import { scoreSurvivedAccounts } from './services/ai/leaderboard.service.js';
import { deleteOldNotifications } from './services/notification.service.js';
import { startBotPolling, stopBotPolling, registerBotCommands } from './services/telegram-bot.service.js';
import { snapshotCreativePerformance, runDecayScanWithAlerts } from './services/creative-decay.service.js';
import { runMlRetrain } from './services/ml-auto-retrain.service.js';
import { API_PREFIX, RATE_LIMIT_PER_MINUTE } from '@cts/shared';
import './types.js';

const MAX_MIGRATION_RETRIES = 3;
const MIGRATION_RETRY_DELAY_MS = 2000;

/** Run an async task with retry on failure. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 5000): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

async function syncAdminPassword(pool: pg.Pool): Promise<void> {
  const isDev = env.NODE_ENV !== 'production';
  const forceReset = process.env['FORCE_ADMIN_PASSWORD_RESET'] === 'true';
  if (!isDev && !forceReset) return;
  const password = env.ADMIN_PASSWORD;
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE users SET password_hash = $1 WHERE email = 'admin@cts.local'`,
    [hash],
  );
  console.log('[startup] Admin password synced from ADMIN_PASSWORD env var');
}

async function runMigrations(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_MIGRATION_RETRIES; attempt++) {
    const knex = knexLib(knexConfig);
    try {
      const [batch, migrations] = await knex.migrate.latest();
      if ((migrations as string[]).length > 0) {
        console.log(`Ran ${(migrations as string[]).length} migrations (batch ${batch})`);
      } else {
        console.log('Database schema is up to date');
      }
      return; // Success — exit retry loop
    } catch (err) {
      console.error(`Migration attempt ${attempt}/${MAX_MIGRATION_RETRIES} failed:`, err instanceof Error ? err.message : err);
      if (attempt === MAX_MIGRATION_RETRIES) {
        throw err; // All retries exhausted — propagate to caller
      }
      console.log(`Retrying in ${MIGRATION_RETRY_DELAY_MS}ms...`);
      await new Promise((resolve) => setTimeout(resolve, MIGRATION_RETRY_DELAY_MS));
    } finally {
      await knex.destroy();
    }
  }
}

export interface BuildAppOptions {
  /** Override DATABASE_URL for testing */
  databaseUrl?: string;
  /** Override API_KEY for testing */
  apiKey?: string;
  /** Disable logging (for tests) */
  silent?: boolean;
}

export async function buildApp(options?: BuildAppOptions) {
  const dbUrl = options?.databaseUrl ?? env.DATABASE_URL;

  const fastify = Fastify({
    logger: options?.silent
      ? false
      : { level: env.LOG_LEVEL },
    bodyLimit: 50 * 1024 * 1024, // 50 MB — Google Ads intercepts produce large payloads
  });

  // CORS — allow all origins (internal tool, extensions send cross-origin)
  await fastify.register(cors, { origin: true });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return (request.headers['x-profile-id'] as string) ?? request.ip;
    },
  });

  // Auth plugin
  await fastify.register(authPlugin);

  // Services
  const pool = getPool(dbUrl);
  const collectService = new CollectService(pool);
  fastify.decorate('collectService', collectService);

  // API Routes
  await fastify.register(
    async (instance) => {
      await instance.register(authRoutes);
      await instance.register(collectRoutes);
      await instance.register(healthRoutes);
      await instance.register(adminRoutes);
      await instance.register(bansRoutes);
      await instance.register(accountsRoutes);
      await instance.register(statsRoutes);
      await instance.register(domainsRoutes);
      await instance.register(ctsRoutes);
      await instance.register(analyticsRoutes);
      await instance.register(assessmentRoutes);
      await instance.register(mlRoutes);
      await instance.register(aiRoutes);
      await instance.register(extensionRoutes);
      await instance.register(notificationsRoutes);
      await instance.register(telegramRoutes);
      await instance.register(bestPracticesRoutes);
      await instance.register(searchRoutes);
      await instance.register(tagsRoutes);
    },
    { prefix: API_PREFIX },
  );

  // Serve web dashboard static files (production) — MUST be after API routes
  // __dirname is available in CJS; for compiled output it points to dist/
  const webDistPath = path.resolve(__dirname, '..', '..', 'web', 'dist');
  const indexHtmlPath = path.join(webDistPath, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

    // Serve /assets/* explicitly from dist/assets/ — Vite puts all JS/CSS chunks here.
    // Using a dedicated prefix instead of a root wildcard guarantees correct MIME types
    // regardless of platform proxy behaviour.
    await fastify.register(fastifyStatic, {
      root: path.join(webDistPath, 'assets'),
      prefix: '/assets/',
      decorateReply: true,
    });

    // SPA fallback — everything else that is not an API route gets index.html
    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.status(404).send({ error: 'Not found', code: 'NOT_FOUND' });
      }
      return reply.type('text/html').send(indexHtml);
    });
  }

  return fastify;
}

async function start() {
  try {
    await runMigrations();
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }

  // Warn if legacy API_KEY is set in production — it grants admin access without audit trail
  if (env.NODE_ENV === 'production' && env.API_KEY) {
    console.warn(
      '[SECURITY] Legacy API_KEY is set in production. ' +
      'Any request using this key gets admin access with no audit log entry. ' +
      'Migrate all clients to per-user API keys and remove API_KEY from env.',
    );
  }

  const app = await buildApp();

  try {
    const pool = getPool(env.DATABASE_URL);
    await syncAdminPassword(pool);
  } catch (err) {
    console.warn('[startup] Could not sync admin password:', err instanceof Error ? err.message : err);
  }

  if (process.env['RUN_SEED'] === 'true') {
    try {
      console.log('[startup] RUN_SEED=true — running synthetic data seed...');
      const { runSeed } = await import('./scripts/seed-synthetic.js');
      const seedPool = getPool(env.DATABASE_URL);
      await runSeed(seedPool);
      console.log('[startup] Seed complete. Remove RUN_SEED to skip on next deploy.');
    } catch (err) {
      console.warn('[startup] Seed failed:', err instanceof Error ? err.message : err);
    }
  }

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // --- Telegram Bot: start polling + register commands ---
  startBotPolling();
  registerBotCommands().catch((err) =>
    app.log.error('[telegram] Command registration failed: %s', err instanceof Error ? err.message : err),
  );

  // --- Automation: Background tasks ---
  const pool = getPool(env.DATABASE_URL);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];

  // АВТОМАТИЗАЦИЯ 2: Domain enrichment — 30s after start, then every 6 hours
  timers.push(setTimeout(() => {
    app.log.info('[cron] Initial domain enrichment cycle starting...');
    runDomainEnrichmentCycle(pool)
      .then((r) => app.log.info(`[cron] Initial enrichment: collected=${r.collected}, enriched=${r.enriched}, errors=${r.errors}`))
      .catch((err) => app.log.error('[cron] Initial enrichment failed: %s', err instanceof Error ? err.message : err));
  }, 30_000));

  intervals.push(setInterval(() => {
    app.log.info('[cron] Periodic domain enrichment cycle starting...');
    withRetry(() => runDomainEnrichmentCycle(pool))
      .then((r) => {
        app.log.info(`[cron] Enrichment: collected=${r.collected}, enriched=${r.enriched}, errors=${r.errors}`);
        return analyzeAllDomains(pool, 10);
      })
      .then((r) => app.log.info(`[cron] Domain content analysis: analyzed=${r.analyzed}, errors=${r.errors}`))
      .catch((err) => app.log.error('[cron] Enrichment failed after retries: %s', err instanceof Error ? err.message : err));
  }, 6 * 60 * 60 * 1000)); // Every 6 hours

  // АВТОМАТИЗАЦИЯ ML: Weekly retrain — every 7 days
  intervals.push(setInterval(() => {
    app.log.info('[cron] Weekly ML retrain starting...');
    runMlRetrain(pool, app.log, 'weekly_schedule')
      .catch((err) => app.log.error('[cron] Weekly ML retrain failed: %s', err instanceof Error ? err.message : err));
  }, 7 * 24 * 60 * 60 * 1000)); // Every 7 days

  // АВТОМАТИЗАЦИЯ 3: Catch-up scan for suspended accounts (auto-ban + post-mortem)
  timers.push(setTimeout(() => {
    app.log.info('[cron] Scanning for missed suspended accounts...');
    scanAllSuspendedAccounts(pool)
      .then((r) => {
        if (r.created > 0) {
          app.log.info(`[cron] Auto-ban catch-up: scanned=${r.scanned}, created=${r.created}, skipped=${r.skipped}`);
        }
      })
      .catch((err) => app.log.error('[cron] Auto-ban scan failed: %s', err instanceof Error ? err.message : err));
  }, 15_000));

  // АВТОМАТИЗАЦИЯ 5: Materialized views — refresh for analytics dashboard
  const mvService = new MaterializedViewService(pool);

  timers.push(setTimeout(() => {
    app.log.info('[cron] Initial materialized view refresh starting...');
    mvService.refreshAll()
      .then((results) => {
        const ok = results.filter(r => r.success).length;
        const total = results.length;
        const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
        app.log.info(`[cron] MV initial refresh: ${ok}/${total} succeeded in ${totalMs}ms`);
      })
      .catch((err) => app.log.error('[cron] MV initial refresh failed: %s', err instanceof Error ? err.message : err));
  }, 30_000));

  intervals.push(setInterval(() => {
    app.log.info('[cron] Hourly materialized view refresh starting...');
    mvService.refreshAll()
      .then((results) => {
        const ok = results.filter(r => r.success).length;
        const total = results.length;
        const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
        app.log.info(`[cron] MV hourly refresh: ${ok}/${total} succeeded in ${totalMs}ms`);
      })
      .catch((err) => app.log.error('[cron] MV hourly refresh failed: %s', err instanceof Error ? err.message : err));
  }, 60 * 60 * 1000)); // Every hour

  // АВТОМАТИЗАЦИЯ ML: Batch prediction — score all accounts every 6 hours
  timers.push(setTimeout(() => {
    app.log.info('[cron] Initial batch prediction starting...');
    batchPredictAll(pool)
      .then((r) => {
        if (r.scored > 0) {
          app.log.info(`[cron] Batch prediction: total=${r.total}, scored=${r.scored}, high_risk=${r.high_risk}`);
        }
      })
      .catch((err) => app.log.error('[cron] Batch prediction failed: %s', err instanceof Error ? err.message : err));
  }, 60_000)); // 1 minute after start

  intervals.push(setInterval(() => {
    app.log.info('[cron] Periodic batch prediction starting...');
    batchPredictAll(pool)
      .then((r) => {
        if (r.scored > 0) {
          app.log.info(`[cron] Batch prediction: total=${r.total}, scored=${r.scored}, high_risk=${r.high_risk}`);
        }
      })
      .catch((err) => app.log.error('[cron] Batch prediction failed: %s', err instanceof Error ? err.message : err));
  }, 6 * 60 * 60 * 1000)); // Every 6 hours

  // NOTIFICATIONS: Cleanup old notifications — daily
  intervals.push(setInterval(() => {
    deleteOldNotifications(pool, 30)
      .then((count) => {
        if (count > 0) {
          app.log.info(`[cron] Deleted ${count} old notifications (>30 days)`);
        }
      })
      .catch((err) => app.log.error('[cron] Notification cleanup failed: %s', err instanceof Error ? err.message : err));
  }, 24 * 60 * 60 * 1000)); // Every 24 hours

  // LEADERBOARD: Score survived accounts (>90 days without ban) — daily
  intervals.push(setInterval(() => {
    scoreSurvivedAccounts(pool)
      .then((count) => {
        if (count > 0) {
          app.log.info(`[cron] Scored ${count} survived account predictions`);
        }
      })
      .catch((err) => app.log.error('[cron] Survived scoring failed: %s', err instanceof Error ? err.message : err));
  }, 24 * 60 * 60 * 1000)); // Every 24 hours

  // CREATIVE DECAY: Snapshot + scan — 2 min after start, then every 6 hours
  timers.push(setTimeout(() => {
    app.log.info('[cron] Initial creative snapshot starting...');
    snapshotCreativePerformance(pool)
      .then((r) => {
        app.log.info(`[cron] Creative snapshot: ${r.snapshotted} campaigns`);
        return runDecayScanWithAlerts(pool);
      })
      .then((r) => {
        if (r.decayed > 0) {
          app.log.info(`[cron] Creative decay scan: scanned=${r.scanned}, decayed=${r.decayed}, critical=${r.critical}`);
        }
      })
      .catch((err) => app.log.error('[cron] Creative decay failed: %s', err instanceof Error ? err.message : err));
  }, 120_000)); // 2 min after start

  intervals.push(setInterval(() => {
    app.log.info('[cron] Periodic creative decay scan starting...');
    snapshotCreativePerformance(pool)
      .then((r) => {
        app.log.info(`[cron] Creative snapshot: ${r.snapshotted} campaigns`);
        return runDecayScanWithAlerts(pool);
      })
      .then((r) => {
        if (r.decayed > 0) {
          app.log.info(`[cron] Creative decay scan: scanned=${r.scanned}, decayed=${r.decayed}, critical=${r.critical}`);
        }
      })
      .catch((err) => app.log.error('[cron] Creative decay scan failed: %s', err instanceof Error ? err.message : err));
  }, 6 * 60 * 60 * 1000)); // Every 6 hours

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);

    // Stop telegram bot polling
    stopBotPolling();

    // Clear scheduled tasks
    timers.forEach(t => clearTimeout(t));
    intervals.forEach(i => clearInterval(i));

    try {
      await app.close();
      app.log.info('Server closed');
    } catch (err) {
      app.log.error('Error during shutdown: %s', err instanceof Error ? err.message : err);
    }

    try {
      await pool.end();
    } catch {
      // ignore
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
