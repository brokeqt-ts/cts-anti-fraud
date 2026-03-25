import { AI_PREDICTION_MODEL } from '@cts/shared';
import type { ModelAdapter } from './base.js';
import { ClaudeAdapter } from './claude.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';

export type { ModelAdapter, ModelResponse } from './base.js';
export { fetchWithRetry, estimateCost } from './base.js';
export { ClaudeAdapter } from './claude.js';
export { OpenAIAdapter } from './openai.js';
export { GeminiAdapter } from './gemini.js';

const adapters: ModelAdapter[] = [
  new ClaudeAdapter(),
  new OpenAIAdapter(),
  new GeminiAdapter(),
];

export function getAdapter(model: AI_PREDICTION_MODEL): ModelAdapter {
  const adapter = adapters.find(a => a.modelId === model);
  if (!adapter) throw new Error(`Unknown model: ${model}`);
  return adapter;
}

export function getConfiguredAdapters(): ModelAdapter[] {
  return adapters.filter(a => a.isConfigured());
}

export function getAllAdapters(): ModelAdapter[] {
  return [...adapters];
}
