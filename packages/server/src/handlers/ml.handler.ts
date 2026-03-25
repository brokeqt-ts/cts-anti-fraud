import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../config/database.js';
import { env } from '../config/env.js';
import { BanPredictor } from '../services/ml/ban-predictor.js';
import { getAccountFeatures } from '../services/feature-extraction.service.js';
import * as predictionsRepo from '../repositories/predictions.repository.js';
import * as accountsRepo from '../repositories/accounts.repository.js';
import { getTrainingStats, exportTrainingCSV, bootstrapTraining } from '../services/ai/training-bootstrap.js';
import { resetPredictor } from '../services/ai/auto-scoring.service.js';
import { getUserIdFilter } from '../utils/user-scope.js';

// Singleton predictor instance
let predictor: BanPredictor | null = null;

async function getPredictor(pool: ReturnType<typeof getPool>): Promise<BanPredictor> {
  if (!predictor) {
    predictor = new BanPredictor();
    await predictor.loadModel(pool);
  }
  return predictor;
}

export async function trainHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  try {
    const p = new BanPredictor();
    const result = await p.train(pool);
    predictor = p; // update singleton
    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'trainHandler' }, 'Training failed');
    await reply.status(500).send({ error: 'Training failed', code: 'TRAINING_ERROR', details: err instanceof Error ? err.message : String(err) });
  }
}

export async function predictHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  // Verify buyer owns this account
  const userId = getUserIdFilter(request);
  if (userId) {
    const owned = await accountsRepo.getAccountIdByGoogleId(pool, accountId, userId);
    if (!owned) {
      await reply.status(404).send({ error: 'Аккаунт не найден', code: 'NOT_FOUND' });
      return;
    }
  }

  try {
    const p = await getPredictor(pool);
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

    // Save to DB
    await predictionsRepo.savePrediction(pool, accountId, result, p.getModelVersion());

    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'predictHandler', accountId }, 'Prediction failed');
    await reply.status(500).send({ error: 'Prediction failed', code: 'PREDICTION_ERROR' });
  }
}

export async function predictAllHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);

  try {
    const p = await getPredictor(pool);
    if (!p.isReady()) {
      await reply.status(400).send({ error: 'Модель не обучена', code: 'MODEL_NOT_TRAINED' });
      return;
    }

    const userId = getUserIdFilter(request);
    const { predictions, count_by_level } = await p.predictAll(pool, userId);

    // Save all predictions
    for (const pred of predictions) {
      await predictionsRepo.savePrediction(pool, pred.account_google_id, pred.result, p.getModelVersion());
    }

    await reply.status(200).send({
      total: predictions.length,
      count_by_level,
    });
  } catch (err: unknown) {
    request.log.error({ err, handler: 'predictAllHandler' }, 'Batch prediction failed');
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
    request.log.error({ err, handler: 'predictionSummaryHandler' }, 'Failed to get summary');
    await reply.status(500).send({ error: 'Failed to get prediction summary', code: 'INTERNAL_ERROR' });
  }
}

export async function predictionHistoryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const { accountId } = request.params as { accountId: string };

  // Verify buyer owns this account
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
    request.log.error({ err, handler: 'predictionHistoryHandler' }, 'Failed to get history');
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
    await reply.status(200).send(stats);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'trainingStatsHandler' }, 'Failed to get training stats');
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
    request.log.error({ err, handler: 'trainingExportHandler' }, 'Failed to export training data');
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
    // Reset the auto-scoring singleton to pick up new model
    resetPredictor();
    predictor = null; // Reset local singleton too
    await reply.status(200).send(result);
  } catch (err: unknown) {
    request.log.error({ err, handler: 'bootstrapTrainHandler' }, 'Bootstrap training failed');
    await reply.status(500).send({
      error: 'Bootstrap training failed',
      code: 'TRAINING_ERROR',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
