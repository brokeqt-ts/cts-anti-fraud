import { AI_PREDICTION_MODEL } from '@cts/shared';
import { env } from '../../../config/env.js';
import type { ModelAdapter, ModelResponse } from './base.js';
import { fetchWithRetry, estimateCost } from './base.js';

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class ClaudeAdapter implements ModelAdapter {
  readonly modelId = AI_PREDICTION_MODEL.CLAUDE;
  readonly displayName = 'Claude Sonnet';
  readonly modelVersion = 'claude-sonnet-4-20250514';

  isConfigured(): boolean {
    return !!env.ANTHROPIC_API_KEY;
  }

  async call(systemPrompt: string, userPrompt: string): Promise<ModelResponse> {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY не настроен');

    const start = Date.now();
    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.modelVersion,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Claude] API error ${response.status}:`, body);
      throw new Error(`Claude API error ${response.status}`);
    }

    const data = (await response.json()) as AnthropicResponse;

    const textContent = data.content?.filter(c => c.type === 'text').map(c => c.text ?? '').join('');
    if (!textContent) {
      throw new Error('Claude: empty response content');
    }

    const inputTokens = data.usage?.input_tokens ?? 0;
    const outputTokens = data.usage?.output_tokens ?? 0;

    return {
      text: textContent,
      tokens: inputTokens + outputTokens,
      latencyMs: Date.now() - start,
      model: this.modelVersion,
      costUsd: estimateCost(this.modelVersion, inputTokens, outputTokens),
    };
  }
}
