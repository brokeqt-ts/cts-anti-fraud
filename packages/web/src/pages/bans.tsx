import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ChevronRight, ShieldOff, TrendingUp, Clock, BarChart3, Download } from 'lucide-react';
import { fetchBans, fetchOverview, generatePostMortemAll, ApiError, type BanSummary, type OverviewStats, timeAgo, formatBanReason } from '../api.js';
import { downloadCsv } from '../utils/csv.js';
import { VerticalBadge, TargetBadge } from '../components/badge.js';
import { TableSkeleton } from '../components/skeleton.js';
import { DateRangePicker, type DateRange } from '../components/date-range-picker.js';
import {
  BlurFade,
  StaggerContainer,
  AnimatedRow,
  DotPattern,
} from '../components/ui/animations.js';

const VERTICALS = ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other'];
const TARGETS = ['account', 'domain', 'campaign', 'ad'];

export function BansPage() {
  const [bans, setBans] = useState<BanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pmBulk, setPmBulk] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchOverview().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (verticalFilter) params['offer_vertical'] = verticalFilter;
    if (targetFilter) params['ban_target'] = targetFilter;
    if (dateRange.from) params['from_date'] = dateRange.from;
    if (dateRange.to) params['to_date'] = dateRange.to;
    fetchBans(params)
      .then((data) => { setBans(data.bans); setTotal(data.total); })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      })
      .finally(() => setLoading(false));
  }, [verticalFilter, targetFilter, dateRange, navigate]);

  // Computed analytics
  const now = Date.now();
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
  const bansThisWeek = bans.filter((b) => now - new Date(b.banned_at).getTime() < oneWeekMs).length;
  const bansThisMonth = bans.filter((b) => now - new Date(b.banned_at).getTime() < oneMonthMs).length;
  const lifetimes = bans.map((b) => b.lifetime_hours).filter((h): h is number => h != null);
  const avgLifetime = lifetimes.length > 0 ? Math.round(lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length) : null;
  const minLifetime = lifetimes.length > 0 ? Math.min(...lifetimes) : null;
  const maxLifetime = lifetimes.length > 0 ? Math.max(...lifetimes) : null;

  // Ban trend from stats
  const trend = stats?.weekly_ban_trend ?? [];
  const trendMax = Math.max(...trend.map((t) => t.count), 1);

  return (
    <div className="py-5 px-6 space-y-1.5">
      <BlurFade>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold mb-[14px] tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Баны
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const headers = ['ID', 'Аккаунт', 'Дата бана', 'Цель', 'Причина', 'Вертикаль', 'Домен', 'Лайфтайм (ч)', 'Тип', 'Закрыт'];
                const rows = bans.map((b) => [
                  b.id,
                  b.account_google_id,
                  new Date(b.banned_at).toLocaleString('ru-RU'),
                  b.ban_target,
                  b.ban_reason ?? b.ban_reason_internal,
                  b.offer_vertical,
                  b.domain,
                  b.lifetime_hours,
                  b.source ?? 'manual',
                  b.resolved_at ? new Date(b.resolved_at).toLocaleString('ru-RU') : '',
                ]);
                downloadCsv(`bans_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}
              title="Экспорт в CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Скачать CSV
            </button>
            <button
              onClick={() => {
                setPmBulk('loading');
                generatePostMortemAll()
                  .then((r) => setPmBulk(`${r.generated} сгенерировано`))
                  .catch(() => setPmBulk('ошибка'));
              }}
              disabled={pmBulk === 'loading'}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.15)' }}
            >
              {pmBulk === 'loading' ? 'Генерация...' : pmBulk ?? 'Post-Mortem все'}
            </button>
            <Link to="/bans/new" className="btn-ghost-green">
              <Plus className="w-4 h-4" strokeWidth={1.5} /> Записать бан
            </Link>
          </div>
        </div>
      </BlurFade>

      {/* Аналитика банов */}
      {!loading && bans.length > 0 && (
        <BlurFade delay={0.04}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <AnalyticsPill icon={<BarChart3 className="w-3.5 h-3.5" />} label="Всего" value={String(total)} />
            <AnalyticsPill icon={<TrendingUp className="w-3.5 h-3.5" />} label="За неделю" value={String(bansThisWeek)} accent={bansThisWeek > 0 ? '#f87171' : undefined} />
            <AnalyticsPill icon={<TrendingUp className="w-3.5 h-3.5" />} label="За месяц" value={String(bansThisMonth)} />
            <AnalyticsPill icon={<Clock className="w-3.5 h-3.5" />} label="Ср. лайфтайм" value={avgLifetime != null ? `${avgLifetime}ч` : '-'} />
            <AnalyticsPill icon={<Clock className="w-3.5 h-3.5" />} label="Мин." value={minLifetime != null ? `${minLifetime}ч` : '-'} accent="#4ade80" />
            <AnalyticsPill icon={<Clock className="w-3.5 h-3.5" />} label="Макс." value={maxLifetime != null ? `${maxLifetime}ч` : '-'} accent="#fbbf24" />
          </div>
        </BlurFade>
      )}

      {/* Тренд банов */}
      {trend.length > 0 && (
        <BlurFade delay={0.06}>
          <div className="card-static p-[12px_14px]">
            <div className="flex items-center justify-between mb-2">
              <span className="label-xs">Тренд банов по неделям</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{trend.length} нед.</span>
            </div>
            <div className="flex items-end gap-2" style={{ height: 80 }}>
              {trend.map((t, i) => {
                const h = trendMax > 0 ? (t.count / trendMax) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-mono" style={{ color: t.count > 0 ? '#f87171' : 'var(--text-muted)' }}>
                      {t.count > 0 ? t.count : ''}
                    </span>
                    <div className="w-full rounded-t" style={{
                      height: `${Math.max(h, 4)}%`,
                      background: t.count > 0 ? 'rgba(239,68,68,0.3)' : 'var(--bg-hover)',
                      border: t.count > 0 ? '1px solid rgba(239,68,68,0.2)' : '1px solid var(--bg-hover)',
                      borderBottom: 'none',
                      transition: 'height 0.6s ease',
                    }} />
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{t.week}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </BlurFade>
      )}

      {/* Фильтры */}
      <BlurFade delay={0.08}>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={!verticalFilter} onClick={() => setVerticalFilter('')}>Все</FilterPill>
          {VERTICALS.map((v) => (
            <FilterPill key={v} active={verticalFilter === v} onClick={() => setVerticalFilter(v)}>{v}</FilterPill>
          ))}
        </div>
      </BlurFade>
      <BlurFade delay={0.1}>
        <div className="flex flex-wrap items-center gap-2 relative" style={{ overflow: 'visible' }}>
          <FilterPill active={!targetFilter} onClick={() => setTargetFilter('')}>Все цели</FilterPill>
          {TARGETS.map((t) => (
            <FilterPill key={t} active={targetFilter === t} onClick={() => setTargetFilter(t)}>{t}</FilterPill>
          ))}
          <div className="ml-auto relative" style={{ zIndex: 60 }}>
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        </div>
      </BlurFade>

      {error && (
        <div className="p-4 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>
          {error}
        </div>
      )}

      {/* Таблица */}
      <BlurFade delay={0.14}>
        <div className="card-static overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Дата</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Аккаунт</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Вертикаль</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Цель</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Причина</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Лайфтайм</th>
                <th className="px-3.5 py-[7px] w-8"></th>
              </tr>
            </thead>
              {loading ? (
                <tbody>
                  <tr><td colSpan={8}><TableSkeleton rows={6} cols={7} /></td></tr>
                </tbody>
              ) : bans.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={8}>
                      <div className="relative py-16 flex flex-col items-center justify-center gap-3 overflow-hidden">
                        <DotPattern />
                        <ShieldOff className="w-8 h-8" style={{ color: 'var(--border-strong)' }} />
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Банов не найдено</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <StaggerContainer as="tbody" staggerDelay={0.04}>
                  {bans.map((ban) => (
                    <AnimatedRow key={ban.id} className="cursor-pointer group" onClick={() => navigate(`/bans/${ban.id}`)}>
                      <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(ban.banned_at)}</td>
                      <td className="px-3.5 py-[7px]">
                        <Link to={`/accounts/${ban.account_google_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
                          {ban.account_google_id}
                        </Link>
                      </td>
                      <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{ban.domain ?? '-'}</td>
                      <td className="px-3.5 py-[7px]"><VerticalBadge vertical={ban.offer_vertical} /></td>
                      <td className="px-3.5 py-[7px]"><TargetBadge target={ban.ban_target} /></td>
                      <td className="px-3.5 py-[7px] text-xs truncate max-w-[180px]" style={{ color: 'var(--text-muted)' }} title={ban.ban_reason ?? undefined}>{formatBanReason(ban.ban_reason)}</td>
                      <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{ban.lifetime_hours != null ? `${ban.lifetime_hours}ч` : '-'}</td>
                      <td className="px-3.5 py-[7px]">
                        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} />
                      </td>
                    </AnimatedRow>
                  ))}
                </StaggerContainer>
              )}
          </table>
          {total > 0 && (
            <div className="px-3.5 py-[7px] text-xs" style={{ borderTop: '1px solid var(--bg-hover)', color: 'var(--text-muted)' }}>
              {bans.length} из {total} банов
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}

function AnalyticsPill({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="card-static px-3.5 py-[7px] flex items-center gap-3">
      <span style={{ color: accent ?? 'var(--text-muted)' }}>{icon}</span>
      <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="text-sm font-semibold font-mono" style={{ color: accent ?? 'var(--text-primary)' }}>{value}</span>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200"
      style={{
        background: active ? 'var(--border-medium)' : 'var(--bg-card)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border-strong)' : '1px solid var(--border-subtle)',
      }}
    >
      {children}
    </button>
  );
}
