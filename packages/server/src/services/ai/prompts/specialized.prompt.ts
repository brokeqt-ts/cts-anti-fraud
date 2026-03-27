import type { AccountFeatureVector } from '../../../repositories/features.repository.js';
import type { PredictionResult } from '../../ml/ban-predictor.js';
import type { DomainAnalysisData } from './account-analysis.prompt.js';

export const SPECIALIZED_SYSTEM = `Ты — эксперт по антифроду Google Ads для команды медиабаинга.
Данные собраны через антидетект-браузер. Каждый аккаунт работает в изолированном профиле.
Команда работает с серыми и белыми вертикалями: gambling, nutra, crypto, dating, finance, sweepstakes, ecommerce.
Отвечай ТОЛЬКО на русском языке.
Отвечай ТОЛЬКО валидным JSON, соответствующим указанной схеме.
Не добавляй markdown-форматирование, backticks или другой текст вокруг JSON.`;

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface ConsumableData {
  proxy_type: string | null;
  proxy_geo: string | null;
  proxy_provider: string | null;
  proxy_ip: string | null;
  antidetect_browser: string | null;
  fingerprint_change_count: number;
  fingerprint_last_changed_at: string | null;
  payment_bin: string | null;
  payment_bank: string | null;
  payment_card_country: string | null;
}

export interface FarmAccount {
  id: string;
  features: AccountFeatureVector;
  prediction: PredictionResult | null;
  is_banned: boolean;
  ban_reason: string | null;
  offer_vertical: string | null;
  domain_name: string | null;
  domain_score: number | null;
}

// ─── 1. Rotation Strategy (after ban) ────────────────────────────────────────

export function buildRotationStrategyPrompt(
  accountGoogleId: string,
  banReason: string | null,
  lifetimeHours: number | null,
  features: AccountFeatureVector,
  consumables: ConsumableData,
  connectedAccounts: Array<{ google_account_id: string; shared_what: string }>,
): string {
  const sharedList = connectedAccounts.length > 0
    ? connectedAccounts.map(a => `  - ${a.google_account_id} (общий ресурс: ${a.shared_what})`).join('\n')
    : '  Нет известных связанных аккаунтов';

  return `Разработай стратегию ротации ресурсов после бана аккаунта Google Ads.

ЗАБАНЕННЫЙ АККАУНТ: ${accountGoogleId}
ПРИЧИНА БАНА: ${banReason ?? 'не указана'}
ВРЕМЯ ЖИЗНИ: ${lifetimeHours != null ? `${lifetimeHours} ч` : 'неизвестно'}
ВОЗРАСТ: ${features.account_age_days} дней
РАСХОД: $${features.total_spend_usd.toFixed(2)}

ИСПОЛЬЗОВАННЫЕ РЕСУРСЫ:
- Антидетект: ${consumables.antidetect_browser ?? 'неизвестен'}
- Смен fingerprint: ${consumables.fingerprint_change_count} (последняя: ${consumables.fingerprint_last_changed_at ?? 'нет данных'})
- Прокси: ${consumables.proxy_type ?? 'неизвестен'} / ${consumables.proxy_geo ?? '?'} (${consumables.proxy_provider ?? '?'})
- IP: ${consumables.proxy_ip ?? 'неизвестен'}
- Карта BIN: ${consumables.payment_bin ?? 'неизвестен'} (${consumables.payment_bank ?? '?'}, ${consumables.payment_card_country ?? '?'})
- Домен: используется в аккаунте, shared_domain_with_banned = ${features.shared_domain_with_banned}
- Shared BIN with banned: ${features.shared_bin_with_banned}

СВЯЗАННЫЕ АККАУНТЫ (используют те же ресурсы):
${sharedList}

ОТВЕТЬ в формате JSON:
{
  "ban_root_cause": "Основная причина бана на основе данных",
  "compromised_resources": [
    {
      "resource": "домен | карта | прокси | профиль",
      "risk_level": "critical | high | medium",
      "action": "немедленно сменить | сменить в течение 24ч | мониторить",
      "reasoning": "почему именно этот ресурс скомпрометирован"
    }
  ],
  "rotation_timeline": {
    "next_hour": ["Что сделать в первый час"],
    "next_24h": ["Что сделать в первые 24 часа"],
    "next_week": ["Что сделать на этой неделе"]
  },
  "affected_accounts": [
    {
      "account_id": "ID аккаунта",
      "risk": "critical | high | medium",
      "action": "что делать с этим аккаунтом"
    }
  ],
  "new_account_checklist": ["Что проверить перед запуском нового аккаунта взамен"],
  "confidence": "low | medium | high"
}`;
}

// ─── 2. Domain Audit ──────────────────────────────────────────────────────────

export function buildDomainAuditPrompt(
  domainAnalysis: DomainAnalysisData,
  offerVertical: string | null,
  accountAge: number | null,
): string {
  const vertical = offerVertical ?? 'неизвестна';
  const age = accountAge != null ? `${accountAge} дней` : 'неизвестен';

  const keywordList = domainAnalysis.keyword_matches.length > 0
    ? domainAnalysis.keyword_matches.map(k => `  - "${k.keyword}" [${k.vertical}, ${k.severity}]`).join('\n')
    : '  Нет';

  const redFlagList = domainAnalysis.red_flags.length > 0
    ? domainAnalysis.red_flags.map(f => `  - ${f.type} [${f.severity}]${f.detail ? ': ' + f.detail : ''}`).join('\n')
    : '  Нет';

  return `Проведи детальный аудит лендинга для Google Ads.

ДОМЕН: ${domainAnalysis.domain_name}
ВЕРТИКАЛЬ АККАУНТА: ${vertical}
ВОЗРАСТ АККАУНТА: ${age}

ОЦЕНКИ РИСКА:
- Контент: ${domainAnalysis.content_risk_score ?? 'нет данных'}/100
- Ключевые слова: ${domainAnalysis.keyword_risk_score ?? 'нет данных'}/100
- Compliance: ${domainAnalysis.compliance_score ?? 'нет данных'}/100
- Структура: ${domainAnalysis.structure_risk_score ?? 'нет данных'}/100

COMPLIANCE:
- Privacy Policy: ${domainAnalysis.has_privacy_policy ? '✓' : '✗ ОТСУТСТВУЕТ'}
- Terms of Service: ${domainAnalysis.has_terms_of_service ? '✓' : '✗ ОТСУТСТВУЕТ'}
- Disclaimer: ${domainAnalysis.has_disclaimer ? '✓' : '✗ ОТСУТСТВУЕТ'}
- Age Verification: ${domainAnalysis.has_age_verification ? '✓' : '✗ ОТСУТСТВУЕТ'}

КРАСНЫЕ ФЛАГИ:
- Countdown timer: ${domainAnalysis.has_countdown_timer ? '⚠ ОБНАРУЖЕН' : 'нет'}
- Fake reviews: ${domainAnalysis.has_fake_reviews ? '⚠ ОБНАРУЖЕНЫ' : 'нет'}
- Before/After: ${domainAnalysis.has_before_after ? '⚠ ОБНАРУЖЕНО' : 'нет'}
- Hidden text: ${domainAnalysis.has_hidden_text ? '⚠ ОБНАРУЖЕН' : 'нет'}
- URL mismatch: ${domainAnalysis.url_mismatch ? '⚠ URL НЕ СОВПАДАЕТ' : 'нет'}
- Редиректов: ${domainAnalysis.redirect_count}

СЕРЫЕ КЛЮЧЕВЫЕ СЛОВА:
${keywordList}

ДЕТАЛИЗИРОВАННЫЕ ФЛАГИ:
${redFlagList}

${domainAnalysis.analysis_summary ? `КРАТКИЙ АНАЛИЗ:\n${domainAnalysis.analysis_summary}` : ''}

ОТВЕТЬ в формате JSON:
{
  "verdict": "ЗАПУСКАТЬ | ЗАПУСКАТЬ С РИСКАМИ | НЕ ЗАПУСКАТЬ",
  "overall_risk": "LOW | MEDIUM | HIGH | CRITICAL",
  "critical_blockers": [
    {
      "issue": "Название проблемы",
      "detail": "Конкретное описание",
      "fix": "Что именно исправить",
      "priority": "critical | high"
    }
  ],
  "required_fixes": [
    {
      "issue": "Что нужно исправить",
      "fix": "Как исправить",
      "estimated_effort": "15 мин | 1 час | 1 день"
    }
  ],
  "optional_improvements": ["Что улучшит compliance без критической необходимости"],
  "risk_after_fixes": "LOW | MEDIUM | HIGH",
  "specific_policy_risks": ["Конкретные политики Google которые нарушены"],
  "confidence": "low | medium | high"
}`;
}

// ─── 3. Appeal Strategy ───────────────────────────────────────────────────────

export function buildAppealStrategyPrompt(
  accountGoogleId: string,
  banReason: string | null,
  lifetimeHours: number | null,
  features: AccountFeatureVector,
  domainAnalysis: DomainAnalysisData | null,
  fixesApplied: string[],
): string {
  const fixes = fixesApplied.length > 0
    ? fixesApplied.map(f => `  - ${f}`).join('\n')
    : '  Не указано';

  const domainSection = domainAnalysis
    ? `СОСТОЯНИЕ ЛЕНДИНГА:
- compliance_score: ${domainAnalysis.compliance_score ?? 'нет данных'}/100
- content_risk_score: ${domainAnalysis.content_risk_score ?? 'нет данных'}/100
- Privacy Policy: ${domainAnalysis.has_privacy_policy ? 'есть' : 'ОТСУТСТВУЕТ'}
- Terms of Service: ${domainAnalysis.has_terms_of_service ? 'есть' : 'ОТСУТСТВУЕТ'}
- Countdown timer: ${domainAnalysis.has_countdown_timer ? 'ЕСТЬ (нарушение)' : 'нет'}
- Fake reviews: ${domainAnalysis.has_fake_reviews ? 'ЕСТЬ (нарушение)' : 'нет'}`
    : 'СОСТОЯНИЕ ЛЕНДИНГА: данные не доступны';

  return `Разработай стратегию апелляции для забаненного аккаунта Google Ads.

АККАУНТ: ${accountGoogleId}
ПРИЧИНА БАНА: ${banReason ?? 'не указана'}
ВРЕМЯ ЖИЗНИ: ${lifetimeHours != null ? `${lifetimeHours} ч` : 'неизвестно'}

ДАННЫЕ АККАУНТА:
- Возраст: ${features.account_age_days} дней
- Расход: $${features.total_spend_usd.toFixed(2)}
- Нарушения политики: ${features.policy_violation_count}
- Отклонённые объявления: ${features.ad_disapproval_count}
- Связи с забаненными: ${features.connected_banned_accounts}
- Shared domain with banned: ${features.shared_domain_with_banned}

${domainSection}

ЧТО УЖЕ ИСПРАВЛЕНО:
${fixes}

ОТВЕТЬ в формате JSON:
{
  "should_appeal": true | false,
  "appeal_viability": "high | medium | low | pointless",
  "reasoning": "Почему апелляция имеет/не имеет смысла",
  "appeal_text_en": "Готовый текст апелляции на английском (если should_appeal = true)",
  "key_arguments": ["Ключевые аргументы для апелляции"],
  "what_to_fix_before_appeal": ["Что обязательно исправить ДО подачи апелляции"],
  "what_to_avoid": ["Чего НЕ писать в апелляции"],
  "timeline": "Когда подавать (сразу / через N дней / не подавать)",
  "if_rejected": {
    "next_attempt_after_days": 7,
    "alternative_strategy": "Что делать если апелляция отклонена"
  },
  "confidence": "low | medium | high"
}`;
}

// ─── 4. Farm Analysis ─────────────────────────────────────────────────────────

export function buildFarmAnalysisPrompt(
  accounts: FarmAccount[],
  sharedInfrastructure: {
    shared_bins: Array<{ bin: string; account_ids: string[] }>;
    shared_domains: Array<{ domain: string; account_ids: string[] }>;
    shared_proxies: Array<{ proxy_ip: string; account_ids: string[] }>;
  },
): string {
  const accountSummaries = accounts.map(a => {
    const pred = a.prediction ? ` ML:${(a.prediction.ban_probability * 100).toFixed(0)}%` : '';
    const status = a.is_banned ? `[ЗАБАНЕН: ${a.ban_reason ?? '?'}]` : '[АКТИВЕН]';
    return `  ${a.id} ${status} — возраст ${a.features.account_age_days}д, расход $${a.features.total_spend_usd.toFixed(0)}, нарушения ${a.features.policy_violation_count}, связи с баном ${a.features.connected_banned_accounts}, BIN ban rate ${a.features.bin_ban_rate ?? '?'}%, домен ${a.domain_name ?? '?'} (score: ${a.domain_score ?? '?'})${pred}`;
  }).join('\n');

  const binsSection = sharedInfrastructure.shared_bins.length > 0
    ? sharedInfrastructure.shared_bins.map(b =>
        `  BIN ${b.bin}: ${b.account_ids.join(', ')}`,
      ).join('\n')
    : '  Нет общих BIN';

  const domainsSection = sharedInfrastructure.shared_domains.length > 0
    ? sharedInfrastructure.shared_domains.map(d =>
        `  ${d.domain}: ${d.account_ids.join(', ')}`,
      ).join('\n')
    : '  Нет общих доменов';

  const proxiesSection = sharedInfrastructure.shared_proxies.length > 0
    ? sharedInfrastructure.shared_proxies.map(p =>
        `  ${p.proxy_ip}: ${p.account_ids.join(', ')}`,
      ).join('\n')
    : '  Нет общих прокси';

  return `Проанализируй группу аккаунтов Google Ads на предмет инфраструктурных рисков и цепных банов.

АККАУНТЫ (${accounts.length} шт.):
${accountSummaries}

ОБЩАЯ ИНФРАСТРУКТУРА:
Общие BIN:
${binsSection}

Общие домены:
${domainsSection}

Общие прокси/IP:
${proxiesSection}

ОТВЕТЬ в формате JSON:
{
  "farm_risk_level": "LOW | MEDIUM | HIGH | CRITICAL",
  "isolation_score": 0-100,
  "summary_ru": "Общая оценка состояния фарма",
  "most_at_risk": [
    {
      "account_id": "ID",
      "risk_level": "critical | high | medium",
      "reason": "Почему этот аккаунт в опасности"
    }
  ],
  "shared_vulnerabilities": [
    {
      "type": "bin | domain | proxy | profile",
      "value": "что именно общее",
      "affected_accounts": ["список ID"],
      "risk": "critical | high | medium",
      "action": "что делать"
    }
  ],
  "chain_ban_probability": "low | medium | high",
  "chain_ban_scenario": "Описание как может развиваться цепной бан",
  "immediate_isolations": [
    {
      "action": "Что разделить/сменить прямо сейчас",
      "accounts": ["ID аккаунтов"],
      "urgency": "critical | high"
    }
  ],
  "healthy_accounts": ["ID аккаунтов которые в безопасности"],
  "confidence": "low | medium | high"
}`;
}
