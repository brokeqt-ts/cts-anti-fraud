/**
 * ML Auto-retrain service.
 *
 * Tracks bans since last training in `_meta` table.
 * Triggers retraining when threshold is reached or on weekly schedule.
 */

import type pg from 'pg';
import { getMlClient } from './ml/ml-client.js';
import { BanPredictor } from './ml/ban-predictor.js';
import { env } from '../config/env.js';

const BAN_THRESHOLD = 50;
const META_KEY_COUNTER = 'ml_bans_since_last_train';
const META_KEY_LAST_TRAIN = 'ml_last_auto_train';

// ─── Counter helpers ──────────────────────────────────────────────────────────

async function getCounter(pool: pg.Pool): Promise<number> {
  const r = await pool.query(`SELECT value FROM _meta WHERE key = $1`, [META_KEY_COUNTER]);
  if (!r.rows[0]) return 0;
  try { return parseInt(JSON.parse(r.rows[0].value as string), 10) || 0; } catch { return 0; }
}

async function setCounter(pool: pg.Pool, value: number): Promise<void> {
  await pool.query(
    `INSERT INTO _meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY_COUNTER, JSON.stringify(value)],
  );
}

async function setLastTrainTimestamp(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO _meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY_LAST_TRAIN, JSON.stringify(new Date().toISOString())],
  );
}

// ─── Minimal logger interface ─────────────────────────────────────────────────

interface SimpleLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

// ─── Core retrain logic ───────────────────────────────────────────────────────

export async function runMlRetrain(pool: pg.Pool, log: SimpleLogger, reason: string): Promise<void> {
  log.info(`[ml-retrain] Starting retrain (reason: ${reason})`);

  const client = getMlClient(env.ML_SERVICE_URL);

  if (client) {
    try {
      const result = await client.train();
      await setCounter(pool, 0);
      await setLastTrainTimestamp(pool);
      log.info(`[ml-retrain] XGBoost retrain complete: samples=${result?.sample_count ?? '?'}, version=${result?.model_version ?? '?'}`);
      return;
    } catch (err) {
      log.warn(`[ml-retrain] XGBoost retrain failed, falling back to TS predictor: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: TypeScript logistic regression
  try {
    const p = new BanPredictor();
    await p.train(pool);
    await setCounter(pool, 0);
    await setLastTrainTimestamp(pool);
    log.info('[ml-retrain] TS logistic regression retrain complete');
  } catch (err) {
    log.error(`[ml-retrain] Retrain failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Called after each new ban ────────────────────────────────────────────────

export function recordBanForRetrain(pool: pg.Pool, log: SimpleLogger): void {
  getCounter(pool)
    .then(async (current) => {
      const next = current + 1;
      await setCounter(pool, next);
      log.debug(`[ml-retrain] Ban counter: ${next}/${BAN_THRESHOLD}`);

      if (next >= BAN_THRESHOLD) {
        log.info(`[ml-retrain] Threshold reached (${next} bans), triggering retrain`);
        // Non-blocking
        runMlRetrain(pool, log, `threshold_${BAN_THRESHOLD}_bans`).catch((err) => {
          log.error(`[ml-retrain] Background retrain error: ${err instanceof Error ? err.message : err}`);
        });
      }
    })
    .catch((err) => {
      log.warn(`[ml-retrain] Counter update failed: ${err instanceof Error ? err.message : err}`);
    });
}
