import { AI_PREDICTION_MODEL } from '@cts/shared';
import { env } from '../../../config/env.js';
import type { ModelAdapter, ModelResponse } from './base.js';
import { fetchWithRetry, estimateCost } from './base.js';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiAdapter implements ModelAdapter {
  readonly modelId = AI_PREDICTION_MODEL.GEMINI;
  readonly displayName = 'Gemini 2.5 Flash';
  readonly modelVersion = 'gemini-2.5-flash';

  isConfigured(): boolean {
    return !!env.GEMINI_API_KEY;
  }

  async call(systemPrompt: string, userPrompt: string): Promise<ModelResponse> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY не настроен');

    const start = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelVersion}:generateContent`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 2048 },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[Gemini] API error ${response.status}:`, body);
      throw new Error(`Gemini API error ${response.status}`);
    }

    const data = (await response.json()) as GeminiResponse;

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini: empty response content');
    }

    const fullText = data.candidates![0]!.content!.parts!.map(p => p.text ?? '').join('');
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      text: fullText,
      tokens: inputTokens + outputTokens,
      latencyMs: Date.now() - start,
      model: this.modelVersion,
      costUsd: estimateCost(this.modelVersion, inputTokens, outputTokens),
    };
  }
}
