import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Bell, BellRing, Copy, MapPin, Database, Shield, LayoutList, Wallet, ExternalLink, Megaphone, Search, BarChart3, Tag, Eye, Star } from 'lucide-react';
import { fetchAccount, patchAccount, generatePostMortem, fetchAccountCompetitiveIntelligence, fetchQualityDistribution, fetchLowQualityKeywords, fetchQualityHistory, ApiError, type AccountDetail, type AccountSummary, type AccountCompetitorRow, type PostMortemData, type CampaignRow, type CampaignMetric, type BillingRow, type AdRow, type KeywordRow, type KeywordDailyStat, type QualityDistributionEntry, type KeywordQualityRow, type QualityScoreSnapshot, timeAgo, formatDateRu, formatCid, riskLevel, effectiveStatus, isSuspendedFromSignal } from '../api.js';
import { StatusBadge } from '../components/badge.js';
import { TableSkeleton } from '../components/skeleton.js';
import {
  BlurFade,
  StaggerContainer,
  StaggerItem,
  AnimatedRow,
  ShimmerBorder,
  DotPattern,
} from '../components/ui/animations.js';

const RISK_LABELS: Record<string, string> = {
  high: 'Высокий риск',
  medium: 'Средний риск',
  low: 'Низкий риск',
  unknown: 'Неизвестен',
};

/** Parsed notification card data. */
interface NotifCard {
  title: string;
  description: string;
  category: 'CRITICAL' | 'WARNING' | 'INFO';
  type: string;
  label: string;
}

const CATEGORY_STYLES: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#f87171', bg: 'rgba(239,68,68,0.08)', label: 'CRITICAL' },
  WARNING: { color: '#fbbf24', bg: 'rgba(245,158,11,0.08)', label: 'WARNING' },
  INFO: { color: '#60a5fa', bg: 'rgba(59,130,246,0.08)', label: 'INFO' },
};

/**
 * Parse notification items from the raw nested JSON structure.
 *
 * The notification object has field "notifications" which contains field "2"
 * which is an array of items. Each item:
 *   - item["50"]["1"] = title
 *   - item["50"]["2"] = description
 *   - item["50"]["5"] = array of {1: Name, 2: Value} pairs
 *   - item["6"] = label (fallback)
 *   - item["3"] = notification code
 *   - item["4"] = sub-code
 */
function parseNotificationCards(raw: unknown): NotifCard[] {
  if (raw == null) return [];

  if (typeof raw !== 'object' || Array.isArray(raw)) return [];

  const obj = raw as Record<string, unknown>;

  // Try the nested structure: obj["notifications"]["2"] -> array
  // The raw value from the DB row is `n.notifications`, which IS the notification object
  // It may have a "2" field directly, or a "notifications" wrapper
  let items: unknown[] | null = null;

  // Direct: { "2": [...] }
  if (Array.isArray(obj['2'])) {
    items = obj['2'] as unknown[];
  }
  // Wrapped: { notifications: { "2": [...] } }
  const notifs = obj['notifications'];
  if (!items && notifs && typeof notifs === 'object' && !Array.isArray(notifs)) {
    const inner = notifs as Record<string, unknown>;
    if (Array.isArray(inner['2'])) {
      items = inner['2'] as unknown[];
    }
  }

  if (!items || items.length === 0) {
    // Fallback: try old format { "1": [entries...] }
    const entries = obj['1'];
    if (Array.isArray(entries) && entries.length > 0) {
      return entries.map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        return parseLegacyEntry(entry as Record<string, unknown>);
      }).filter((x): x is NotifCard => x != null);
    }
    return [];
  }

  const cards: NotifCard[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const card = parseNotifItem(item as Record<string, unknown>);
    if (card) cards.push(card);
  }
  return cards;
}

function parseNotifItem(item: Record<string, unknown>): NotifCard | null {
  const field50 = item['50'] as Record<string, unknown> | undefined;
  const title = field50?.['1'] as string | undefined;
  const description = field50?.['2'] as string | undefined;
  const kvPairs = field50?.['5'] as Array<Record<string, string>> | undefined;
  const label = (item['6'] as string) ?? '';

  // Extract category and type from key-value pairs
  let category: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  let type = '';

  if (Array.isArray(kvPairs)) {
    for (const kv of kvPairs) {
      const name = kv['1'];
      const value = kv['2'];
      if (name === 'Category') {
        if (value === 'CRITICAL') category = 'CRITICAL';
        else if (value === 'WARNING') category = 'WARNING';
        else category = 'INFO';
      }
      if (name === 'Type') {
        type = value ?? '';
      }
    }
  }

  // Infer category from label/title if not found in kvPairs
  if (!kvPairs || kvPairs.length === 0) {
    const allText = `${title ?? ''} ${description ?? ''} ${label}`.toLowerCase();
    if (allText.includes('suspend') || allText.includes('violation') || allText.includes('disapproved')) {
      category = 'CRITICAL';
    } else if (allText.includes('warning') || allText.includes('payment') || allText.includes('billing')) {
      category = 'WARNING';
    }
  }

  // If no title/description, use label as fallback
  if (!title && !description && !label) return null;

  return {
    title: title ?? label ?? 'Уведомление',
    description: description ?? '',
    category,
    type,
    label,
  };
}

function parseLegacyEntry(entry: Record<string, unknown>): NotifCard | null {
  const strings: string[] = [];
  collectStrings(entry, strings, 0, 5);
  const meaningful = strings.filter((s) => s.length > 3 && !/^\d+$/.test(s));
  if (meaningful.length === 0) return null;

  const allText = meaningful.join(' ');
  let category: 'CRITICAL' | 'WARNING' | 'INFO' = 'INFO';
  if (/suspend|violation|disapproved|PolicyViolation/i.test(allText)) category = 'CRITICAL';
  else if (/payment|billing|warning/i.test(allText)) category = 'WARNING';

  return {
    title: meaningful[0] ?? 'Уведомление',
    description: meaningful.slice(1).join(' '),
    category,
    type: '',
    label: '',
  };
}

function collectStrings(obj: unknown, out: string[], depth: number, maxDepth: number): void {
  if (depth > maxDepth || obj == null) return;
  if (typeof obj === 'string' && obj.length > 0) { out.push(obj); return; }
  if (Array.isArray(obj)) { for (const item of obj) collectStrings(item, out, depth + 1, maxDepth); return; }
  if (typeof obj === 'object') { for (const val of Object.values(obj as Record<string, unknown>)) collectStrings(val, out, depth + 1, maxDepth); }
}

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AccountDetail | null>(null);
  const [competitors, setCompetitors] = useState<AccountCompetitorRow[]>([]);
  const [qsDist, setQsDist] = useState<{ distribution: QualityDistributionEntry[]; aggregates: { avg_qs: number | null; total_keywords: number; common_ctr: number | null; common_relevance: number | null; common_landing: number | null } } | null>(null);
  const [qsLow, setQsLow] = useState<KeywordQualityRow[] | null>(null);
  const [qsHistory, setQsHistory] = useState<QualityScoreSnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    fetchAccount(id)
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      });
    fetchAccountCompetitiveIntelligence(id)
      .then((r) => setCompetitors(r.competitors))
      .catch(() => {});
    fetchQualityDistribution(id).then(setQsDist).catch(() => {});
    fetchLowQualityKeywords(id).then((r) => setQsLow(r.keywords)).catch(() => {});
    fetchQualityHistory(id).then((r) => setQsHistory(r.history)).catch(() => {});
  }, [id, navigate]);

  if (error) {
    return (
      <div className="py-5 px-6">
        <BlurFade>
          <div className="p-6 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>{error}</div>
        </BlurFade>
      </div>
    );
  }

  if (!data) return <div className="py-5 px-6"><TableSkeleton rows={8} cols={3} /></div>;

  const acc = data.account;
  const derivedStatus = effectiveStatus({ account_status: acc['account_status'] as string | null, suspended_signal: acc['suspended_signal'] ?? (data.signals.length > 0 ? data.signals[0]?.signal_value : null) });
  const isSuspended = derivedStatus === 'suspended' || derivedStatus === 'banned';
  const risk = riskLevel({
    account_status: derivedStatus,
    ban_count: String(data.bans.length),
    suspended_signal: acc['suspended_signal'],
    notifications_count: data.notifications.length,
  } as AccountSummary);

  const daysSinceCreation = acc['created_at'] ? Math.floor((Date.now() - new Date(acc['created_at'] as string).getTime()) / 86400000) : null;

  const copyId = () => {
    navigator.clipboard.writeText(id ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const billingAddr = acc['billing_address'] as Record<string, string> | null;
  const dedupedCampaigns = deduplicateCampaigns(data.campaigns ?? []);

  // Use parsed notification_details from API when available, fallback to client-side parsing
  const parsedNotifDetails = data.notification_details ?? [];
  const allNotifCards: Array<NotifCard & { id: string; captured_at: string }> = [];
  if (parsedNotifDetails.length > 0) {
    for (const nd of parsedNotifDetails) {
      allNotifCards.push({
        id: nd.id,
        title: nd.title ?? nd.label ?? nd.notification_type ?? 'Уведомление',
        description: nd.description ?? '',
        category: (nd.category as 'CRITICAL' | 'WARNING' | 'INFO') ?? 'INFO',
        type: nd.notification_type ?? '',
        label: nd.label ?? '',
        captured_at: nd.captured_at,
      });
    }
  } else {
    for (const n of data.notifications) {
      const cards = parseNotificationCards(n.notifications);
      for (let i = 0; i < cards.length; i++) {
        allNotifCards.push({ ...cards[i]!, id: `${n.id}-${i}`, captured_at: n.captured_at });
      }
    }
  }

  const headerContent = (
    <div className="card-static p-[12px_14px]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
            {(acc['display_name'] as string) || `Google Ads ${formatCid(id ?? '')}`}
            {(acc['profile_name'] as string | null) != null && (
              <span style={{ color: 'var(--text-muted)' }}>{' · '}{acc['profile_name'] as string}{acc['browser_type'] ? ` (${acc['browser_type'] as string})` : ''}</span>
            )}
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>CID: {id}</span>
            <button onClick={copyId} className="p-1 rounded-md transition-colors" style={{ color: copied ? 'var(--accent-green)' : 'var(--text-muted)' }} title="Копировать CID">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          {(() => {
            const metaItems: string[] = [];
            const email = acc['email'] as string | null;
            const languages = acc['languages'] as string[] | null;
            const gtagId = acc['gtag_id'] as string | null;
            const conversionTrackingId = acc['conversion_tracking_id'] as string | null;
            if (email) metaItems.push(`📧 ${email}`);
            if (languages && Array.isArray(languages) && languages.length > 0) metaItems.push(`🌍 ${languages.join(', ')}`);
            if (gtagId) metaItems.push(`🏷️ ${gtagId}`);
            else if (conversionTrackingId) metaItems.push(`🏷️ AW-${conversionTrackingId}`);
            return metaItems.length > 0 ? (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{metaItems.join(' · ')}</p>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={derivedStatus} />
          <span className={`risk-badge-${risk} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}>{RISK_LABELS[risk]}</span>
          <Link to={`/assessment?account=${id}`} className="btn-ghost-green text-xs" style={{ padding: '4px 10px' }}>Оценить риск</Link>
          <Link to={`/bans/new?account=${id}`} className="btn-ghost-red">Записать бан</Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-6 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {isSuspended ? (
          <MetricPill label="Статус" value="Заблокирован" />
        ) : (
          daysSinceCreation != null && <MetricPill label="Активен" value={`${daysSinceCreation}д`} />
        )}
        <MetricPill label="Кампании" value={String(dedupedCampaigns.length)} />
        <MetricPill label="Уведомления" value={String(allNotifCards.length || data.notifications.length)} />
        <MetricPill label="Баны" value={String(data.bans.length)} />
        {acc['total_spend'] != null && (
          <MetricPill label="Расход" value={`${(acc['currency'] as string) === 'EUR' ? '€' : (acc['currency'] as string) === 'USD' ? '$' : (acc['currency'] as string) === 'GBP' ? '£' : ((acc['currency'] as string) ?? '') + ' '}${Number(acc['total_spend']).toLocaleString()}`} />
        )}
      </div>
    </div>
  );

  return (
    <StaggerContainer className="py-5 px-6 space-y-1.5" staggerDelay={0.06}>
      <StaggerItem>
        <Link to="/accounts" className="inline-flex items-center gap-1.5 text-xs transition-colors" style={{ color: 'var(--text-muted)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
          <ArrowLeft className="w-3 h-3" /> Аккаунты
        </Link>
      </StaggerItem>

      <StaggerItem>
        {isSuspended ? <ShimmerBorder color="var(--accent-red)">{headerContent}</ShimmerBorder> : headerContent}
      </StaggerItem>

      {/* Signal Timeline */}
      {data.signals.length > 0 && (
        <StaggerItem>
          <div className="card-static p-[12px_14px]">
            <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
              <Shield className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
              Таймлайн сигналов ({data.signals.length})
            </h2>
            <SignalTimeline signals={data.signals} />
          </div>
        </StaggerItem>
      )}

      {/* Campaigns — hide when empty */}
      {dedupedCampaigns.length > 0 && (
        <StaggerItem>
          <CampaignsSection campaigns={data.campaigns ?? []} campaignMetrics={data.campaign_metrics ?? []} />
        </StaggerItem>
      )}

      {/* Spend Timeline */}
      {(data.keyword_daily_stats ?? []).length > 0 && (
        <StaggerItem>
          <SpendTimeline stats={data.keyword_daily_stats ?? []} currency={(data.campaigns?.[0]?.currency) ?? null} />
        </StaggerItem>
      )}

      {/* Keywords — hide when empty */}
      {(data.keywords ?? []).length > 0 && (
        <StaggerItem>
          <KeywordsSection keywords={data.keywords ?? []} />
        </StaggerItem>
      )}

      {/* Quality Score — show when distribution data exists */}
      {qsDist && qsDist.distribution.length > 0 && (
        <StaggerItem>
          <QualityScoreSection distribution={qsDist.distribution} aggregates={qsDist.aggregates} lowKeywords={qsLow ?? []} history={qsHistory ?? []} />
        </StaggerItem>
      )}

      {/* Ads — hide when empty */}
      {(data.ads ?? []).filter(adHasContent).length > 0 && (
        <StaggerItem>
          <AdsSection ads={data.ads ?? []} />
        </StaggerItem>
      )}

      {/* Two-column: Billing (RPC) + Notifications */}
      <StaggerItem>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          <BillingSection billing={data.billing ?? null} accPaymentMethod={acc['payment_method'] as string | null} accPayer={acc['payer_name'] as string | null} accCurrency={acc['currency'] as string | null} accProfileId={acc['payments_profile_id'] as string | null} billingAddr={billingAddr} />

          <div className="card-static p-[12px_14px] space-y-4">
            <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              <Bell className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
              Уведомления ({allNotifCards.length || data.notifications.length})
            </h2>
            {data.notifications.length === 0 ? (
              <div className="relative py-8 flex flex-col items-center justify-center gap-2 overflow-hidden">
                <DotPattern />
                <CheckCircle className="w-5 h-5" style={{ color: 'var(--border-hover)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Уведомлений нет</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-auto">
                {allNotifCards.length > 0 ? allNotifCards.map((card) => {
                  const catStyle = CATEGORY_STYLES[card.category] ?? CATEGORY_STYLES['INFO']!;
                  return (
                    <div key={card.id} className="rounded-lg p-3" style={{ background: catStyle.bg, border: `1px solid ${catStyle.color}20` }}>
                      <div className="flex items-start gap-2">
                        <BellRing className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: catStyle.color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{card.title}</span>
                            <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium" style={{ background: `${catStyle.color}18`, color: catStyle.color, fontSize: 9 }}>{catStyle.label}</span>
                          </div>
                          {card.description && (
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{card.description}</p>
                          )}
                          {card.type && (
                            <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{card.type}</p>
                          )}
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{timeAgo(card.captured_at)}</span>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="text-xs p-2" style={{ color: 'var(--text-muted)' }}>
                    {data.notifications.length} уведомлений (не удалось распарсить)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </StaggerItem>

      {/* Consumables: Account Type + Offer Vertical */}
      <StaggerItem>
        <ConsumablesSection googleId={id ?? ''} account={acc} onUpdate={(updated) => {
          setData((prev) => prev ? { ...prev, account: { ...prev.account, ...updated } } : prev);
        }} />
      </StaggerItem>

      {/* Competitors */}
      {competitors.length > 0 && (
        <StaggerItem>
          <AccountCompetitorsSection competitors={competitors} />
        </StaggerItem>
      )}

      {/* Ban History */}
      <StaggerItem>
        <BanHistorySection bans={data.bans} navigate={navigate} accountCid={id ?? ''} />
      </StaggerItem>

      {/* Raw Data Stats */}
      <StaggerItem>
        <div className="card-static p-[12px_14px]">
          <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
            <Database className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
            Сырые данные
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            <InfoField label="Всего payload-ов" value={data.payload_stats.total_payloads ? Number(data.payload_stats.total_payloads).toLocaleString() : '0'} />
            <InfoField label="Первый визит" value={data.payload_stats.first_seen ? formatDateRu(data.payload_stats.first_seen) : null} />
            <InfoField label="Последний визит" value={data.payload_stats.last_seen ? timeAgo(data.payload_stats.last_seen) : null} />
          </div>
        </div>
      </StaggerItem>
    </StaggerContainer>
  );
}

function SignalTimeline({ signals }: { signals: AccountDetail['signals'] }) {
  const sorted = [...signals].sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-0 min-w-fit">
        {sorted.map((s, i) => {
          const isTrue = isSuspendedFromSignal(s.signal_value);
          return (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className="rounded-full flex-shrink-0" style={{ width: 12, height: 12, background: isTrue ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)', boxShadow: isTrue ? '0 0 8px rgba(239,68,68,0.3)' : '0 0 8px rgba(34,197,94,0.3)' }} />
                <span className="text-xs mt-1.5 whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9 }}>
                  {new Date(s.captured_at).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' })}
                </span>
                <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                  {new Date(s.captured_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              {i < sorted.length - 1 && (
                <div className="flex-shrink-0 mx-1" style={{ width: 32, height: 2, background: 'var(--border-subtle)' }} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="rounded-full" style={{ width: 6, height: 6, background: 'rgba(34,197,94,0.6)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Активен</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="rounded-full" style={{ width: 6, height: 6, background: 'rgba(239,68,68,0.6)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Заблокирован</span>
        </div>
      </div>
    </div>
  );
}

function BanSourceBadge({ source }: { source?: string }) {
  const isAuto = source === 'auto';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: isAuto ? 'rgba(59,130,246,0.1)' : 'rgba(156,163,175,0.1)',
        color: isAuto ? '#3b82f6' : 'var(--text-muted)',
        border: `1px solid ${isAuto ? 'rgba(59,130,246,0.2)' : 'var(--border-subtle)'}`,
      }}
    >
      {isAuto ? 'Авто' : 'Ручной'}
    </span>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-semibold font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{value ?? '-'}</dd>
    </div>
  );
}

/* ── Campaign helpers ─────────────────────────────────────── */

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  '2': 'Search',
  '3': 'Display',
  '9': 'PMax',
  '12': 'DemandGen',
};

const CAMPAIGN_STATUS_MAP: Record<string, { label: string; color: string }> = {
  '2': { label: 'Paused', color: 'var(--accent-amber)' },
  '3': { label: 'Enabled', color: 'var(--accent-green)' },
};

const BIDDING_STRATEGY_LABELS: Record<string, string> = {
  '2': 'Manual CPC',
  '3': 'Manual CPV',
  '4': 'Manual CPM',
  '10': 'Max Conversions',
  '11': 'Max Conv. Value',
  '12': 'Target CPA',
  '13': 'Target ROAS',
  '14': 'Target Impr. Share',
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  '1': 'Broad',
  '2': 'Phrase',
  '3': 'Exact',
};

/** Parse Google Ads date format "YYYYMMDDHHmmss" or "YYYYMMDD" → Date. */
function parseGadsDate(s: string | null): Date | null {
  if (!s || s.length < 8) return null;
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  return new Date(`${y}-${m}-${d}`);
}

function formatGadsDate(s: string | null): string {
  const d = parseGadsDate(s);
  if (!d || isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function formatBudget(micros: string | null, currency: string | null): string {
  if (!micros) return '-';
  const amount = Number(micros) / 1_000_000;
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : currency === 'CHF' ? 'CHF ' : (currency ?? '') + ' ';
  return `${sym}${amount.toFixed(2)}/день`;
}

/** Deduplicate campaigns by campaign_id, keeping the most recent captured_at. */
function deduplicateCampaigns(campaigns: CampaignRow[]): CampaignRow[] {
  const map = new Map<string, CampaignRow>();
  for (const c of campaigns) {
    const existing = map.get(c.campaign_id);
    if (!existing || c.captured_at > existing.captured_at) {
      map.set(c.campaign_id, c);
    }
  }
  return [...map.values()];
}

function CampaignsSection({ campaigns: raw, campaignMetrics }: { campaigns: CampaignRow[]; campaignMetrics: CampaignMetric[] }) {
  const campaigns = deduplicateCampaigns(raw);
  const metricsMap = new Map(campaignMetrics.map(m => [m.campaign_id, m]));
  const hasMetrics = campaignMetrics.length > 0;
  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <LayoutList className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          Кампании ({campaigns.length})
        </h2>
      </div>
      {campaigns.length === 0 ? (
        <div className="relative py-10 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <DotPattern />
          <LayoutList className="w-5 h-5" style={{ color: 'var(--border-hover)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет кампаний</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Кампания</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Тип</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Стратегия</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Бюджет</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Статус</th>
                {hasMetrics && <>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Показы</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Клики</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">CTR</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Расход</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">CPC</th>
                </>}
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Дата</th>
              </tr>
            </thead>
            <StaggerContainer as="tbody" staggerDelay={0.04} className="">
              {campaigns.map((c) => {
                const typeLabel = CAMPAIGN_TYPE_LABELS[String(c.campaign_type)] ?? String(c.campaign_type ?? '-');
                const st = CAMPAIGN_STATUS_MAP[String(c.status)];
                const biddingLabel = c.bidding_strategy_type != null ? (BIDDING_STRATEGY_LABELS[String(c.bidding_strategy_type)] ?? `#${c.bidding_strategy_type}`) : '-';
                const m = metricsMap.get(c.campaign_id);
                const currency = c.currency;
                const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '';
                return (
                  <AnimatedRow key={c.id}>
                    <td className="px-3.5 py-[7px] text-xs max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }}>{c.campaign_name ?? c.campaign_id}</td>
                    <td className="px-3.5 py-[7px]">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{typeLabel}</span>
                    </td>
                    <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{biddingLabel}</td>
                    <td className="px-3.5 py-[7px] font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatBudget(c.budget_micros, c.currency)}</td>
                    <td className="px-3.5 py-[7px]">
                      {st ? (
                        <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{String(c.status ?? '-')}</span>
                      )}
                    </td>
                    {hasMetrics && <>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{m?.impressions ? Number(m.impressions).toLocaleString() : '-'}</td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{m?.clicks ? Number(m.clicks).toLocaleString() : '-'}</td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{m?.ctr ? `${Number(m.ctr).toFixed(1)}%` : '-'}</td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{m?.cost_micros ? `${sym}${(Number(m.cost_micros) / 1_000_000).toFixed(2)}` : '-'}</td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{m?.avg_cpc_micros && Number(m.avg_cpc_micros) > 0 ? `${sym}${(Number(m.avg_cpc_micros) / 1_000_000).toFixed(2)}` : '-'}</td>
                    </>}
                    <td className="px-3.5 py-[7px] text-right text-xs" style={{ color: 'var(--text-muted)' }}>{formatGadsDate(c.start_date)}</td>
                  </AnimatedRow>
                );
              })}
            </StaggerContainer>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Ads section ──────────────────────────────────────── */

const AD_TYPE_LABELS: Record<string, string> = {
  responsive_search: 'RSA',
};

/** Deduplicate ads by ad_id, keeping the most recent captured_at. */
function deduplicateAds(ads: AdRow[]): AdRow[] {
  const map = new Map<string, AdRow>();
  for (const a of ads) {
    const existing = map.get(a.ad_id);
    if (!existing || a.captured_at > existing.captured_at) {
      map.set(a.ad_id, a);
    }
  }
  return [...map.values()];
}

/** Check if an ad has any displayable content (headlines, descriptions, or URLs). */
function adHasContent(ad: AdRow): boolean {
  const headlines = Array.isArray(ad.headlines) ? ad.headlines : [];
  const descriptions = Array.isArray(ad.descriptions) ? ad.descriptions : [];
  const finalUrls = Array.isArray(ad.final_urls) ? ad.final_urls : [];
  return headlines.length > 0 || descriptions.length > 0 || finalUrls.length > 0 || !!ad.display_url;
}

function AdsSection({ ads: raw }: { ads: AdRow[] }) {
  const allAds = deduplicateAds(raw);
  const ads = allAds.filter(adHasContent);
  const skipped = allAds.length - ads.length;
  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <Megaphone className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          Объявления ({ads.length})
          {skipped > 0 && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>+{skipped} без контента</span>}
        </h2>
      </div>
      {ads.length === 0 ? (
        <div className="relative py-10 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <DotPattern />
          <Megaphone className="w-5 h-5" style={{ color: 'var(--border-hover)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет объявлений</p>
        </div>
      ) : (
        <div className="p-3 space-y-2 max-h-[500px] overflow-auto">
          {ads.map((ad) => {
            const headlines = Array.isArray(ad.headlines) ? ad.headlines : [];
            const descriptions = Array.isArray(ad.descriptions) ? ad.descriptions : [];
            const finalUrls = Array.isArray(ad.final_urls) ? ad.final_urls : [];
            const landingUrl = finalUrls[0] ?? null;
            const typeLabel = ad.ad_type ? (AD_TYPE_LABELS[ad.ad_type] ?? ad.ad_type) : null;

            return (
              <div key={ad.id} className="rounded-lg p-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}>
                {/* Headlines as chips */}
                {headlines.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {headlines.map((h, i) => (
                      <span key={i} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.15)', fontSize: 11 }}>
                        {h}
                      </span>
                    ))}
                  </div>
                )}

                {/* Descriptions */}
                {descriptions.slice(0, 2).map((d, i) => (
                  <p key={i} className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    {d.length > 100 ? d.slice(0, 100) + '…' : d}
                  </p>
                ))}

                {/* Landing URL + Display URL + Type badge */}
                <div className="flex items-center flex-wrap gap-2 mt-2">
                  {landingUrl && (
                    <a href={landingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-mono transition-colors" style={{ color: 'var(--accent-green)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#86efac'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-green)'; }}>
                      <ExternalLink className="w-3 h-3" />
                      {landingUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {ad.display_url && !landingUrl && (
                    <span className="text-xs font-mono" style={{ color: 'var(--accent-green)' }}>{ad.display_url}</span>
                  )}
                  {typeLabel && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.15)' }}>{typeLabel}</span>
                  )}
                </div>

                {/* IDs */}
                <div className="flex gap-3 mt-1.5">
                  {ad.campaign_id && <span className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>campaign: {ad.campaign_id}</span>}
                  {ad.ad_group_id && <span className="text-xs font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>ad_group: {ad.ad_group_id}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Billing section ──────────────────────────────────────── */

function BillingSection({ billing, accPaymentMethod, accPayer, accCurrency, accProfileId, billingAddr }: {
  billing: BillingRow | null;
  accPaymentMethod: string | null;
  accPayer: string | null;
  accCurrency: string | null;
  accProfileId: string | null;
  billingAddr: Record<string, string> | null;
}) {
  const paymentMethod = billing?.payment_method ?? accPaymentMethod;
  const threshold = billing?.threshold_micros ? `${(Number(billing.threshold_micros) / 1_000_000).toFixed(2)}` : null;
  const thresholdCurrency = accCurrency === 'EUR' ? '€' : accCurrency === 'USD' ? '$' : accCurrency === 'GBP' ? '£' : (accCurrency ?? '');

  return (
    <div className="card-static p-[12px_14px] space-y-4">
      <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        <Wallet className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
        Биллинг
      </h2>
      {!billing && !accPaymentMethod ? (
        <div className="relative py-6 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <DotPattern />
          <Wallet className="w-5 h-5" style={{ color: 'var(--border-hover)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет данных о биллинге</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <InfoField label="Способ оплаты" value={paymentMethod} />
            <InfoField label="Баланс" value={billing?.balance_formatted ?? '-'} />
            {threshold && <InfoField label="Порог" value={`${thresholdCurrency}${threshold}`} />}
            <InfoField label="Плательщик" value={accPayer} />
            <InfoField label="Валюта" value={accCurrency} />
            <InfoField label="Платёжный профиль" value={accProfileId} />
          </div>
          {billingAddr && (
            <div className="pt-4" style={{ borderTop: '1px solid var(--bg-hover)' }}>
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {billingAddr.company && <p className="font-medium">{billingAddr.company}</p>}
                  {billingAddr.name && <p>{billingAddr.name}</p>}
                  {billingAddr.address && <p>{billingAddr.address}</p>}
                  <p>{[billingAddr.city, billingAddr.country].filter(Boolean).join(', ')}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Keywords section ──────────────────────────────────────── */

function formatCostFromMicros(micros: string | null, currency: string | null): string {
  if (!micros) return '-';
  const amount = Number(micros) / 1_000_000;
  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : (currency ?? '') + ' ';
  return `${sym}${amount.toFixed(2)}`;
}

function QualityScoreDot({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
  const color = score >= 7 ? 'var(--accent-green)' : score >= 4 ? 'var(--accent-amber)' : '#f87171';
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold" style={{ color }}>
      {score}
    </span>
  );
}

function KeywordsSection({ keywords }: { keywords: KeywordRow[] }) {
  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <Search className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          Ключевые слова ({keywords.length})
        </h2>
      </div>
      {keywords.length === 0 ? (
        <div className="relative py-10 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <DotPattern />
          <Search className="w-5 h-5" style={{ color: 'var(--border-hover)' }} />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Нет ключевых слов</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Ключевое слово</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Тип</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">QS</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Показы</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Клики</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">CTR</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">CPC</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Расход</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Conv.</th>
              </tr>
            </thead>
            <StaggerContainer as="tbody" staggerDelay={0.03} className="">
              {keywords.map((kw) => {
                const matchLabel = MATCH_TYPE_LABELS[String(kw.match_type)] ?? String(kw.match_type ?? '-');
                const ctrStr = kw.ctr != null ? `${(Number(kw.ctr) * 100).toFixed(1)}%` : '-';
                return (
                  <AnimatedRow key={kw.id}>
                    <td className="px-3.5 py-[7px] text-xs max-w-[250px] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {kw.is_negative && <span style={{ color: '#f87171' }}>- </span>}
                      {kw.keyword_text}
                    </td>
                    <td className="px-3.5 py-[7px]">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', fontSize: 10 }}>{matchLabel}</span>
                    </td>
                    <td className="px-3.5 py-[7px] text-right"><QualityScoreDot score={kw.quality_score} /></td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{kw.impressions ? Number(kw.impressions).toLocaleString() : '-'}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{kw.clicks ? Number(kw.clicks).toLocaleString() : '-'}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{ctrStr}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{formatCostFromMicros(kw.avg_cpc_micros, kw.currency)}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatCostFromMicros(kw.cost_micros, kw.currency)}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{kw.conversions != null && Number(kw.conversions) > 0 ? Number(kw.conversions).toFixed(1) : '-'}</td>
                  </AnimatedRow>
                );
              })}
            </StaggerContainer>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Spend Timeline ──────────────────────────────────────── */

function SpendTimeline({ stats, currency }: { stats: KeywordDailyStat[]; currency: string | null }) {
  // Group by date, pick stats.cost (or stats.clicks for fallback)
  const costByDate = new Map<string, number>();
  const clicksByDate = new Map<string, number>();
  const impressionsByDate = new Map<string, number>();

  for (const s of stats) {
    const val = s.metric_value != null ? Number(s.metric_value) : 0;
    if (s.metric_name === 'stats.cost') costByDate.set(s.date, (costByDate.get(s.date) ?? 0) + val);
    if (s.metric_name === 'stats.clicks') clicksByDate.set(s.date, (clicksByDate.get(s.date) ?? 0) + val);
    if (s.metric_name === 'stats.impressions') impressionsByDate.set(s.date, (impressionsByDate.get(s.date) ?? 0) + val);
  }

  // Use cost if available, otherwise clicks
  const hasCost = costByDate.size > 0;
  const dataMap = hasCost ? costByDate : clicksByDate;
  const metricLabel = hasCost ? 'Расход' : 'Клики';

  const dates = [...dataMap.keys()].sort();
  if (dates.length === 0) return null;

  const values = dates.map(d => dataMap.get(d) ?? 0);
  const maxVal = Math.max(...values, 1);

  const sym = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '';
  const formatVal = (v: number) => hasCost ? `${sym}${(v / 1_000_000).toFixed(2)}` : String(Math.round(v));

  // Summary
  const totalCost = [...costByDate.values()].reduce((a, b) => a + b, 0);
  const totalClicks = [...clicksByDate.values()].reduce((a, b) => a + b, 0);
  const totalImpressions = [...impressionsByDate.values()].reduce((a, b) => a + b, 0);

  return (
    <div className="card-static p-[12px_14px]">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <BarChart3 className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
          {metricLabel} по дням ({dates.length} дн.)
        </h2>
        <div className="flex items-center gap-3">
          {totalCost > 0 && (
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
              Расход: {sym}{(totalCost / 1_000_000).toFixed(2)}
            </span>
          )}
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            Клики: {totalClicks.toLocaleString()}
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            Показы: {totalImpressions.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: 80 }}>
        {dates.map((date, i) => {
          const val = values[i] ?? 0;
          const pct = Math.max((val / maxVal) * 100, 2);
          const dateObj = new Date(date);
          const dayLabel = dateObj.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
          return (
            <div key={date} className="flex flex-col items-center flex-1 min-w-0 group" title={`${dayLabel}: ${formatVal(val)}`}>
              <div
                className="w-full rounded-t transition-all"
                style={{
                  height: `${pct}%`,
                  minHeight: 2,
                  background: 'rgba(59,130,246,0.5)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderBottom: 'none',
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] mt-1">
        {dates.map((date) => {
          const dateObj = new Date(date);
          return (
            <div key={date} className="flex-1 min-w-0 text-center">
              <span className="text-xs" style={{ color: 'var(--text-muted)', fontSize: 8 }}>
                {dateObj.getDate()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Consumables Section ──────────────────────────────────── */

const ACCOUNT_TYPE_OPTIONS = [
  { value: '', label: 'Не указан' },
  { value: 'farm', label: 'Фарм' },
  { value: 'bought', label: 'Покупной' },
  { value: 'rent', label: 'Аренда' },
  { value: 'agency', label: 'Агентский' },
  { value: 'restored', label: 'Восстановленный' },
  { value: 'other', label: 'Другой' },
  { value: 'unknown', label: 'Unknown' },
];

const VERTICAL_OPTIONS = [
  { value: '', label: 'Не указана' },
  { value: 'gambling', label: 'Gambling' },
  { value: 'nutra', label: 'Nutra' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'dating', label: 'Dating' },
  { value: 'sweepstakes', label: 'Sweepstakes' },
  { value: 'ecom', label: 'E-commerce' },
  { value: 'finance', label: 'Finance' },
  { value: 'other', label: 'Other' },
];

const VERTICAL_COLORS: Record<string, string> = {
  gambling: '#f87171',
  nutra: '#34d399',
  crypto: '#fbbf24',
  dating: '#f472b6',
  sweepstakes: '#a78bfa',
  ecom: '#60a5fa',
  finance: '#2dd4bf',
  other: '#9ca3af',
};

function ConsumablesSection({
  googleId,
  account,
  onUpdate,
}: {
  googleId: string;
  account: Record<string, unknown>;
  onUpdate: (updated: Record<string, unknown>) => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleChange = useCallback(async (field: string, value: string) => {
    setSaving(true);
    try {
      const res = await patchAccount(googleId, { [field]: value || null });
      onUpdate(res.account);
    } catch {
      // Silently fail — inline edit
    } finally {
      setSaving(false);
    }
  }, [googleId, onUpdate]);

  const accountType = (account['account_type'] as string) ?? '';
  const accountTypeSource = (account['account_type_source'] as string) ?? null;
  const vertical = (account['offer_vertical'] as string) ?? '';
  const verticalSource = (account['offer_vertical_source'] as string) ?? null;
  const fingerprintHash = (account['fingerprint_hash'] as string) ?? null;
  const dailySpendLimit = account['daily_spend_limit'] as number | null;
  const currency = (account['currency'] as string) ?? '';

  return (
    <div className="card-static p-[12px_14px]">
      <h2 className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
        <Tag className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: 'var(--text-muted)' }} />
        Расходники и теги
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label-xs block mb-1">
            Тип аккаунта
            {accountTypeSource && (
              <span className="ml-1 text-xs" style={{ color: 'var(--text-ghost)', fontSize: 9 }}>
                ({accountTypeSource === 'auto' ? 'авто' : 'ручной'})
              </span>
            )}
          </label>
          <select
            value={accountType}
            onChange={(e) => handleChange('account_type', e.target.value)}
            disabled={saving}
            className="w-full rounded-lg px-2.5 py-1.5 text-xs transition-colors"
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
              outline: 'none',
            }}
          >
            {ACCOUNT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label-xs block mb-1">
            Вертикаль
            {verticalSource && (
              <span className="ml-1 text-xs" style={{ color: 'var(--text-ghost)', fontSize: 9 }}>
                ({verticalSource === 'auto' ? 'авто' : 'ручной'})
              </span>
            )}
          </label>
          <select
            value={vertical}
            onChange={(e) => handleChange('offer_vertical', e.target.value)}
            disabled={saving}
            className="w-full rounded-lg px-2.5 py-1.5 text-xs transition-colors"
            style={{
              background: 'var(--bg-raised)',
              border: `1px solid ${vertical ? (VERTICAL_COLORS[vertical] ?? 'var(--border-subtle)') + '40' : 'var(--border-subtle)'}`,
              color: vertical ? (VERTICAL_COLORS[vertical] ?? 'var(--text-secondary)') : 'var(--text-secondary)',
              outline: 'none',
            }}
          >
            {VERTICAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label-xs block mb-1">Прокси-провайдер</label>
          <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', color: account['proxy_provider'] ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
            {(account['proxy_provider'] as string) || (account['proxy_info'] ? String(account['proxy_info']) : '—')}
          </div>
        </div>

        <div>
          <label className="label-xs block mb-1">Платёжка</label>
          <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', color: account['payment_service'] ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
            {(account['payment_service'] as string) || '—'}
          </div>
        </div>
      </div>

      {/* Second row: fingerprint + spend limit */}
      {(fingerprintHash || dailySpendLimit != null) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {fingerprintHash && (
            <div className="col-span-2">
              <label className="label-xs block mb-1">Fingerprint</label>
              <div
                className="text-xs px-2.5 py-1.5 rounded-lg font-mono truncate cursor-help"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                title={fingerprintHash}
              >
                {fingerprintHash.slice(0, 16)}...
              </div>
            </div>
          )}
          {dailySpendLimit != null && (
            <div>
              <label className="label-xs block mb-1">Лимит расхода</label>
              <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                {currency === 'USD' ? '$' : currency === 'EUR' ? '\u20AC' : currency + ' '}{dailySpendLimit.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Account Competitors ─────────────────────────────────── */

function AccountCompetitorsSection({ competitors }: { competitors: AccountCompetitorRow[] }) {
  const maxIS = Math.max(...competitors.map(c => c.avg_impression_share), 0.01);

  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <Eye className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: '#818cf8' }} />
          Конкуренты ({competitors.length})
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
              <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
              <th className="px-3.5 py-[7px] text-left font-medium label-xs" style={{ width: '25%' }}>Impr. Share</th>
              <th className="px-3.5 py-[7px] text-right font-medium label-xs">Overlap</th>
              <th className="px-3.5 py-[7px] text-right font-medium label-xs">Pos. Above</th>
              <th className="px-3.5 py-[7px] text-right font-medium label-xs">Top Page</th>
              <th className="px-3.5 py-[7px] text-right font-medium label-xs">Outranking</th>
              <th className="px-3.5 py-[7px] text-right font-medium label-xs">Точки</th>
            </tr>
          </thead>
          <StaggerContainer as="tbody" staggerDelay={0.03} className="">
            {competitors.map((c) => (
              <AnimatedRow key={c.domain}>
                <td className="px-3.5 py-[7px] text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{c.domain}</td>
                <td className="px-3.5 py-[7px]">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max((c.avg_impression_share / maxIS) * 100, 2)}%`,
                          background: c.avg_impression_share > 0.5 ? '#f87171' : c.avg_impression_share > 0.2 ? '#fbbf24' : '#818cf8',
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                      {(c.avg_impression_share * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: c.avg_overlap_rate > 0.5 ? '#f87171' : 'var(--text-muted)' }}>
                  {(c.avg_overlap_rate * 100).toFixed(1)}%
                </td>
                <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: c.avg_position_above_rate > 0.5 ? '#fbbf24' : 'var(--text-muted)' }}>
                  {(c.avg_position_above_rate * 100).toFixed(1)}%
                </td>
                <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {(c.avg_top_of_page_rate * 100).toFixed(1)}%
                </td>
                <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {(c.avg_outranking_share * 100).toFixed(1)}%
                </td>
                <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>
                  {c.data_points}
                </td>
              </AnimatedRow>
            ))}
          </StaggerContainer>
        </table>
      </div>
    </div>
  );
}

/* ── Ban History with Post-Mortem ────────────────────────── */

function BanHistorySection({ bans, navigate, accountCid }: { bans: import('../api.js').BanSummary[]; navigate: (path: string) => void; accountCid: string }) {
  const [expandedPm, setExpandedPm] = useState<string | null>(null);
  const [pmData, setPmData] = useState<Record<string, PostMortemData>>({});
  const [pmLoading, setPmLoading] = useState<Record<string, boolean>>({});

  const handlePm = async (banId: string, existing: unknown) => {
    if (expandedPm === banId) { setExpandedPm(null); return; }
    if (pmData[banId]) { setExpandedPm(banId); return; }
    if (existing && typeof existing === 'object') {
      setPmData((prev) => ({ ...prev, [banId]: existing as PostMortemData }));
      setExpandedPm(banId);
      return;
    }
    setPmLoading((prev) => ({ ...prev, [banId]: true }));
    try {
      const result = await generatePostMortem(banId);
      setPmData((prev) => ({ ...prev, [banId]: result }));
      setExpandedPm(banId);
    } catch { /* silently fail */ }
    setPmLoading((prev) => ({ ...prev, [banId]: false }));
  };

  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>История банов ({bans.length})</h2>
      </div>
      {bans.length === 0 ? (
        <div className="relative py-12 flex flex-col items-center justify-center gap-2 overflow-hidden">
          <DotPattern />
          <CheckCircle className="w-6 h-6" style={{ color: 'var(--border-hover)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Банов нет</p>
        </div>
      ) : (
        <div>
          {bans.map((b) => {
            const hasPm = !!b.post_mortem_generated_at || !!pmData[b.id];
            const isExpanded = expandedPm === b.id;
            return (
              <div key={b.id} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <div className="flex items-center gap-2 px-3.5 py-[7px] cursor-pointer group" onClick={() => navigate(`/bans/${b.id}`)}>
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)', minWidth: 90 }}>{b.banned_at ? formatDateRu(b.banned_at) : '-'}</span>
                  <span className="text-xs truncate flex-1" style={{ color: 'var(--text-muted)' }}>{b.ban_reason ?? b.ban_reason_internal ?? '-'}</span>
                  <BanSourceBadge source={b.source} />
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{b.ban_target}</span>
                  <span className="text-right font-mono text-xs flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 40 }}>{b.lifetime_hours != null ? `${b.lifetime_hours}ч` : '-'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePm(b.id, b.post_mortem); }}
                    className="text-xs px-2 py-0.5 rounded-md transition-colors flex-shrink-0"
                    style={{
                      background: hasPm ? 'var(--bg-raised)' : 'rgba(59,130,246,0.1)',
                      color: hasPm ? 'var(--text-muted)' : '#60a5fa',
                      border: `1px solid ${hasPm ? 'var(--border-subtle)' : 'rgba(59,130,246,0.2)'}`,
                    }}
                    disabled={!!pmLoading[b.id]}
                  >
                    {pmLoading[b.id] ? '...' : hasPm ? (isExpanded ? 'Скрыть' : 'PM') : 'Post-Mortem'}
                  </button>
                </div>
                {isExpanded && pmData[b.id] && <PostMortemCard pm={pmData[b.id]} cid={accountCid} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string; icon: string }> = {
  critical: { color: '#f87171', bg: 'rgba(239,68,68,0.06)', icon: '●' },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.06)', icon: '●' },
  info: { color: '#60a5fa', bg: 'rgba(59,130,246,0.06)', icon: '●' },
};

function PostMortemCard({ pm, cid }: { pm: PostMortemData; cid: string }) {
  return (
    <div className="px-4 py-3 mx-2 mb-2 rounded-lg" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}>
      <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
        POST-MORTEM: {formatCid(cid)}
      </div>

      {/* Metrics row */}
      <div className="flex flex-wrap gap-3 mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {pm.lifetime_hours != null && <span>Lifetime: <b style={{ color: 'var(--text-secondary)' }}>{pm.lifetime_hours}ч</b></span>}
        {pm.total_spend_formatted && <span>Расход: <b style={{ color: 'var(--text-secondary)' }}>{pm.total_spend_formatted}</b></span>}
        {pm.keywords_count > 0 && <span>Keywords: <b style={{ color: 'var(--text-secondary)' }}>{pm.keywords_count}</b></span>}
        {pm.domain && <span>Домен: <b style={{ color: pm.domain_safe_score != null && pm.domain_safe_score < 40 ? '#f87171' : 'var(--text-secondary)' }}>{pm.domain}</b>{pm.domain_safe_score != null && <> (Score: {pm.domain_safe_score})</>}</span>}
        {pm.bidding_strategy && <span>Стратегия: <b style={{ color: 'var(--text-secondary)' }}>{pm.bidding_strategy}</b></span>}
      </div>

      {/* Factors */}
      {pm.factors.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-ghost)' }}>Факторы</div>
          <div className="space-y-1">
            {pm.factors.map((f, i) => {
              const s = SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES['info']!;
              return (
                <div key={i} className="flex items-start gap-1.5 text-xs rounded px-2 py-1" style={{ background: s.bg }}>
                  <span style={{ color: s.color, lineHeight: '16px' }}>{s.icon}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{f.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {pm.recommendations.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-ghost)' }}>Рекомендации</div>
          <ul className="space-y-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {pm.recommendations.map((r, i) => <li key={i} className="flex items-start gap-1.5"><span style={{ color: 'var(--text-ghost)' }}>•</span>{r}</li>)}
          </ul>
        </div>
      )}

      {/* Connected accounts */}
      {pm.connected_accounts.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-ghost)' }}>Связанные аккаунты</div>
          <div className="space-y-0.5 text-xs">
            {pm.connected_accounts.map((a) => (
              <div key={a.google_id} className="flex items-center gap-2">
                <Link to={`/accounts/${a.google_id}`} className="font-mono" style={{ color: 'var(--accent-green)' }}>{formatCid(a.google_id)}</Link>
                {a.domain && <span style={{ color: 'var(--text-muted)' }}>({a.domain})</span>}
                <span style={{ color: a.is_banned ? '#f87171' : '#4ade80', fontSize: 10 }}>{a.is_banned ? 'Забанен' : 'Активен'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Quality Score Section ──────────────────────────────────── */

const QS_COMP_LABELS: Record<number, string> = { 1: 'Ниже среднего', 2: 'Среднее', 3: 'Выше среднего' };
const QS_COMP_COLORS: Record<number, string> = { 1: '#f87171', 2: '#fbbf24', 3: '#4ade80' };

function QualityScoreSection({ distribution, aggregates, lowKeywords, history }: {
  distribution: QualityDistributionEntry[];
  aggregates: { avg_qs: number | null; total_keywords: number; common_ctr: number | null; common_relevance: number | null; common_landing: number | null };
  lowKeywords: KeywordQualityRow[];
  history: QualityScoreSnapshot[];
}) {
  const maxCount = Math.max(...distribution.map(d => d.keyword_count), 1);
  const qsBarColor = (qs: number) => qs <= 3 ? '#f87171' : qs <= 6 ? '#fbbf24' : '#4ade80';

  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <Star className="w-4 h-4 inline-block mr-1.5" strokeWidth={1.5} style={{ color: '#fbbf24' }} />
          Quality Score ({aggregates.total_keywords} ключевых слов)
        </h2>
      </div>

      <div className="p-3.5 space-y-4">
        {/* Distribution + Component Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* QS Distribution Bar Chart */}
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Распределение QS</div>
            <div className="space-y-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(qs => {
                const entry = distribution.find(d => d.quality_score === qs);
                const count = entry?.keyword_count ?? 0;
                const pct = (count / maxCount) * 100;
                return (
                  <div key={qs} className="flex items-center gap-2">
                    <span className="text-xs font-mono w-4 text-right flex-shrink-0" style={{ color: qsBarColor(qs) }}>{qs}</span>
                    <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                      <div className="h-full rounded" style={{ width: `${Math.max(pct, count > 0 ? 2 : 0)}%`, background: qsBarColor(qs), transition: 'width 0.5s ease-out' }} />
                    </div>
                    <span className="text-xs font-mono w-8 text-right flex-shrink-0" style={{ color: count > 0 ? 'var(--text-secondary)' : 'var(--text-ghost)' }}>{count}</span>
                  </div>
                );
              })}
            </div>
            {aggregates.avg_qs != null && (
              <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                Средний QS: <span className="font-bold font-mono" style={{ color: qsBarColor(Math.round(aggregates.avg_qs)) }}>{aggregates.avg_qs}</span>
              </div>
            )}
          </div>

          {/* Component Breakdown */}
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Компоненты (преобладающее значение)</div>
            <div className="space-y-3">
              {([
                { label: 'Landing page experience', value: aggregates.common_landing },
                { label: 'Ad relevance', value: aggregates.common_relevance },
                { label: 'Expected CTR', value: aggregates.common_ctr },
              ] as const).map(comp => (
                <div key={comp.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{comp.label}</span>
                    <span className="text-xs font-medium" style={{ color: comp.value != null ? (QS_COMP_COLORS[comp.value] ?? 'var(--text-muted)') : 'var(--text-ghost)' }}>
                      {comp.value != null ? (QS_COMP_LABELS[comp.value] ?? String(comp.value)) : '—'}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3].map(level => (
                      <div
                        key={level}
                        className="flex-1 h-1.5 rounded-full"
                        style={{ background: comp.value != null && level <= comp.value ? (QS_COMP_COLORS[comp.value] ?? 'var(--bg-hover)') : 'var(--bg-hover)' }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* QS Trend Chart */}
        {history.length > 1 && (
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Тренд QS по дням</div>
            <QSTrendChart history={history} />
          </div>
        )}

        {/* Low QS Keywords Table */}
        {lowKeywords.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
              Ключевые слова с низким QS ({lowKeywords.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <th className="px-3 py-1.5 text-left font-medium label-xs">Ключевое слово</th>
                    <th className="px-3 py-1.5 text-right font-medium label-xs">QS</th>
                    <th className="px-3 py-1.5 text-right font-medium label-xs">Landing</th>
                    <th className="px-3 py-1.5 text-right font-medium label-xs">Relevance</th>
                    <th className="px-3 py-1.5 text-right font-medium label-xs">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {lowKeywords.slice(0, 15).map(kw => (
                    <tr key={kw.keyword_id} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                      <td className="px-3 py-1.5 text-xs max-w-[250px] truncate" style={{ color: 'var(--text-secondary)' }}>{kw.keyword_text}</td>
                      <td className="px-3 py-1.5 text-right"><QualityScoreDot score={kw.quality_score} /></td>
                      <td className="px-3 py-1.5 text-right text-xs" style={{ color: QS_COMP_COLORS[kw.qs_landing_page ?? 0] ?? 'var(--text-ghost)' }}>{kw.qs_landing_page != null ? (QS_COMP_LABELS[kw.qs_landing_page] ?? '-') : '-'}</td>
                      <td className="px-3 py-1.5 text-right text-xs" style={{ color: QS_COMP_COLORS[kw.qs_ad_relevance ?? 0] ?? 'var(--text-ghost)' }}>{kw.qs_ad_relevance != null ? (QS_COMP_LABELS[kw.qs_ad_relevance] ?? '-') : '-'}</td>
                      <td className="px-3 py-1.5 text-right text-xs" style={{ color: QS_COMP_COLORS[kw.qs_expected_ctr ?? 0] ?? 'var(--text-ghost)' }}>{kw.qs_expected_ctr != null ? (QS_COMP_LABELS[kw.qs_expected_ctr] ?? '-') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QSTrendChart({ history }: { history: QualityScoreSnapshot[] }) {
  const values = history.map(h => h.quality_score ?? 0);
  const maxV = Math.max(...values, 10);
  const minV = Math.min(...values, 1);
  const range = Math.max(maxV - minV, 1);
  const width = 600;
  const height = 80;
  const padding = 4;

  const points = values.map((v, i) => {
    const x = padding + (i / Math.max(values.length - 1, 1)) * (width - 2 * padding);
    const y = height - padding - ((v - minV) / range) * (height - 2 * padding);
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height + 20} viewBox={`0 0 ${width} ${height + 20}`} className="w-full" style={{ minWidth: 400 }}>
        {/* Grid lines */}
        {[minV, Math.round((minV + maxV) / 2), maxV].map(v => {
          const y = height - padding - ((v - minV) / range) * (height - 2 * padding);
          return (
            <g key={v}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="var(--bg-hover)" strokeWidth="1" />
              <text x={0} y={y + 3} style={{ fontSize: 9, fill: 'var(--text-ghost)' }}>{v}</text>
            </g>
          );
        })}
        {/* Line */}
        <polyline fill="none" stroke="#4ade80" strokeWidth="2" points={points} />
        {/* Dots */}
        {values.map((v, i) => {
          const x = padding + (i / Math.max(values.length - 1, 1)) * (width - 2 * padding);
          const y = height - padding - ((v - minV) / range) * (height - 2 * padding);
          return <circle key={i} cx={x} cy={y} r={2.5} fill="#4ade80" />;
        })}
        {/* Date labels */}
        {history.filter((_, i) => i === 0 || i === history.length - 1 || i === Math.floor(history.length / 2)).map((h, idx) => {
          const origIdx = idx === 0 ? 0 : idx === 1 ? Math.floor(history.length / 2) : history.length - 1;
          const x = padding + (origIdx / Math.max(history.length - 1, 1)) * (width - 2 * padding);
          return (
            <text key={h.date} x={x} y={height + 14} textAnchor="middle" style={{ fontSize: 9, fill: 'var(--text-ghost)' }}>
              {new Date(h.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
