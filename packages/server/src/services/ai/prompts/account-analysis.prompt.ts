import type { AccountFeatureVector } from '../../../repositories/features.repository.js';
import type { PredictionResult } from '../../ml/ban-predictor.js';

export const ACCOUNT_ANALYSIS_SYSTEM = `Ты — эксперт по антифроду Google Ads для команды медиабаинга.
Ты анализируешь данные аккаунтов и прогнозируешь риски бана.
Отвечай ТОЛЬКО на русском языке.
Отвечай ТОЛЬКО валидным JSON, соответствующим указанной схеме.
Не добавляй markdown-форматирование, backticks или другой текст вокруг JSON.`;

export function buildAccountAnalysisPrompt(
  features: AccountFeatureVector,
  prediction: PredictionResult | null,
  notifications: Array<{ title: string; category: string }>,
  campaignSummary: { total: number; active: number; paused: number },
): string {
  return `Проанализируй этот аккаунт Google Ads и оцени риски бана.

ДАННЫЕ АККАУНТА:
- Google Account ID: ${features.account_google_id}
- Возраст аккаунта: ${features.account_age_days} дней
- Тип аккаунта: ${features.account_type ?? 'неизвестен'}
- Нарушения политики: ${features.policy_violation_count}
- Активные кампании: ${features.active_campaign_count}

ДОМЕН:
- Возраст домена: ${features.domain_age_days ?? 'неизвестен'} дней
- Safe page score: ${features.domain_safe_page_score ?? 'нет данных'}
- SSL: ${features.domain_has_ssl ? 'да' : 'нет'}
- Privacy page: ${features.domain_has_privacy_page ? 'да' : 'нет'}

ФИНАНСЫ:
- Общий расход: $${features.total_spend_usd.toFixed(2)}
- Средний дневной расход: $${features.daily_spend_avg.toFixed(2)}
- Скорость расхода: ${features.spend_velocity_ratio}x
- BIN: ${features.bin_prefix ?? 'неизвестен'}
- BIN ban rate: ${features.bin_ban_rate ?? 'нет данных'}%

КАМПАНИИ:
- Всего: ${campaignSummary.total}, активных: ${campaignSummary.active}, на паузе: ${campaignSummary.paused}
- Средний Quality Score: ${features.avg_quality_score ?? 'нет данных'}
- Доля ключевых слов с QS ≤ 4: ${(features.low_qs_keyword_ratio * 100).toFixed(1)}%
- Отклонённых объявлений: ${features.ad_disapproval_count}

СЕТЕВЫЕ СВЯЗИ:
- Связанных забаненных аккаунтов: ${features.connected_banned_accounts}
- Общий домен с забаненным: ${features.shared_domain_with_banned ? 'ДА' : 'нет'}
- Общий BIN с забаненным: ${features.shared_bin_with_banned ? 'ДА' : 'нет'}

УВЕДОМЛЕНИЯ (последние 30 дней):
- Предупреждения: ${features.notification_warning_count}
- Критические: ${features.notification_critical_count}
${notifications.length > 0 ? notifications.map(n => `  - [${n.category}] ${n.title}`).join('\n') : '  Нет уведомлений'}

${prediction ? `ML ПРОГНОЗ:
- Вероятность бана: ${(prediction.ban_probability * 100).toFixed(1)}%
- Уровень риска: ${prediction.risk_level}
- Прогноз дней до бана: ${prediction.predicted_days_to_ban ?? 'не определён'}
- Топ-факторы: ${prediction.top_factors.slice(0, 3).map(f => f.label).join(', ')}` : 'ML прогноз: модель не обучена'}

ОТВЕТЬ в формате JSON:
{
  "summary_ru": "Краткое резюме на 2-3 предложения",
  "risk_assessment": "Детальная оценка риска",
  "immediate_actions": [
    {
      "priority": "critical|high|medium|low",
      "action_ru": "Что сделать",
      "reasoning_ru": "Почему",
      "estimated_impact": "Ожидаемый эффект"
    }
  ],
  "strategic_recommendations": [
    {
      "priority": "critical|high|medium|low",
      "action_ru": "Что сделать",
      "reasoning_ru": "Почему",
      "estimated_impact": "Ожидаемый эффект"
    }
  ],
  "similar_patterns": ["Описание похожих паттернов"],
  "confidence": "low|medium|high"
}`;
}

export const BAN_ANALYSIS_SYSTEM = ACCOUNT_ANALYSIS_SYSTEM;

export function buildBanAnalysisPrompt(
  accountGoogleId: string,
  banReason: string | null,
  lifetimeHours: number | null,
  features: AccountFeatureVector,
  postMortemFactors: Array<{ factor: string; severity: string }>,
): string {
  return `Проанализируй причину бана этого аккаунта Google Ads.

ЗАБАНЕННЫЙ АККАУНТ: ${accountGoogleId}
ПРИЧИНА БАНА: ${banReason ?? 'не указана'}
ВРЕМЯ ЖИЗНИ: ${lifetimeHours != null ? `${lifetimeHours} часов` : 'неизвестно'}

ДАННЫЕ НА МОМЕНТ БАНА:
- Возраст аккаунта: ${features.account_age_days} дней
- Расход: $${features.total_spend_usd.toFixed(2)}
- Нарушения: ${features.policy_violation_count}
- BIN ban rate: ${features.bin_ban_rate ?? 'нет данных'}%
- Связи с забаненными: ${features.connected_banned_accounts}
- Отклонённые объявления: ${features.ad_disapproval_count}

ФАКТОРЫ POST-MORTEM:
${postMortemFactors.map(f => `- [${f.severity}] ${f.factor}`).join('\n')}

ОТВЕТЬ в формате JSON:
{
  "summary_ru": "Краткое резюме причины бана",
  "risk_assessment": "Детальный анализ что привело к бану",
  "immediate_actions": [{"priority": "...", "action_ru": "...", "reasoning_ru": "...", "estimated_impact": "..."}],
  "strategic_recommendations": [{"priority": "...", "action_ru": "...", "reasoning_ru": "...", "estimated_impact": "..."}],
  "similar_patterns": ["Описание похожих паттернов"],
  "confidence": "low|medium|high"
}`;
}

export function buildComparisonPrompt(
  accounts: Array<{ id: string; features: AccountFeatureVector; prediction: PredictionResult | null }>,
): string {
  const summaries = accounts.map(a =>
    `Аккаунт ${a.id}: возраст ${a.features.account_age_days}д, расход $${a.features.total_spend_usd.toFixed(0)}, нарушения ${a.features.policy_violation_count}, BIN ban rate ${a.features.bin_ban_rate ?? '?'}%, связи с баном ${a.features.connected_banned_accounts}${a.prediction ? `, ML прогноз: ${(a.prediction.ban_probability * 100).toFixed(0)}%` : ''}`,
  ).join('\n');

  return `Сравни эти аккаунты Google Ads и определи кто под наибольшим риском бана:

${summaries}

ОТВЕТЬ в формате JSON:
{
  "summary_ru": "Общий анализ группы аккаунтов",
  "risk_assessment": "Сравнительная оценка рисков",
  "immediate_actions": [{"priority": "...", "action_ru": "...", "reasoning_ru": "...", "estimated_impact": "..."}],
  "strategic_recommendations": [{"priority": "...", "action_ru": "...", "reasoning_ru": "...", "estimated_impact": "..."}],
  "similar_patterns": [],
  "confidence": "low|medium|high"
}`;
}
