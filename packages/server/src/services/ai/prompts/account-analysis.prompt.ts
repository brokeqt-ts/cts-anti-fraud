import type { AccountFeatureVector } from '../../../repositories/features.repository.js';
import type { PredictionResult } from '../../ml/ban-predictor.js';

export interface DomainAnalysisData {
  domain_name: string;
  content_risk_score: number | null;
  keyword_risk_score: number | null;
  compliance_score: number | null;
  structure_risk_score: number | null;
  has_privacy_policy: boolean;
  has_terms_of_service: boolean;
  has_disclaimer: boolean;
  has_age_verification: boolean;
  has_countdown_timer: boolean;
  has_fake_reviews: boolean;
  has_before_after: boolean;
  has_hidden_text: boolean;
  redirect_count: number;
  url_mismatch: boolean;
  analysis_summary: string | null;
  red_flags: Array<{ type: string; severity: string; detail?: string }>;
  keyword_matches: Array<{ keyword: string; vertical: string; severity: string }>;
}

export interface SimilarAccountsStats {
  vertical: string;
  total_accounts: number;
  banned_count: number;
  ban_rate_percent: number;
  avg_lifetime_days: number | null;
  min_lifetime_days: number | null;
  common_ban_reasons: string[];
}

export const ACCOUNT_ANALYSIS_SYSTEM = `Ты — эксперт по антифроду Google Ads для команды медиабаинга.
Данные собраны через антидетект-браузер. Каждый аккаунт работает в изолированном профиле.
Команда работает с серыми и белыми вертикалями: gambling, nutra, crypto, dating, finance, sweepstakes, ecommerce.
Ты анализируешь данные аккаунтов и прогнозируешь риски бана.
Отвечай ТОЛЬКО на русском языке.
Отвечай ТОЛЬКО валидным JSON, соответствующим указанной схеме.
Не добавляй markdown-форматирование, backticks или другой текст вокруг JSON.`;

export function buildAccountAnalysisPrompt(
  features: AccountFeatureVector,
  prediction: PredictionResult | null,
  notifications: Array<{ title: string; category: string }>,
  campaignSummary: { total: number; active: number; paused: number },
  bestPracticesText?: string,
  domainAnalysis?: DomainAnalysisData,
  similarStats?: SimilarAccountsStats,
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

${domainAnalysis ? `АНАЛИЗ ЛЕНДИНГА (${domainAnalysis.domain_name}):
- Общий риск контента: ${domainAnalysis.content_risk_score ?? 'нет данных'}/100
- Риск ключевых слов: ${domainAnalysis.keyword_risk_score ?? 'нет данных'}/100
- Compliance score: ${domainAnalysis.compliance_score ?? 'нет данных'}/100
- Структурный риск: ${domainAnalysis.structure_risk_score ?? 'нет данных'}/100
- Privacy Policy: ${domainAnalysis.has_privacy_policy ? 'есть' : 'ОТСУТСТВУЕТ'}
- Terms of Service: ${domainAnalysis.has_terms_of_service ? 'есть' : 'ОТСУТСТВУЕТ'}
- Disclaimer: ${domainAnalysis.has_disclaimer ? 'есть' : 'ОТСУТСТВУЕТ'}
- Age verification: ${domainAnalysis.has_age_verification ? 'есть' : 'нет'}
- Countdown timer: ${domainAnalysis.has_countdown_timer ? 'ОБНАРУЖЕН' : 'нет'}
- Fake reviews: ${domainAnalysis.has_fake_reviews ? 'ОБНАРУЖЕНЫ' : 'нет'}
- Before/after: ${domainAnalysis.has_before_after ? 'ОБНАРУЖЕНО' : 'нет'}
- Скрытый текст: ${domainAnalysis.has_hidden_text ? 'ОБНАРУЖЕН' : 'нет'}
- Редиректов: ${domainAnalysis.redirect_count}${domainAnalysis.url_mismatch ? ' (URL не совпадает с объявлением — ПОДОЗРИТЕЛЬНО)' : ''}
${domainAnalysis.keyword_matches.length > 0 ? `- Серые ключевые слова: ${domainAnalysis.keyword_matches.slice(0, 5).map(k => `"${k.keyword}" (${k.vertical}, ${k.severity})`).join(', ')}` : ''}
${domainAnalysis.red_flags.length > 0 ? `- Красные флаги: ${domainAnalysis.red_flags.map(f => `${f.type} [${f.severity}]`).join(', ')}` : ''}
${domainAnalysis.analysis_summary ? `- Краткий анализ: ${domainAnalysis.analysis_summary}` : ''}` : ''}

${similarStats && similarStats.total_accounts > 0 ? `ПОХОЖИЕ АККАУНТЫ (вертикаль: ${similarStats.vertical}):
- Всего аналогичных аккаунтов в системе: ${similarStats.total_accounts}
- Из них забанено: ${similarStats.banned_count} (${similarStats.ban_rate_percent}%)
- Средний lifetime до бана: ${similarStats.avg_lifetime_days != null ? `${similarStats.avg_lifetime_days} дней` : 'нет данных'}
- Минимальный lifetime: ${similarStats.min_lifetime_days != null ? `${similarStats.min_lifetime_days} дней` : 'нет данных'}
${similarStats.common_ban_reasons.length > 0 ? `- Типичные причины банов: ${similarStats.common_ban_reasons.join(', ')}` : ''}` : ''}

${bestPracticesText ? `МЕТОДИЧКА КОМАНДЫ:
Сверь настройки аккаунта с методичкой и укажи нарушения в рекомендациях.

${bestPracticesText}` : ''}

ОТВЕТЬ в формате JSON (все поля обязательны):
{
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "summary_ru": "Одна строка: УРОВЕНЬ — главная причина с конкретными значениями",
  "top_risk_factors": [
    {
      "factor": "название поля или сигнала",
      "value": "конкретное значение из данных",
      "interpretation": "почему это опасно в данном контексте"
    }
  ],
  "risk_assessment": "Детальная оценка с опорой на цифры из данных аккаунта",
  "actions_today": [
    {
      "priority": "critical|high",
      "action_ru": "Что сделать прямо сейчас",
      "reasoning_ru": "Почему срочно",
      "estimated_impact": "Ожидаемый эффект"
    }
  ],
  "actions_this_week": [
    {
      "priority": "medium|low",
      "action_ru": "Что сделать на этой неделе",
      "reasoning_ru": "Почему важно",
      "estimated_impact": "Ожидаемый эффект"
    }
  ],
  "stable_factors": ["Метрика X в норме — не менять", "..."],
  "similar_patterns": ["Описание похожих паттернов из истории аккаунтов"],
  "immediate_actions": [],
  "strategic_recommendations": [],
  "confidence": "low|medium|high"
}

Правила:
- top_risk_factors: только значимые отклонения (максимум 5), только с реальными значениями из данных
- actions_today: только если есть HIGH или CRITICAL факторы, максимум 3 пункта
- actions_this_week: максимум 4 пункта
- stable_factors: укажи что работает хорошо и не требует вмешательства
- immediate_actions и strategic_recommendations оставь пустыми массивами (deprecated)`;
}

export const BAN_ANALYSIS_SYSTEM = ACCOUNT_ANALYSIS_SYSTEM;

export function buildBanAnalysisPrompt(
  accountGoogleId: string,
  banReason: string | null,
  lifetimeHours: number | null,
  features: AccountFeatureVector,
  postMortemFactors: Array<{ factor: string; severity: string }>,
  domainAnalysis?: DomainAnalysisData | null,
  consumablesSummary?: string | null,
): string {
  const domainSection = domainAnalysis
    ? `\nАНАЛИЗ ЛЕНДИНГА (${domainAnalysis.domain_name}):
- Compliance score: ${domainAnalysis.compliance_score ?? 'нет данных'}/100
- Content risk: ${domainAnalysis.content_risk_score ?? 'нет данных'}/100
- Privacy Policy: ${domainAnalysis.has_privacy_policy ? 'есть' : 'ОТСУТСТВУЕТ'}
- Terms of Service: ${domainAnalysis.has_terms_of_service ? 'есть' : 'ОТСУТСТВУЕТ'}
- Countdown timer: ${domainAnalysis.has_countdown_timer ? 'ЕСТЬ' : 'нет'}
- Fake reviews: ${domainAnalysis.has_fake_reviews ? 'ЕСТЬ' : 'нет'}
${domainAnalysis.red_flags.length > 0 ? `- Флаги: ${domainAnalysis.red_flags.map(f => `${f.type}[${f.severity}]`).join(', ')}` : ''}`
    : '';

  const consumablesSection = consumablesSummary
    ? `\nРЕСУРСЫ АККАУНТА:\n${consumablesSummary}`
    : '';

  return `Проанализируй причину бана этого аккаунта Google Ads.

ЗАБАНЕННЫЙ АККАУНТ: ${accountGoogleId}
ПРИЧИНА БАНА: ${banReason ?? 'не указана'}
ВРЕМЯ ЖИЗНИ: ${lifetimeHours != null ? `${lifetimeHours} часов` : 'неизвестно'}

ДАННЫЕ НА МОМЕНТ БАНА:
- Возраст аккаунта: ${features.account_age_days} дней
- Расход: $${features.total_spend_usd.toFixed(2)}
- Нарушения: ${features.policy_violation_count}
- BIN ban rate: ${features.bin_ban_rate ?? 'нет данных'}%
- Shared BIN with banned: ${features.shared_bin_with_banned ? 'ДА' : 'нет'}
- Shared domain with banned: ${features.shared_domain_with_banned ? 'ДА' : 'нет'}
- Связи с забаненными: ${features.connected_banned_accounts}
- Отклонённые объявления: ${features.ad_disapproval_count}
${domainSection}${consumablesSection}

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
  accounts: Array<{
    id: string;
    features: AccountFeatureVector;
    prediction: PredictionResult | null;
    domain_name?: string | null;
    domain_score?: number | null;
    offer_vertical?: string | null;
    is_banned?: boolean;
  }>,
): string {
  const summaries = accounts.map(a => {
    const status = a.is_banned ? '[БАН]' : '[активен]';
    const domain = a.domain_name ? `, домен ${a.domain_name}(score:${a.domain_score ?? '?'})` : '';
    const vertical = a.offer_vertical ? `, верт. ${a.offer_vertical}` : '';
    const ml = a.prediction ? `, ML:${(a.prediction.ban_probability * 100).toFixed(0)}%` : '';
    return `${status} Аккаунт ${a.id}${vertical}: возраст ${a.features.account_age_days}д, расход $${a.features.total_spend_usd.toFixed(0)}, нарушения ${a.features.policy_violation_count}, BIN ban rate ${a.features.bin_ban_rate ?? '?'}%, связи с баном ${a.features.connected_banned_accounts}, QS ${a.features.avg_quality_score ?? '?'}${domain}${ml}`;
  }).join('\n');

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
