/**
 * HTTP client for the Python XGBoost ML service.
 *
 * All methods return null (or throw) on failure — callers should fall back
 * to the TypeScript logistic regression predictor (ban-predictor.ts).
 */

import type { PredictionResult, TrainingResult } from './ban-predictor.js';

/** XGBoost prediction result — same shape as PredictionResult but includes model_version. */
export interface XGBoostPredictionResult extends PredictionResult {
  model_version: string;
}

const TIMEOUT_MS = 10_000;

export interface XGBoostTrainingResult extends TrainingResult {
  feature_importance: Record<string, number>;
}

export interface XGBoostHealth {
  status: string;
  model_ready: boolean;
  model_version: string;
  sample_count: number;
}

// ─── Internal fetch helper ────────────────────────────────────────────────────

async function mlFetch<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ML service ${path} → HTTP ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class MlServiceClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<XGBoostHealth | null> {
    try {
      return await mlFetch<XGBoostHealth>(this.baseUrl, '/health');
    } catch {
      return null;
    }
  }

  async train(): Promise<XGBoostTrainingResult | null> {
    try {
      return await mlFetch<XGBoostTrainingResult>(this.baseUrl, '/train', {
        method: 'POST',
      });
    } catch (err) {
      throw err; // re-throw — training errors should surface
    }
  }

  async predict(accountGoogleId: string): Promise<XGBoostPredictionResult | null> {
    try {
      return await mlFetch<XGBoostPredictionResult>(this.baseUrl, '/predict', {
        method: 'POST',
        body: JSON.stringify({ account_google_id: accountGoogleId }),
      });
    } catch {
      return null; // silently fall back to TS predictor
    }
  }

  async predictBatch(
    accountGoogleIds?: string[],
    userId?: string,
  ): Promise<{
    total: number;
    count_by_level: Record<string, number>;
    predictions: Array<{ account_google_id: string; result: XGBoostPredictionResult }>;
  } | null> {
    try {
      const raw = await mlFetch<{
        total: number;
        count_by_level: Record<string, number>;
        predictions: Array<XGBoostPredictionResult & { account_google_id: string }>;
      }>(this.baseUrl, '/predict-batch', {
        method: 'POST',
        body: JSON.stringify({
          account_google_ids: accountGoogleIds ?? [],
          user_id: userId ?? null,
        }),
      });

      return {
        total: raw.total,
        count_by_level: raw.count_by_level,
        predictions: raw.predictions.map(p => ({
          account_google_id: p.account_google_id,
          result: p,
        })),
      };
    } catch {
      return null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: MlServiceClient | null = null;

export function getMlClient(mlServiceUrl: string | null): MlServiceClient | null {
  if (!mlServiceUrl) return null;
  if (!_client || (_client as unknown as { baseUrl: string }).baseUrl !== mlServiceUrl) {
    _client = new MlServiceClient(mlServiceUrl);
  }
  return _client;
}
