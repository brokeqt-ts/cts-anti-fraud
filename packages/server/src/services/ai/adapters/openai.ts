import { AI_PREDICTION_MODEL } from '@cts/shared';
import { env } from '../../../config/env.js';
import type { ModelAdapter, ModelResponse } from './base.js';
import { fetchWithRetry, estimateCost } from './base.js';

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAIAdapter implements ModelAdapter {
  readonly modelId = AI_PREDICTION_MODEL.OPENAI;
  readonly displayName = 'GPT-4o';
  readonly modelVersion = 'gpt-4o';

  isConfigured(): boolean {
    return !!env.OPENAI_API_KEY;
  }

  async call(systemPrompt: string, userPrompt: string): Promise<ModelResponse> {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY не настроен');

    const start = Date.now();
    const response = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelVersion,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[OpenAI] API error ${response.status}:`, body);
      throw new Error(`OpenAI API error ${response.status}`);
    }

    const data = (await response.json()) as OpenAIResponse;

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('OpenAI: empty response content');
    }

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    return {
      text,
      tokens: inputTokens + outputTokens,
      latencyMs: Date.now() - start,
      model: this.modelVersion,
      costUsd: estimateCost(this.modelVersion, inputTokens, outputTokens),
    };
  }
}
