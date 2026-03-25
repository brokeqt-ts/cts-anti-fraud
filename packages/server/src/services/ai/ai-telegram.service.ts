import type { Pool } from 'pg';
import { AIAnalyzer } from './ai-analyzer.js';
import { getConfiguredAdapters } from './adapters/index.js';
import { escapeHtml, formatCid } from '../telegram-bot.service.js';

const analyzer = new AIAnalyzer();

/**
 * Run AI analysis for a Telegram bot command, return formatted HTML message.
 */
export async function analyzeAccountForTelegram(pool: Pool, accountGoogleId: string): Promise<string> {
  const configured = getConfiguredAdapters();
  if (configured.length === 0) {
    return '❌ Нет настроенных API ключей AI моделей (Anthropic, OpenAI, Gemini).';
  }

  const comparison = await analyzer.analyzeAccount(pool, accountGoogleId);
  const r = comparison.final_result;

  const riskEmoji = r.risk_assessment === 'high' || r.risk_assessment === 'critical'
    ? '🔴'
    : r.risk_assessment === 'medium'
      ? '🟡'
      : '🟢';

  const actions = r.immediate_actions
    .slice(0, 3)
    .map((a) => `  • [${a.priority}] ${escapeHtml(a.action_ru)}`)
    .join('\n');

  const strategic = r.strategic_recommendations
    .slice(0, 3)
    .map((a) => `  • ${escapeHtml(a.action_ru)}`)
    .join('\n');

  const lines = [
    `🤖 <b>AI Анализ: ${formatCid(accountGoogleId)}</b>`,
    '',
    `${riskEmoji} Риск: <b>${escapeHtml(r.risk_assessment)}</b>`,
    `📊 Уверенность: ${r.confidence}`,
    `🧠 Модели: ${comparison.models_used.join(', ')}`,
    '',
    `<b>Резюме:</b>`,
    escapeHtml(r.summary_ru),
  ];

  if (actions) {
    lines.push('', '<b>Срочные действия:</b>', actions);
  }

  if (strategic) {
    lines.push('', '<b>Стратегические рекомендации:</b>', strategic);
  }

  if (r.similar_patterns.length > 0) {
    lines.push('', '<b>Похожие паттерны:</b>');
    r.similar_patterns.slice(0, 3).forEach((p) => lines.push(`  • ${escapeHtml(p)}`));
  }

  lines.push('', `💰 Стоимость: $${comparison.total_cost_usd.toFixed(4)}`);

  return lines.join('\n');
}
