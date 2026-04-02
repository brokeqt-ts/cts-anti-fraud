import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Clock, ShieldBan, ShieldOff, AlertCircle, Bell, UserPlus, DollarSign, ShieldAlert, TrendingUp } from 'lucide-react';
import { fetchOverview, fetchActivity, fetchParsedData, fetchAnalyticsOverview, ApiError, type OverviewStats, type ActivityEvent, type ParsedData, type AnalyticsOverview, timeAgo, formatCid, formatBanReason } from '../api.js';
import { StatCard } from '../components/stats-card.js';
import { VerticalBadge, TargetBadge } from '../components/badge.js';
import { StatsSkeleton, TableSkeleton } from '../components/skeleton.js';
import {
  BlurFade,
  StaggerContainer,
  StaggerItem,
  AnimatedRow,
  DotPattern,
  NumberTicker,
} from '../components/ui/animations.js';

export function DashboardPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [analyticsOverview, setAnalyticsOverview] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchOverview()
      .then(setStats)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      });
    fetchActivity().then(setActivity).catch(() => {});
    fetchParsedData().then(setParsed).catch((e) => console.warn('[dashboard] parsedData failed:', e));
    fetchAnalyticsOverview().then(setAnalyticsOverview).catch((e) => console.warn('[dashboard] analyticsOverview failed:', e));
  }, [navigate]);

  if (error) {
    return (
      <div className="p-8">
        <BlurFade><ErrorCard message={error} /></BlurFade>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <StaggerContainer className="py-5 px-6 space-y-1.5" staggerDelay={0.06}>
      {/* Header */}
      <StaggerItem>
        <h1 className="text-lg font-semibold mb-[14px] tracking-tight" style={{ color: 'var(--text-primary)' }}>Обзор</h1>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{today}</p>
      </StaggerItem>

      {/* Stats */}
      {!stats ? (
        <StaggerItem><StatsSkeleton /></StaggerItem>
      ) : (
        <>
          <StaggerItem>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
              <BlurFade delay={0}><StatCard label="Всего аккаунтов" value={stats.total_accounts} /></BlurFade>
              <BlurFade delay={0.06}><StatCard label="Активные" value={stats.active_accounts} accent="green" /></BlurFade>
              <BlurFade delay={0.12}><StatCard label="Банов" value={stats.total_bans} accent="red" /></BlurFade>
              <BlurFade delay={0.18}>
                <StatCard label="Ср. время жизни" value={stats.avg_lifetime_hours != null ? `${stats.avg_lifetime_hours}ч` : '-'} accent="amber" icon={<Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />} />
              </BlurFade>
            </div>
          </StaggerItem>

          {/* Account Health Breakdown */}
          <StaggerItem>
            <AccountHealthBar stats={stats} />
          </StaggerItem>

          {/* Quick Stats Row */}
          <StaggerItem>
            <QuickStatsRow stats={stats} parsed={parsed} />
          </StaggerItem>
        </>
      )}

      {/* Lifetime & Ban Rate */}
      {analyticsOverview && (
        <StaggerItem>
          <LifetimeBanRateCards overview={analyticsOverview} />
        </StaggerItem>
      )}

      {/* Two-column: Recent bans + Risk Overview */}
      <StaggerItem>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1.5">
          {/* Recent bans — 2/3 */}
          <div className="lg:col-span-2 card-static overflow-hidden">
            <div className="px-3.5 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Последние баны</h2>
              <Link to="/bans" className="text-xs flex items-center gap-1 transition-colors" style={{ color: 'var(--text-muted)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}>
                Все баны <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            {!stats ? (
              <TableSkeleton rows={5} cols={5} />
            ) : stats.recent_bans.length === 0 ? (
              <EmptyState icon={<ShieldOff className="w-8 h-8" />} message="Банов пока нет" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Дата</th>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Аккаунт</th>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Вертикаль</th>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Причина</th>
                    <th className="px-3.5 py-[7px] text-left font-medium label-xs">Цель</th>
                    <th className="px-3.5 py-[7px] text-right font-medium label-xs">Лайфтайм</th>
                  </tr>
                </thead>
                <StaggerContainer as="tbody" staggerDelay={0.04} className="">
                  {stats.recent_bans.map((ban) => (
                    <AnimatedRow key={ban.id} className="cursor-pointer" onClick={() => navigate(`/bans/${ban.id}`)}>
                      <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(ban.banned_at)}</td>
                      <td className="px-3.5 py-[7px]">
                        <Link to={`/accounts/${ban.account_google_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
                          {formatCid(ban.account_google_id)}
                        </Link>
                      </td>
                      <td className="px-3.5 py-[7px] text-xs truncate max-w-[120px]" style={{ color: ban.domain ? 'var(--accent-green)' : 'var(--text-muted)' }}>{ban.domain ? ban.domain.replace(/^https?:\/\//, '').replace(/\/$/, '') : '-'}</td>
                      <td className="px-3.5 py-[7px]"><VerticalBadge vertical={ban.offer_vertical} /></td>
                      <td className="px-3.5 py-[7px] text-xs truncate max-w-[140px]" style={{ color: 'var(--text-muted)' }} title={ban.ban_reason ?? ban.ban_reason_internal ?? undefined}>{formatBanReason(ban.ban_reason ?? ban.ban_reason_internal)}</td>
                      <td className="px-3.5 py-[7px]"><TargetBadge target={ban.ban_target} /></td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{ban.lifetime_hours != null ? `${ban.lifetime_hours}ч` : '-'}</td>
                    </AnimatedRow>
                  ))}
                </StaggerContainer>
              </table>
            )}
          </div>

          {/* Risk overview — 1/3 */}
          <BlurFade delay={0.2}>
            <div className="card-static p-[12px_14px] space-y-1.5">
              <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Обзор рисков</h2>

              {stats && Object.keys(stats.bans_by_vertical).length > 0 && (
                <div className="space-y-3">
                  <p className="label-xs">По вертикали</p>
                  {Object.entries(stats.bans_by_vertical).map(([v, count]) => (
                    <div key={v} className="flex items-center justify-between">
                      <VerticalBadge vertical={v} />
                      <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}

              {stats && Object.keys(stats.bans_by_target).length > 0 && (
                <div className="space-y-3">
                  <p className="label-xs">По цели</p>
                  {Object.entries(stats.bans_by_target).map(([t, count]) => (
                    <div key={t} className="flex items-center justify-between">
                      <TargetBadge target={t} />
                      <span className="font-mono text-sm" style={{ color: 'var(--text-secondary)' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}

              <Link to="/bans/new" className="btn-ghost-green w-full">Записать бан</Link>
            </div>
          </BlurFade>
        </div>
      </StaggerItem>

      {/* Two-column: Lifetime Distribution + Activity Feed */}
      <StaggerItem>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
          {stats?.lifetime_distribution && <LifetimeDistribution data={stats.lifetime_distribution} totalBans={stats.total_bans} />}
          {activity.length > 0 && <ActivityFeed events={activity} />}
        </div>
      </StaggerItem>

      {/* Ban Trend */}
      {stats?.weekly_ban_trend && stats.weekly_ban_trend.length > 0 && (
        <StaggerItem>
          <BanTrendChart data={stats.weekly_ban_trend} />
        </StaggerItem>
      )}
    </StaggerContainer>
  );
}

/* ── Здоровье аккаунтов ──────────────────────────────────── */

function AccountHealthBar({ stats }: { stats: OverviewStats }) {
  const total = stats.total_accounts;
  const active = stats.active_accounts;
  const atRisk = stats.at_risk_accounts ?? 0;
  const suspended = stats.suspended_accounts ?? Math.max(0, total - active - atRisk);
  const pctActive = total > 0 ? (active / total) * 100 : 0;
  const pctSuspended = total > 0 ? (suspended / total) * 100 : 0;
  const pctAtRisk = total > 0 ? (atRisk / total) * 100 : 0;

  return (
    <div className="card-static p-[12px_14px]">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Здоровье аккаунтов</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: '#4ade80' }}><NumberTicker value={active} /></span> активных
          {' · '}
          <span style={{ color: '#f87171' }}>{suspended}</span> заблокировано
          {' · '}
          <span style={{ color: '#fbbf24' }}>{atRisk}</span> под угрозой
        </span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div className="h-full transition-all duration-700" style={{ width: `${pctActive}%`, background: 'rgba(34,197,94,0.6)' }} />
        <div className="h-full transition-all duration-700" style={{ width: `${pctAtRisk}%`, background: 'rgba(245,158,11,0.5)' }} />
        <div className="h-full transition-all duration-700" style={{ width: `${pctSuspended}%`, background: 'rgba(239,68,68,0.5)' }} />
      </div>
    </div>
  );
}

/* ── Быстрая статистика ─────────────────────────────────── */

function QuickStatsRow({ stats, parsed }: { stats: OverviewStats; parsed: ParsedData | null }) {
  const verticals = Object.entries(stats.bans_by_vertical);
  const topVertical = verticals.length > 0 ? verticals.sort((a, b) => b[1] - a[1])[0] : null;
  const topVerticalPct = topVertical && stats.total_bans > 0 ? ((topVertical[1] / stats.total_bans) * 100).toFixed(1) : null;

  const reasons = stats.recent_bans.reduce<Record<string, number>>((acc, b) => {
    if (b.ban_reason) { acc[b.ban_reason] = (acc[b.ban_reason] ?? 0) + 1; }
    return acc;
  }, {});
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  const lastBan = stats.recent_bans[0];

  // Campaign stats from parsed data — deduplicate by campaign_id
  const dedupedCampaigns = (() => {
    const raw = parsed?.campaigns ?? [];
    const map = new Map<string, typeof raw[number]>();
    for (const c of raw) {
      const existing = map.get(c.campaign_id);
      if (!existing || c.captured_at > existing.captured_at) {
        map.set(c.campaign_id, c);
      }
    }
    return [...map.values()];
  })();
  const campaignCount = dedupedCampaigns.length;
  const totalDailyBudget = dedupedCampaigns.reduce((sum, c) => {
    return sum + (c.budget_micros ? Number(c.budget_micros) / 1_000_000 : 0);
  }, 0);
  const budgetCurrency = dedupedCampaigns[0]?.currency;
  const budgetSym = budgetCurrency === 'EUR' ? '€' : budgetCurrency === 'USD' ? '$' : budgetCurrency === 'GBP' ? '£' : (budgetCurrency ?? '');

  // Ad stats — deduplicate by ad_id
  const adsCount = (() => {
    const raw = parsed?.ads ?? [];
    const seen = new Set<string>();
    for (const a of raw) {
      seen.add(a.ad_id);
    }
    return seen.size;
  })();

  const items = [
    campaignCount > 0 ? { label: 'Кампаний', value: String(campaignCount) } : null,
    adsCount > 0 ? { label: 'Объявлений', value: String(adsCount) } : null,
    totalDailyBudget > 0 ? { label: 'Бюджет', value: `${budgetSym}${totalDailyBudget.toFixed(2)}/день` } : null,
    { label: 'Ср. лайфтайм', value: stats.avg_lifetime_hours != null ? `${stats.avg_lifetime_hours}ч (${(stats.avg_lifetime_hours / 24).toFixed(1)}д)` : '-' },
    topVertical ? { label: 'Частая вертикаль', value: `${topVertical[0]} (${topVerticalPct}%)` } : null,
    topReason ? { label: 'Частая причина', value: formatBanReason(topReason[0]) } : null,
    lastBan ? { label: 'Последний бан', value: timeAgo(lastBan.banned_at) } : null,
  ].filter((x): x is { label: string; value: string } => x != null);

  return (
    <div className="flex flex-wrap gap-3">
      {items.map((item) => (
        <div key={item.label} className="px-4 py-2.5 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-hover)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}: </span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Распределение лайфтайма ────────────────────────────── */

function LifetimeDistribution({ data, totalBans }: { data: Record<string, number>; totalBans: number }) {
  const max = Math.max(...Object.values(data), 1);
  return (
    <div className="card-static p-[12px_14px]">
      <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Распределение лайфтайма</h2>
      <div className="space-y-3">
        {Object.entries(data).map(([bucket, count]) => (
          <div key={bucket} className="flex items-center gap-3">
            <span className="text-xs w-20 text-right flex-shrink-0 font-mono" style={{ color: 'var(--text-muted)' }}>{bucket}</span>
            <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
              <div className="h-full rounded-md transition-all duration-700 flex items-center justify-end pr-2" style={{ width: `${(count / max) * 100}%`, minWidth: count > 0 ? 24 : 0, background: 'rgba(34,197,94,0.25)' }}>
                {count > 0 && <span className="text-xs font-mono" style={{ color: '#4ade80', fontSize: 10 }}>{count}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>Всего банов: {totalBans}</p>
    </div>
  );
}

/* ── Лента активности ───────────────────────────────────── */

const eventIcons: Record<string, { icon: typeof ShieldBan; color: string }> = {
  ban: { icon: ShieldBan, color: 'var(--accent-red)' },
  signal: { icon: AlertCircle, color: 'var(--accent-amber)' },
  notification: { icon: Bell, color: '#3b82f6' },
  account: { icon: UserPlus, color: 'var(--accent-green)' },
};

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="card-static overflow-hidden">
      <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Лента активности</h2>
      </div>
      <div className="max-h-80 overflow-auto">
        <div className="p-3 space-y-0.5">
          {events.slice(0, 15).map((evt) => {
            const cfg = eventIcons[evt.type] ?? eventIcons['notification']!;
            const Icon = cfg.icon;
            return (
              <Link key={evt.id} to={`/accounts/${evt.account_google_id}`} className="flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors" style={{ textDecoration: 'none' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                    <span className="font-mono" style={{ color: 'var(--text-primary)', opacity: 0.7 }}>{evt.account_google_id}</span>
                    {' '}{evt.message}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{evt.display_name} · {timeAgo(evt.timestamp)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Тренд банов ─────────────────────────────────────── */

function BanTrendChart({ data }: { data: Array<{ week: string; count: number }> }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="card-static p-[12px_14px]">
      <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Тренд банов (8 недель)</h2>
      <div className="flex items-end gap-2" style={{ height: 80 }}>
        {data.map((d) => (
          <div key={d.week} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end justify-center" style={{ height: 60 }}>
              <div className="w-full max-w-8 rounded-t-md transition-all duration-700" style={{ height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 1)}px`, background: d.count > 0 ? 'rgba(239,68,68,0.4)' : 'var(--bg-hover)' }}>
                {d.count > 0 && (
                  <div className="text-center" style={{ marginTop: -16 }}>
                    <span className="text-xs font-mono" style={{ color: '#f87171', fontSize: 10 }}>{d.count}</span>
                  </div>
                )}
              </div>
            </div>
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)', fontSize: 9 }}>{d.week}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Lifetime & Ban Rate ───────────────────────────────── */

const VERTICAL_COLORS: Record<string, string> = {
  gambling: '#f87171', nutra: '#4ade80', crypto: '#fbbf24', dating: '#f472b6',
  sweepstakes: '#a78bfa', ecom: '#60a5fa', finance: '#34d399', other: '#94a3b8', unknown: '#64748b',
};

function LifetimeBanRateCards({ overview }: { overview: AnalyticsOverview }) {
  const { lifetime, ban_rate, spend } = overview;

  const cards = [
    {
      label: 'Средний lifetime',
      value: lifetime.total_bans > 0 ? `${lifetime.avg_hours}ч` : '—',
      sub: lifetime.total_bans > 0
        ? `мин ${lifetime.min_hours}ч / макс ${lifetime.max_hours}ч`
        : 'Нет данных о банах',
      icon: Clock,
      color: '#60a5fa',
    },
    {
      label: 'Ban Rate',
      value: ban_rate.total_accounts > 0 ? `${ban_rate.rate_pct}%` : '—',
      sub: `${ban_rate.banned_accounts} из ${ban_rate.total_accounts} аккаунтов`,
      icon: ShieldAlert,
      color: ban_rate.rate_pct > 50 ? '#f87171' : ban_rate.rate_pct > 25 ? '#fbbf24' : '#4ade80',
    },
    {
      label: 'Ср. расход до бана',
      value: spend.bans_with_spend > 0 ? `$${spend.avg_lifetime_spend}` : '—',
      sub: spend.bans_with_spend > 0
        ? `всего $${spend.total_lifetime_spend} (${spend.bans_with_spend} банов)`
        : 'Нет данных о расходах',
      icon: DollarSign,
      color: '#fbbf24',
    },
    {
      label: 'Всего банов',
      value: String(lifetime.total_bans),
      sub: ban_rate.suspended_accounts > 0
        ? `${ban_rate.suspended_accounts} сейчас suspended`
        : `${ban_rate.active_accounts} активных`,
      icon: TrendingUp,
      color: '#a78bfa',
    },
  ];

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="card-static p-[12px_14px]"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <card.icon className="w-3.5 h-3.5" style={{ color: card.color }} strokeWidth={1.5} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{card.label}</span>
            </div>
            <div className="text-lg font-bold font-mono" style={{ color: card.color }}>{card.value}</div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {overview.by_vertical.length > 0 && (
        <div className="card-static p-[12px_14px]">
          <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Lifetime по вертикалям</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {overview.by_vertical.map((v) => (
              <div key={v.vertical} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--bg-raised)' }}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: VERTICAL_COLORS[v.vertical] ?? '#64748b' }} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{v.vertical}</div>
                  <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {v.avg_lifetime_hours}ч · ${v.avg_spend} · {v.ban_count} банов
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Общие компоненты ───────────────────────────────────── */

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 p-[12px_14px]" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10 }}>
      <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-red-400">Не удалось загрузить данные</p>
        <p className="text-xs mt-1" style={{ color: 'rgba(239,68,68,0.5)' }}>{message}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="relative py-16 flex flex-col items-center justify-center gap-3 overflow-hidden">
      <DotPattern />
      <div style={{ color: 'var(--border-strong)' }}>{icon}</div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{message}</p>
    </div>
  );
}
