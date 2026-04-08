import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { safeErrorDetails } from '../utils/error-response.js';
import { BanPredictor } from '../services/ml/ban-predictor.js';
import { getMlClient, type XGBoostPredictionResult } from '../services/ml/ml-client.js';
import { getAccountFeatures } from '../services/feature-extraction.service.js';
import * as predictionsRepo from '../repositories/predictions.repository.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { getTrainingStats, exportTrainingCSV, bootstrapTraining } from '../services/ai/training-bootstrap.js';
import { resetPredictor } from '../services/ai/auto-scoring.service.js';
import { getUserIdFilter } from '../utils/user-scope.js';

// ─── Singletons ───────────────────────────────────────────────────────────────

let tsPredictor: BanPredictor | null = null;

async function getTsPredictor(pool: ReturnType<typeof getPool>): Promise<BanPredictor> {
  if (!tsPredictor) {
    tsPredictor = new BanPredictor();
    await tsPredictor.loadModel(pool);
  }
  return tsPredictor;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mlClient() {
  return getMlClient(env.ML_SERVICE_URL);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function trainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const client = mlClient();

  if (client) {
    // Try Python XGBoost service
    try {
      const result = await client.train();
      tsPredictor = null; // reset TS predictor so it reloads
      await reply.status(200).send({
        ...result,
        engine: 'xgboost',
      });
      return;
    } catch (err: unknown) {
      request.log.warn({ err }, 'XGBoost training failed, falling back to TS logistic regression');
    }
  }

  // Fallback: TypeScript logistic regression
  try {
    const p = new BanPredictor();
    const result = await p.train(pool);
    tsPredictor = p;
    await reply.status(200).send({ ...result, engine: 'logistic_regression' });
  } catch (err: unknown) {
    request.log.error({ err }, 'Training failed');
    await reply.status(500).send({ error: 'Training failed', code: 'TRAINING_ERROR', details: safeErrorDetails(err) });
  }
}

export async function predictHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Аккаунт не найден', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const client = mlClient();

    // Try Python XGBoost first
    if (client) {
      const xgbResult: XGBoostPredictionResult | null = await client.predict(accountId);
      if (xgbResult) {
        await predictionsRepo.savePrediction(pool, accountId, xgbResult, xgbResult.model_version);
        await reply.status(200).send({ ...xgbResult, engine: 'xgboost' });
        return;
      }
      request.log.warn({ accountId }, 'XGBoost predict returned null, falling back to TS predictor');
    }

    // Fallback: TypeScript logistic regression
    const p = await getTsPredictor(pool);
    if (!p.isReady()) {
      await reply.status(400).send({ error: 'Модель не обучена. Вызовите POST /ml/train', code: 'MODEL_NOT_TRAINED' });
      return;
    }

    const features = await getAccountFeatures(pool, accountId);
    if (!features) {
      await reply.status(404).send({ error: 'Аккаунт не найден', code: 'NOT_FOUND' });
      return;
    }

    const result = p.predict(features);
    await predictionsRepo.savePrediction(pool, accountId, result, p.getModelVersion());
    await reply.status(200).send({ ...result, engine: 'logistic_regression' });
  } catch (err: unknown) {
    request.log.error({ err, accountId }, 'Prediction failed');
    await reply.status(500).send({ error: 'Prediction failed', code: 'PREDICTION_ERROR' });
  }
}

export async function predictAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const userId = getUserIdFilter(request);
    const client = mlClient();

    // Try Python XGBoost batch
    if (client) {
      const batchResult = await client.predictBatch(undefined, userId ?? undefined);
      if (batchResult) {
        for (const pred of batchResult.predictions) {
          await predictionsRepo.savePrediction(pool, pred.account_google_id, pred.result, pred.result.model_version);
        }
        await reply.status(200).send({
          total: batchResult.total,
          count_by_level: batchResult.count_by_level,
          engine: 'xgboost',
        });
        return;
      }
      request.log.warn('XGBoost batch predict failed, falling back to TS predictor');
    }

    // Fallback: TypeScript
    const p = await getTsPredictor(pool);
    if (!p.isReady()) {
      await reply.status(400).send({ error: 'Модель не обучена', code: 'MODEL_NOT_TRAINED' });
      return;
    }

    const { predictions, count_by_level } = await p.predictAll(pool, userId ?? undefined);
    for (const pred of predictions) {
      await predictionsRepo.savePrediction(pool, pred.account_google_id, pred.result, p.getModelVersion());
    }

    await reply.status(200).send({
      total: predictions.length,
      count_by_level,
      engine: 'logistic_regression',
    });
  } catch (err: unknown) {
    request.log.error({ err }, 'Batch prediction failed');
    await reply.status(500).send({ error: 'Batch prediction failed', code: 'PREDICTION_ERROR' });
  }
}

export async function predictionSummaryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const userId = getUserIdFilter(request);
    const summary = await predictionsRepo.getPredictionSummary(pool, userId);
    await reply.status(200).send(summary);
  } catch (err: unknown) {
    request.log.error({ err }, 'Failed to get summary');
    await reply.status(500).send({ error: 'Failed to get prediction summary', code: 'INTERNAL_ERROR' });
  }
}

export async function predictionHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Аккаунт не найден', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const history = await predictionsRepo.getPredictionHistory(pool, accountId);
    await reply.status(200).send({ predictions: history });
  } catch (err: unknown) {
    request.log.error({ err }, 'Failed to get history');
    await reply.status(500).send({ error: 'Failed to get prediction history', code: 'INTERNAL_ERROR' });
  }
}

export async function trainingStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const stats = await getTrainingStats(pool);

    // Augment with XGBoost service health if available
    const client = mlClient();
    let xgboostStatus = null;
    if (client) {
      xgboostStatus = await client.health();
    }

    await reply.status(200).send({ ...stats, xgboost: xgboostStatus });
  } catch (err: unknown) {
    request.log.error({ err }, 'Failed to get training stats');
    await reply.status(500).send({ error: 'Failed to get training stats', code: 'INTERNAL_ERROR' });
  }
}

export async function trainingExportHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const result = await exportTrainingCSV(pool);
    await reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="training_data.csv"')
      .status(200)
      .send(result.csv);
  } catch (err: unknown) {
    request.log.error({ err }, 'Failed to export training data');
    await reply.status(500).send({ error: 'Failed to export training data', code: 'INTERNAL_ERROR' });
  }
}

export async function bootstrapTrainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const result = await bootstrapTraining(pool);
    resetPredictor();
    tsPredictor = null;
    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err }, 'Bootstrap training failed');
    await reply.status(500).send({
      error: 'Bootstrap training failed',
      code: 'TRAINING_ERROR',
      details: safeErrorDetails(err),
    });
  }
}

export async function mlStatusHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const client = mlClient();
  if (!client) {
    await reply.send({ available: false, reason: 'ML_SERVICE_URL not configured' });
    return;
  }
  const health = await client.health();
  await reply.send({
    available: health !== null,
    ...(health ?? { reason: 'Service unreachable' }),
  });
}
