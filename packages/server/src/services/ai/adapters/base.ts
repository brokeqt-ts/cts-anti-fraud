import { AI_PREDICTION_MODEL } from '@cts/shared';

export interface ModelAdapter {
  readonly modelId: AI_PREDICTION_MODEL;
  readonly displayName: string;
  readonly modelVersion: string;
  isConfigured(): boolean;
  call(systemPrompt: string, userPrompt: string): Promise<ModelResponse>;
}

export interface ModelResponse {
  text: string;
  tokens: number;
  latencyMs: number;
  model: string;
  costUsd: number;
}

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Status codes that should NOT be retried (client errors indicating bad request/auth). */
const NO_RETRY_STATUSES = new Set([400, 401, 403]);

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });

      // Never retry auth/client errors — the key is invalid or request is malformed
      if (NO_RETRY_STATUSES.has(response.status)) {
        return response;
      }

      // Retry only 429 (rate limit) and 5xx (server errors)
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
          lastError = new Error(`API returned ${response.status}`);
          continue;
        }
      }
      return response;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('Request failed after retries');
}

/**
 * Approximate cost calculation based on public pricing (USD).
 * Prices per 1M tokens (input/output averaged for simplicity).
 */
export function estimateCost(
  modelVersion: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Prices per 1M tokens: [input, output]
  const pricing: Record<string, [number, number]> = {
    'claude-sonnet-4-20250514': [3.0, 15.0],
    'gpt-4o': [2.5, 10.0],
    'gemini-2.5-flash': [0.15, 0.6],
  };

  const [inputPrice, outputPrice] = pricing[modelVersion] ?? [1.0, 3.0];
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
}
