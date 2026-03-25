/**
 * Barrel re-export from adapters/ for backward compatibility.
 * All adapter implementations live in ./adapters/.
 */
export type { ModelAdapter, ModelResponse } from './adapters/index.js';
export {
  ClaudeAdapter,
  OpenAIAdapter,
  GeminiAdapter,
  getAdapter,
  getConfiguredAdapters,
  getAllAdapters,
} from './adapters/index.js';

import type { ModelResponse } from './adapters/index.js';
import type { AiAnalysisResult } from './analysis-utils.js';
import { parseAnalysisResponse } from './analysis-utils.js';

export function parseModelResponse(response: ModelResponse): AiAnalysisResult {
  const parsed = parseAnalysisResponse(response.text);
  return {
    ...parsed,
    model: response.model,
    tokens_used: response.tokens,
    latency_ms: response.latencyMs,
  };
}
