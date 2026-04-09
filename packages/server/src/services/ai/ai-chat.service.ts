import type pg from 'pg';
import { getAccountFeatures } from '../feature-extraction.service.js';
import { BanPredictor } from '../ml/ban-predictor.js';
import { getConfiguredAdapters } from './model-adapter.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  accountGoogleId: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  reply: string;
  model: string;
  tokens: number;
  latencyMs: number;
}

const CHAT_SYSTEM_PROMPT = `Ты — AI-ассистент антифрод-платформы CTS Anti-Fraud для команды медиабаинга Google Ads.
Тебе доступен полный контекст об аккаунте: кампании, баны, метрики, домены, финансы, сетевые связи.
Байер может задавать любые вопросы по аккаунту — от "почему упал QS" до "стоит ли менять домен".

ПРАВИЛА:
- Отвечай ТОЛЬКО на русском языке
- Будь конкретен: давай цифры, рекомендации, примеры
- Если данных недостаточно для ответа — скажи об этом прямо
- Не выдумывай данные, которых нет в контексте
- Учитывай специфику серых вертикалей (gambling, nutra, crypto, dating)
- Давай практичные рекомендации с учётом риска бана`;

/**
 * Build a rich context string about an account for the AI chat.
 */
async function buildAccountContext(pool: pg.Pool, accountGoogleId: string): Promise<string> {
  const features = await getAccountFeatures(pool, accountGoogleId);

  // Basic account info
  const accountResult = await pool.query(
    `SELECT google_account_id, display_name, status, account_type,
            currency, timezone, created_at, updated_at
     FROM accounts WHERE google_account_id = $1`,
    [accountGoogleId],
  );
  const account = accountResult.rows[0];

  // Recent bans
  const bansResult = await pool.query(
    `SELECT ban_reason, banned_at, ban_type, policy_topic
     FROM ban_logs WHERE account_google_id = $1
     ORDER BY banned_at DESC LIMIT 10`,
    [accountGoogleId],
  );

  // Active campaigns
  const campaignsResult = await pool.query(
    `SELECT name, status, campaign_type, budget_amount_micros, cost_micros,
            impressions, clicks, conversions, ctr, average_cpc_micros
     FROM campaigns WHERE account_google_id = $1
     ORDER BY updated_at DESC LIMIT 20`,
    [accountGoogleId],
  );

  // Domains
  const domainsResult = await pool.query(
    `SELECT DISTINCT domain_name FROM campaigns
     WHERE account_google_id = $1 AND domain_name IS NOT NULL`,
    [accountGoogleId],
  );

  // Notifications (recent 30)
  const notifsResult = await pool.query(
    `SELECT title, severity, created_at FROM notification_details
     WHERE account_google_id = $1
     ORDER BY created_at DESC LIMIT 30`,
    [accountGoogleId],
  );

  // ML prediction
  let predictionText = 'ML модель: не обучена или нет данных';
  try {
    const predictor = new BanPredictor();
    if (features && predictor.isReady()) {
      const prediction = predictor.predict(features);
      predictionText = `ML прогноз: вероятность бана ${(prediction.ban_probability * 100).toFixed(1)}%, ` +
        `уровень риска: ${prediction.risk_level}, ` +
        `прогноз дней до бана: ${prediction.predicted_days_to_ban ?? 'не определён'}, ` +
        `топ-факторы: ${prediction.top_factors.slice(0, 5).map(f => `${f.label} (${f.direction})`).join(', ')}`;
    }
  } catch {
    // predictor not ready
  }

  // Assessment result
  const assessmentResult = await pool.query(
    `SELECT risk_level, risk_score, factors, created_at
     FROM assessment_results WHERE account_google_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [accountGoogleId],
  );

  const parts: string[] = [];

  // Account section
  if (account) {
    parts.push(`АККАУНТ:
- Google Account ID: ${account['google_account_id']}
- Имя: ${account['display_name'] ?? 'не указано'}
- Статус: ${account['status'] ?? 'неизвестен'}
- Тип: ${account['account_type'] ?? 'неизвестен'}
- Валюта: ${account['currency'] ?? '-'}
- Таймзона: ${account['timezone'] ?? '-'}
- Создан: ${account['created_at'] ? new Date(account['created_at'] as string).toLocaleDateString('ru-RU') : '-'}`);
  }

  // Features section
  if (features) {
    parts.push(`МЕТРИКИ:
- Возраст аккаунта: ${features.account_age_days} дней
- Нарушения политики: ${features.policy_violation_count}
- Активные кампании: ${features.active_campaign_count}
- Общий расход: $${features.total_spend_usd.toFixed(2)}
- Средний дневной расход: $${features.daily_spend_avg.toFixed(2)}
- Скорость расхода: ${features.spend_velocity_ratio}x
- BIN: ${features.bin_prefix ?? 'неизвестен'}, ban rate: ${features.bin_ban_rate ?? 'нет данных'}%
- Средний Quality Score: ${features.avg_quality_score ?? 'нет данных'}
- Доля ключей с QS ≤ 4: ${(features.low_qs_keyword_ratio * 100).toFixed(1)}%
- Отклонённых объявлений: ${features.ad_disapproval_count}
- Связанных забаненных: ${features.connected_banned_accounts}
- Общий домен с забаненным: ${features.shared_domain_with_banned ? 'ДА' : 'нет'}
- Общий BIN с забаненным: ${features.shared_bin_with_banned ? 'ДА' : 'нет'}
- Предупреждения (30д): ${features.notification_warning_count}
- Критические (30д): ${features.notification_critical_count}`);
  }

  // Bans section
  if (bansResult.rows.length > 0) {
    const banLines = bansResult.rows.map((b) => {
      const date = b['banned_at'] ? new Date(b['banned_at'] as string).toLocaleDateString('ru-RU') : '?';
      return `  - ${date}: ${b['ban_reason'] ?? 'причина не указана'} (${b['ban_type'] ?? '-'})${b['policy_topic'] ? ` [${b['policy_topic']}]` : ''}`;
    });
    parts.push(`БАНЫ (${bansResult.rows.length}):\n${banLines.join('\n')}`);
  } else {
    parts.push('БАНЫ: нет записей');
  }

  // Campaigns section
  if (campaignsResult.rows.length > 0) {
    const campLines = campaignsResult.rows.map((c) => {
      const budget = c['budget_amount_micros'] ? `$${(Number(c['budget_amount_micros']) / 1_000_000).toFixed(2)}` : '-';
      const cost = c['cost_micros'] ? `$${(Number(c['cost_micros']) / 1_000_000).toFixed(2)}` : '-';
      return `  - "${c['name']}" [${c['status']}] тип=${c['campaign_type'] ?? '-'}, бюджет=${budget}, расход=${cost}, impressions=${c['impressions'] ?? 0}, clicks=${c['clicks'] ?? 0}, CTR=${c['ctr'] ?? '-'}`;
    });
    parts.push(`КАМПАНИИ (${campaignsResult.rows.length}):\n${campLines.join('\n')}`);
  } else {
    parts.push('КАМПАНИИ: нет данных');
  }

  // Domains section
  if (domainsResult.rows.length > 0) {
    parts.push(`ДОМЕНЫ: ${domainsResult.rows.map(d => d['domain_name']).join(', ')}`);
  }

  // Notifications section
  if (notifsResult.rows.length > 0) {
    const notifLines = notifsResult.rows.slice(0, 10).map((n) => {
      const date = n['created_at'] ? new Date(n['created_at'] as string).toLocaleDateString('ru-RU') : '?';
      return `  - ${date} [${n['severity']}]: ${n['title']}`;
    });
    parts.push(`УВЕДОМЛЕНИЯ (последние ${notifsResult.rows.length}):\n${notifLines.join('\n')}`);
  }

  // Assessment section
  if (assessmentResult.rows[0]) {
    const a = assessmentResult.rows[0];
    parts.push(`ASSESSMENT:
- Уровень риска: ${a['risk_level']}
- Скор: ${a['risk_score']}
- Дата: ${a['created_at'] ? new Date(a['created_at'] as string).toLocaleDateString('ru-RU') : '-'}`);
  }

  // ML prediction
  parts.push(predictionText);

  return parts.join('\n\n');
}

/**
 * Chat with AI about a specific account.
 */
export async function chatWithAccount(
  pool: pg.Pool,
  request: ChatRequest,
): Promise<ChatResponse> {
  const context = await buildAccountContext(pool, request.accountGoogleId);

  const adapters = getConfiguredAdapters();
  if (adapters.length === 0) {
    throw new Error('Ни один AI-провайдер не настроен. Добавьте ANTHROPIC_API_KEY, OPENAI_API_KEY или GEMINI_API_KEY.');
  }

  // Prefer Claude, then GPT, then Gemini
  const adapter = adapters[0]!;

  const systemPrompt = `${CHAT_SYSTEM_PROMPT}

КОНТЕКСТ АККАУНТА (данные актуальны на момент запроса):
${context}`;

  // Build conversation history for multi-turn
  const conversationMessages = request.messages
    .map((m) => `${m.role === 'user' ? 'Байер' : 'Ассистент'}: ${m.content}`)
    .join('\n\n');

  const userPrompt = conversationMessages;

  const response = await adapter.call(systemPrompt, userPrompt);

  return {
    reply: response.text,
    model: response.model,
    tokens: response.tokens,
    latencyMs: response.latencyMs,
  };
}
