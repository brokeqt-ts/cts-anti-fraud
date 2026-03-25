import type pg from 'pg';
import { FeatureScaler, type ScalerParams } from './feature-scaler.js';
import { getTrainingDataset, getAllActiveFeatures, vectorToNumeric, NUMERIC_FEATURES, FEATURE_LABELS } from '../feature-extraction.service.js';
import type { AccountFeatureVector } from '../../repositories/features.repository.js';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface FactorExplanation {
  feature: string;
  label: string;
  contribution: number;
  value: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface PredictionResult {
  ban_probability: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  top_factors: FactorExplanation[];
  predicted_days_to_ban: number | null;
}

export interface TrainingResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  sample_count: number;
  positive_count: number;
  negative_count: number;
  model_version: string;
  warnings: string[];
}

interface ModelState {
  weights: number[];
  bias: number;
  scaler_params: ScalerParams;
  model_version: string;
  trained_at: string;
  sample_count: number;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

function sigmoid(z: number): number {
  if (z > 500) return 1;
  if (z < -500) return 0;
  return 1 / (1 + Math.exp(-z));
}

function riskLevel(prob: number): 'low' | 'medium' | 'high' | 'critical' {
  if (prob < 0.25) return 'low';
  if (prob < 0.5) return 'medium';
  if (prob < 0.75) return 'high';
  return 'critical';
}

// ─── Ban Predictor Class ────────────────────────────────────────────────────

export class BanPredictor {
  private weights: number[] = [];
  private bias = 0;
  private scaler = new FeatureScaler();
  private modelVersion = 'untrained';
  private sampleCount = 0;

  /** Train logistic regression from historical data. */
  async train(pool: pg.Pool): Promise<TrainingResult> {
    const warnings: string[] = [];
    const dataset = await getTrainingDataset(pool);

    if (dataset.length < 5) {
      return {
        accuracy: 0, precision: 0, recall: 0, f1: 0,
        sample_count: dataset.length, positive_count: 0, negative_count: 0,
        model_version: 'insufficient_data', warnings: ['Недостаточно данных для обучения (< 5 аккаунтов)'],
      };
    }

    const positives = dataset.filter(r => r.is_banned);
    const negatives = dataset.filter(r => !r.is_banned);

    if (positives.length === 0) {
      warnings.push('Нет забаненных аккаунтов в обучающей выборке');
    }
    if (dataset.length < 30) {
      warnings.push(`Мало данных (${dataset.length} аккаунтов) — модель может быть ненадёжной`);
    }

    // Oversample minority class for imbalance
    const balanced = [...dataset];
    if (positives.length > 0 && positives.length < negatives.length) {
      const ratio = Math.floor(negatives.length / positives.length);
      for (let i = 1; i < Math.min(ratio, 5); i++) {
        balanced.push(...positives);
      }
    }

    // Shuffle
    for (let i = balanced.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [balanced[i], balanced[j]] = [balanced[j]!, balanced[i]!];
    }

    // Extract numeric features and labels
    const X = balanced.map(r => vectorToNumeric(r));
    const y = balanced.map(r => r.is_banned ? 1 : 0);

    // Fit scaler
    this.scaler.fit(X);

    // Scale features
    const Xs = X.map(row => this.scaler.transform(row));

    // 80/20 train/validation split
    const splitIdx = Math.floor(Xs.length * 0.8);
    const XTrain = Xs.slice(0, splitIdx);
    const yTrain = y.slice(0, splitIdx);
    const XVal = Xs.slice(splitIdx);
    const yVal = y.slice(splitIdx);

    // Initialize weights
    const featureCount = NUMERIC_FEATURES.length;
    const weights = new Array<number>(featureCount).fill(0);
    let bias = 0;

    // Gradient descent
    const lr = 0.1;
    const epochs = 200;
    const lambda = 0.01; // L2 regularization

    for (let epoch = 0; epoch < epochs; epoch++) {
      const gradW = new Array<number>(featureCount).fill(0);
      let gradB = 0;

      for (let i = 0; i < XTrain.length; i++) {
        const z = XTrain[i]!.reduce((sum, x, j) => sum + x * weights[j]!, 0) + bias;
        const pred = sigmoid(z);
        const err = pred - yTrain[i]!;

        for (let j = 0; j < featureCount; j++) {
          gradW[j]! += err * XTrain[i]![j]!;
        }
        gradB += err;
      }

      const n = XTrain.length;
      for (let j = 0; j < featureCount; j++) {
        weights[j] = weights[j]! - lr * (gradW[j]! / n + lambda * weights[j]!);
      }
      bias -= lr * (gradB / n);
    }

    this.weights = weights;
    this.bias = bias;
    this.modelVersion = `lr_v1_${Date.now()}`;
    this.sampleCount = dataset.length;

    // Evaluate on validation set
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (let i = 0; i < XVal.length; i++) {
      const z = XVal[i]!.reduce((sum, x, j) => sum + x * weights[j]!, 0) + bias;
      const pred = sigmoid(z) >= 0.5 ? 1 : 0;
      if (pred === 1 && yVal[i] === 1) tp++;
      else if (pred === 1 && yVal[i] === 0) fp++;
      else if (pred === 0 && yVal[i] === 1) fn++;
      else tn++;
    }

    const accuracy = XVal.length > 0 ? (tp + tn) / XVal.length : 0;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;

    // Save model to DB
    await this.saveModel(pool);

    return {
      accuracy: Math.round(accuracy * 1000) / 1000,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1: Math.round(f1 * 1000) / 1000,
      sample_count: dataset.length,
      positive_count: positives.length,
      negative_count: negatives.length,
      model_version: this.modelVersion,
      warnings,
    };
  }

  /** Predict ban probability for a single account. */
  predict(features: AccountFeatureVector): PredictionResult {
    const numeric = vectorToNumeric(features);
    const scaled = this.scaler.getParams() ? this.scaler.transform(numeric) : numeric;

    const z = scaled.reduce((sum, x, i) => sum + x * (this.weights[i] ?? 0), 0) + this.bias;
    const prob = sigmoid(z);

    const factors = this.explain(features, scaled);
    const confidence = Math.min(this.sampleCount / 100, 1);

    return {
      ban_probability: Math.round(prob * 10000) / 10000,
      risk_level: riskLevel(prob),
      confidence: Math.round(confidence * 100) / 100,
      top_factors: factors.slice(0, 5),
      predicted_days_to_ban: prob > 0.5 ? Math.max(1, Math.round((1 - prob) * 30)) : null,
    };
  }

  /** Explain prediction by feature contribution. */
  explain(features: AccountFeatureVector, scaled?: number[]): FactorExplanation[] {
    const numeric = vectorToNumeric(features);
    const s = scaled ?? (this.scaler.getParams() ? this.scaler.transform(numeric) : numeric);

    const contributions: FactorExplanation[] = NUMERIC_FEATURES.map((name, i) => {
      const w = this.weights[i] ?? 0;
      const contribution = w * s[i]!;
      return {
        feature: name,
        label: FEATURE_LABELS[name] ?? name,
        contribution: Math.round(Math.abs(contribution) * 10000) / 10000,
        value: numeric[i]!,
        direction: contribution >= 0 ? 'increases_risk' as const : 'decreases_risk' as const,
      };
    });

    return contributions.sort((a, b) => b.contribution - a.contribution);
  }

  /** Predict for all active accounts. When userId is provided, only predict for that user's accounts. */
  async predictAll(pool: pg.Pool, userId?: string): Promise<{ predictions: Array<{ account_google_id: string; result: PredictionResult }>; count_by_level: Record<string, number> }> {
    const allFeatures = await getAllActiveFeatures(pool, userId);
    const predictions: Array<{ account_google_id: string; result: PredictionResult }> = [];
    const countByLevel: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    for (const features of allFeatures) {
      const result = this.predict(features);
      predictions.push({ account_google_id: features.account_google_id, result });
      countByLevel[result.risk_level] = (countByLevel[result.risk_level] ?? 0) + 1;
    }

    return { predictions, count_by_level: countByLevel };
  }

  /** Save model state to database. */
  async saveModel(pool: pg.Pool): Promise<void> {
    const state: ModelState = {
      weights: this.weights,
      bias: this.bias,
      scaler_params: this.scaler.getParams()!,
      model_version: this.modelVersion,
      trained_at: new Date().toISOString(),
      sample_count: this.sampleCount,
    };

    await pool.query(
      `INSERT INTO _meta (key, value) VALUES ('ml_model_state', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify(state)],
    );
  }

  /** Load model state from database. */
  async loadModel(pool: pg.Pool): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT value FROM _meta WHERE key = 'ml_model_state'`,
      );
      if (result.rowCount === 0) return false;

      const state = JSON.parse(result.rows[0]!['value'] as string) as ModelState;
      this.weights = state.weights;
      this.bias = state.bias;
      this.scaler.load(state.scaler_params);
      this.modelVersion = state.model_version;
      this.sampleCount = state.sample_count;
      return true;
    } catch {
      return false;
    }
  }

  isReady(): boolean {
    return this.weights.length > 0;
  }

  getModelVersion(): string {
    return this.modelVersion;
  }
}
