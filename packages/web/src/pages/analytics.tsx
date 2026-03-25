import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Clock, Link, AlertTriangle, Zap, Eye, RefreshCw, Users } from 'lucide-react';
import {
  fetchBanTiming,
  fetchSpendVelocityAll, fetchBanChainAll,
  fetchConsumableScoring, fetchCreativeDecay,
  fetchCompetitiveIntelligence,
  fetchMVFreshness, fetchAccountRiskSummary,
  ApiError,
  type BanTimingData,
  type SpendVelocityAccount, type BanChainDomain,
  type ConsumableScoring, type CampaignDecay,
  type CompetitiveIntelligence,
  type AccountRiskSummary,
  formatCid,
} from '../api.js';
import { Skeleton } from '../components/skeleton.js';
import { BlurFade, StaggerContainer, AnimatedRow } from '../components/ui/animations.js';

function SectionSkeleton() {
  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

function SectionError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</h3>
          <p className="text-xs mt-1" style={{ color: '#f87171' }}>{message}</p>
        </div>
        <button onClick={onRetry} className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw className="w-3 h-3" /> Повторить
        </button>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const [timing, setTiming] = useState<BanTimingData | null>(null);
  const [velocity, setVelocity] = useState<SpendVelocityAccount[] | null>(null);
  const [chains, setChains] = useState<BanChainDomain[] | null>(null);
  const [scoring, setScoring] = useState<ConsumableScoring | null>(null);
  const [decay, setDecay] = useState<CampaignDecay[] | null>(null);
  const [competitive, setCompetitive] = useState<CompetitiveIntelligence | null>(null);
  const [riskSummary, setRiskSummary] = useState<AccountRiskSummary[] | null>(null);
  const [freshness, setFreshness] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  const setErr = useCallback((key: string) => (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
    setSectionErrors(prev => ({ ...prev, [key]: e instanceof Error ? e.message : 'Ошибка загрузки' }));
  }, [navigate]);

  const clearErr = useCallback((key: string) => {
    setSectionErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const loadSection = useCallback((key: string, fn: () => Promise<void>) => {
    clearErr(key);
    fn().catch(setErr(key));
  }, [setErr, clearErr]);

  const loadAll = useCallback(() => {
    loadSection('timing', () => fetchBanTiming().then(setTiming));
    loadSection('velocity', () => fetchSpendVelocityAll().then(r => setVelocity(r.accounts)));
    loadSection('chains', () => fetchBanChainAll().then(r => setChains(r.shared_domains)));
    loadSection('scoring', () => fetchConsumableScoring().then(setScoring));
    loadSection('decay', () => fetchCreativeDecay().then(r => setDecay(r.campaigns)));
    loadSection('competitive', () => fetchCompetitiveIntelligence().then(setCompetitive));
    loadSection('risk', () => fetchAccountRiskSummary().then(r => setRiskSummary(r.accounts)));
    fetchMVFreshness().then(r => setFreshness(r.last_refreshed_at)).catch(() => {});
  }, [loadSection]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const freshnessAge = freshness ? Math.floor((Date.now() - new Date(freshness).getTime()) / 60000) : null;
  const isStale = freshnessAge != null && freshnessAge > 120;

  return (
    <div className="py-5 px-6 space-y-6">
      <BlurFade>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <BarChart3 className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
              Аналитика
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Статистика по банам, расходам и паттернам
            </p>
          </div>
          {freshness && (
            <div className="text-xs flex items-center gap-1.5" style={{ color: isStale ? '#fbbf24' : 'var(--text-ghost)' }}>
              <Clock className="w-3 h-3" />
              Данные обновлены: {new Date(freshness).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              {isStale && <span className="ml-1">(данные могут быть устаревшими)</span>}
            </div>
          )}
        </div>
      </BlurFade>

      {/* Section 0: Account Risk Summary */}
      {sectionErrors['risk'] ? (
        <SectionError title="Сводка по аккаунтам" message={sectionErrors['risk']} onRetry={() => loadSection('risk', () => fetchAccountRiskSummary().then(r => setRiskSummary(r.accounts)))} />
      ) : riskSummary == null ? (
        <SectionSkeleton />
      ) : riskSummary.length > 0 ? (
        <AccountRiskSummarySection accounts={riskSummary} />
      ) : null}

      {/* Section 1: Ban Timing Heatmap */}
      {sectionErrors['timing'] ? (
        <SectionError title="Ban Timing Heatmap" message={sectionErrors['timing']} onRetry={() => loadSection('timing', () => fetchBanTiming().then(setTiming))} />
      ) : timing == null ? (
        <SectionSkeleton />
      ) : (
        <BanTimingHeatmap timing={timing} />
      )}

      {/* Section 3: Spend Velocity */}
      {sectionErrors['velocity'] ? (
        <SectionError title="Spend Velocity" message={sectionErrors['velocity']} onRetry={() => loadSection('velocity', () => fetchSpendVelocityAll().then(r => setVelocity(r.accounts)))} />
      ) : velocity == null ? (
        <SectionSkeleton />
      ) : (
        <SpendVelocitySection accounts={velocity} />
      )}

      {/* Section 4: Consumable Scoring */}
      {sectionErrors['scoring'] ? (
        <SectionError title="Расходник Scoring" message={sectionErrors['scoring']} onRetry={() => loadSection('scoring', () => fetchConsumableScoring().then(setScoring))} />
      ) : scoring == null ? (
        <SectionSkeleton />
      ) : (
        <ConsumableScoringSection scoring={scoring} />
      )}

      {/* Section 5: Ban Chain Graph */}
      {sectionErrors['chains'] ? (
        <SectionError title="Ban Chain" message={sectionErrors['chains']} onRetry={() => loadSection('chains', () => fetchBanChainAll().then(r => setChains(r.shared_domains)))} />
      ) : chains == null ? (
        <SectionSkeleton />
      ) : (
        <BanChainSection domains={chains} />
      )}

      {/* Section 6: Creative Decay */}
      {sectionErrors['decay'] ? (
        <SectionError title="Creative Decay" message={sectionErrors['decay']} onRetry={() => loadSection('decay', () => fetchCreativeDecay().then(r => setDecay(r.campaigns)))} />
      ) : decay == null ? (
        <SectionSkeleton />
      ) : (
        <CreativeDecaySection campaigns={decay} />
      )}

      {/* Section 7: Competitive Intelligence */}
      {sectionErrors['competitive'] ? (
        <SectionError title="Competitive Intelligence" message={sectionErrors['competitive']} onRetry={() => loadSection('competitive', () => fetchCompetitiveIntelligence().then(setCompetitive))} />
      ) : competitive == null ? (
        <SectionSkeleton />
      ) : (
        <CompetitiveIntelligenceSection data={competitive} />
      )}
    </div>
  );
}

// --- (OverviewCards + VerticalBreakdown moved to dashboard) ---

// --- Ban Timing Heatmap ---

function BanTimingHeatmap({ timing }: { timing: BanTimingData }) {
  const { heatmap, day_labels, total_bans, peak_day, peak_hour } = timing;
  const insufficientData = total_bans < 20;

  let maxVal = 0;
  for (const row of heatmap) for (const v of row) if (v > maxVal) maxVal = v;

  return (
    <BlurFade delay={0.15}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Ban Timing Heatmap</h3>
          {total_bans > 0 && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Пик: {peak_day} {peak_hour}:00 · {total_bans} банов
            </div>
          )}
        </div>

        {insufficientData && (
          <div className="rounded-lg p-3 mb-3 text-xs" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.12)', color: '#fbbf24' }}>
            Недостаточно данных для паттернов. Минимум 20+ банов для базового heatmap.
            {total_bans > 0 && ` Сейчас: ${total_bans}.`}
          </div>
        )}

        <div className="overflow-x-auto">
          <div style={{ minWidth: 680 }}>
            <div className="flex" style={{ paddingLeft: 36 }}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="flex-1 text-center" style={{ fontSize: 9, color: 'var(--text-ghost)', minWidth: 24 }}>{h}</div>
              ))}
            </div>
            {day_labels.map((label, dayIdx) => (
              <div key={label} className="flex items-center" style={{ height: 28 }}>
                <div className="flex-shrink-0 text-right pr-2" style={{ width: 36, fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
                <div className="flex flex-1 gap-px">
                  {Array.from({ length: 24 }, (_, h) => (
                    <HeatmapCell key={h} value={heatmap[dayIdx]?.[h] ?? 0} maxVal={maxVal} day={label} hour={h} />
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-3" style={{ paddingLeft: 36 }}>
              <span style={{ fontSize: 9, color: 'var(--text-ghost)' }}>0</span>
              <div className="flex gap-px">
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((i) => (
                  <div key={i} className="rounded-sm" style={{ width: 14, height: 10, background: cellColor(i) }} />
                ))}
              </div>
              <span style={{ fontSize: 9, color: 'var(--text-ghost)' }}>{maxVal > 0 ? maxVal : '?'}</span>
            </div>
          </div>
        </div>
      </div>
    </BlurFade>
  );
}

function HeatmapCell({ value, maxVal, day, hour }: { value: number; maxVal: number; day: string; hour: number }) {
  const [hovered, setHovered] = useState(false);
  const intensity = maxVal > 0 ? value / maxVal : 0;
  return (
    <div
      className="flex-1 rounded-sm relative cursor-default"
      style={{ minWidth: 24, height: 22, background: cellColor(intensity), transition: 'background 0.15s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute z-50 rounded-lg px-2.5 py-1.5 pointer-events-none whitespace-nowrap"
          style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%) translateY(-4px)', background: 'var(--bg-elevated)', border: '1px solid var(--border-medium)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', fontSize: 11, color: 'var(--text-primary)' }}>
          <span style={{ fontWeight: 600 }}>{value}</span>
          <span style={{ color: 'var(--text-muted)' }}> бан{pluralize(value)} · {day} {hour}:00</span>
        </div>
      )}
    </div>
  );
}

// --- Section 3: Spend Velocity ---

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', UAH: '₴', RUB: '₽', PLN: 'zł', TRY: '₺', BRL: 'R$' };
function fmtMoney(value: number, currency: string) {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  return `${sym}${value.toFixed(2)}`;
}

function SpendVelocitySection({ accounts }: { accounts: SpendVelocityAccount[] }) {
  if (accounts.length === 0) return <EmptySection title="Spend Velocity" message="Нет данных о расходах. Нужны daily spend данные." />;

  const statusColors: Record<string, string> = { normal: '#4ade80', elevated: '#fbbf24', critical: '#f87171' };
  const statusLabels: Record<string, string> = { normal: 'Normal', elevated: 'Elevated', critical: 'Critical' };

  return (
    <BlurFade delay={0.2}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4" style={{ color: '#fbbf24' }} />
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Spend Velocity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
              <th className="px-3 py-1.5 text-left label-xs font-medium">Аккаунт</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Расход</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Изменение</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Порог</th>
              <th className="px-3 py-1.5 text-center label-xs font-medium">Статус</th>
            </tr></thead>
            <StaggerContainer as="tbody" staggerDelay={0.02} className="">
              {accounts.slice(0, 20).map((a) => (
                <AnimatedRow key={a.account_google_id}>
                  <td className="px-3 py-1.5 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {a.display_name ?? a.account_google_id}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {fmtMoney(a.latest_spend, a.currency)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: a.change_pct != null && a.change_pct > a.threshold ? '#f87171' : 'var(--text-muted)' }}>
                    {a.change_pct != null ? `${a.change_pct > 0 ? '+' : ''}${a.change_pct}%` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>
                    {a.threshold}%
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ color: statusColors[a.status] ?? '#94a3b8', background: `${statusColors[a.status] ?? '#94a3b8'}15`, fontSize: 10 }}>
                      {statusLabels[a.status] ?? a.status}
                    </span>
                  </td>
                </AnimatedRow>
              ))}
            </StaggerContainer>
          </table>
        </div>
      </div>
    </BlurFade>
  );
}

// --- Section 4: Consumable Scoring ---

function ConsumableScoringSection({ scoring }: { scoring: ConsumableScoring }) {
  const { bins, domains, proxies } = scoring;
  const hasData = bins.length > 0 || domains.length > 0 || proxies.length > 0;

  if (!hasData) return <EmptySection title="Расходник Scoring" message="Нет расходников для скоринга. Нужны BIN, домены или прокси." />;

  const scoreColor = (s: string) => s === 'good' ? '#4ade80' : s === 'medium' ? '#fbbf24' : s === 'bad' ? '#f87171' : '#94a3b8';

  return (
    <BlurFade delay={0.25}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Расходник Scoring</h3>

        {bins.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>BIN-диапазоны</div>
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3 py-1 text-left label-xs font-medium">BIN</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Всего</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Банов</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Ban Rate</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Avg Life</th>
                <th className="px-3 py-1 text-center label-xs font-medium">Score</th>
              </tr></thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.bin} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <td className="px-3 py-1.5 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{b.bin}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{b.total}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: b.banned > 0 ? '#f87171' : 'var(--text-muted)' }}>{b.banned}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{b.ban_rate}%</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{b.avg_lifetime_hours}ч</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className="text-xs font-medium" style={{ color: scoreColor(b.score) }}>{b.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {domains.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Домены</div>
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3 py-1 text-left label-xs font-medium">Домен</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Акк</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Банов</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Ban Rate</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Safe Score</th>
                <th className="px-3 py-1 text-center label-xs font-medium">Score</th>
              </tr></thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.domain} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <td className="px-3 py-1.5 text-xs font-mono" style={{ color: 'var(--accent-green)' }}>{d.domain}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.total}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: d.banned > 0 ? '#f87171' : 'var(--text-muted)' }}>{d.banned}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.ban_rate}%</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: d.safe_page_score != null ? (d.safe_page_score >= 70 ? '#4ade80' : d.safe_page_score >= 40 ? '#fbbf24' : '#f87171') : 'var(--text-ghost)' }}>
                      {d.safe_page_score ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className="text-xs font-medium" style={{ color: scoreColor(d.score) }}>{d.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {proxies.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>Прокси</div>
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3 py-1 text-left label-xs font-medium">Прокси</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Акк</th>
                <th className="px-3 py-1 text-right label-xs font-medium">Ban Rate</th>
                <th className="px-3 py-1 text-center label-xs font-medium">Score</th>
              </tr></thead>
              <tbody>
                {proxies.map((p) => (
                  <tr key={p.proxy} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                    <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{p.proxy}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.total}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{p.ban_rate}%</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className="text-xs font-medium" style={{ color: scoreColor(p.score) }}>{p.score}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </BlurFade>
  );
}

// --- Section 5: Ban Chain ---

function BanChainSection({ domains }: { domains: BanChainDomain[] }) {
  if (domains.length === 0) return <EmptySection title="Ban Chain Graph" message="Нет связанных аккаунтов. Нужно 2+ аккаунта на одном домене." />;

  return (
    <BlurFade delay={0.3}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Link className="w-4 h-4" style={{ color: '#a78bfa' }} />
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Ban Chain — Общие домены</h3>
        </div>
        <table className="w-full text-sm">
          <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
            <th className="px-3 py-1.5 text-left label-xs font-medium">Домен</th>
            <th className="px-3 py-1.5 text-right label-xs font-medium">Аккаунтов</th>
            <th className="px-3 py-1.5 text-right label-xs font-medium">Из них забанено</th>
            <th className="px-3 py-1.5 text-center label-xs font-medium">Риск</th>
          </tr></thead>
          <StaggerContainer as="tbody" staggerDelay={0.02} className="">
            {domains.map((d) => {
              const riskPct = d.account_count > 0 ? (d.banned_count / d.account_count) * 100 : 0;
              const riskColor = riskPct > 60 ? '#f87171' : riskPct > 30 ? '#fbbf24' : '#4ade80';
              return (
                <AnimatedRow key={d.domain}>
                  <td className="px-3 py-1.5 text-xs font-mono" style={{ color: 'var(--accent-green)' }}>{d.domain}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{d.account_count}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: d.banned_count > 0 ? '#f87171' : 'var(--text-muted)' }}>
                    {d.banned_count}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {d.banned_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: riskColor }}>
                        <AlertTriangle className="w-3 h-3" />
                        {Math.round(riskPct)}%
                      </span>
                    )}
                    {d.banned_count === 0 && <span className="text-xs" style={{ color: 'var(--text-ghost)' }}>—</span>}
                  </td>
                </AnimatedRow>
              );
            })}
          </StaggerContainer>
        </table>
      </div>
    </BlurFade>
  );
}

// --- Section 6: Creative Decay ---

function CreativeDecaySection({ campaigns }: { campaigns: CampaignDecay[] }) {
  const decayed = campaigns.filter(c => c.decay_detected);
  if (campaigns.length === 0) return <EmptySection title="Creative Decay" message="Нет данных о кампаниях. Нужны 21+ дней daily stats." />;

  return (
    <BlurFade delay={0.35}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>
          Creative Decay
          {decayed.length > 0 && (
            <span className="ml-2 text-xs font-normal" style={{ color: '#f87171' }}>
              {decayed.length} кампаний с decay
            </span>
          )}
        </h3>

        {decayed.length === 0 && campaigns.length > 0 && (
          <div className="rounded-lg p-3 mb-3 text-xs" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.12)', color: '#4ade80' }}>
            Decay не обнаружен. {campaigns.filter(c => c.baseline_ctr == null).length > 0
              ? `${campaigns.filter(c => c.baseline_ctr == null).length} кампаний без достаточных данных (нужно 21+ дней).`
              : 'Все кампании в норме.'}
          </div>
        )}

        <table className="w-full text-sm">
          <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
            <th className="px-3 py-1.5 text-left label-xs font-medium">Кампания</th>
            <th className="px-3 py-1.5 text-right label-xs font-medium">Baseline CTR</th>
            <th className="px-3 py-1.5 text-right label-xs font-medium">Текущий CTR</th>
            <th className="px-3 py-1.5 text-right label-xs font-medium">Изменение</th>
            <th className="px-3 py-1.5 text-center label-xs font-medium">Статус</th>
          </tr></thead>
          <tbody>
            {campaigns.slice(0, 20).map((c) => (
              <tr key={c.campaign_id} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <td className="px-3 py-1.5 text-xs max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }}>
                  {c.campaign_name}
                </td>
                <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {c.baseline_ctr != null ? `${(c.baseline_ctr * 100).toFixed(2)}%` : '—'}
                </td>
                <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  {c.current_ctr != null ? `${(c.current_ctr * 100).toFixed(2)}%` : '—'}
                </td>
                <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: c.ctr_change_pct != null && c.ctr_change_pct < -15 ? '#f87171' : 'var(--text-muted)' }}>
                  {c.ctr_change_pct != null ? `${c.ctr_change_pct > 0 ? '+' : ''}${c.ctr_change_pct}%` : '—'}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {c.decay_detected ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)', fontSize: 10 }}>
                      Decay ({c.days_in_decay}д)
                    </span>
                  ) : (
                    <span className="text-xs" style={{ color: c.baseline_ctr != null ? '#4ade80' : 'var(--text-ghost)' }}>
                      {c.baseline_ctr != null ? 'OK' : 'N/A'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlurFade>
  );
}

// --- Section 7: Competitive Intelligence ---

function CompetitiveIntelligenceSection({ data }: { data: CompetitiveIntelligence }) {
  const { competitors, insights, total_competitors } = data;

  if (competitors.length === 0) {
    return <EmptySection title="Competitive Intelligence" message="Нет данных Auction Insights. Данные появятся после перехвата AuctionInsight RPC." />;
  }

  const maxImpressionShare = Math.max(...competitors.map(c => c.avg_impression_share), 0.01);

  return (
    <BlurFade delay={0.4}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4" style={{ color: '#818cf8' }} />
            <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Competitive Intelligence</h3>
            <span className="text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>{total_competitors} конкурентов</span>
          </div>
          {insights.most_aggressive && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Агрессивный: <span className="font-mono" style={{ color: '#f87171' }}>{insights.most_aggressive}</span>
            </div>
          )}
        </div>

        {/* Insight pills */}
        {(insights.most_aggressive || insights.highest_impression_share || insights.longest_lived) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {insights.highest_impression_share && (
              <div className="px-2.5 py-1 rounded-lg text-xs" style={{ background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.15)', color: '#818cf8' }}>
                Top IS: {insights.highest_impression_share}
              </div>
            )}
            {insights.most_aggressive && (
              <div className="px-2.5 py-1 rounded-lg text-xs" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.15)', color: '#f87171' }}>
                Overlap: {insights.most_aggressive}
              </div>
            )}
            {insights.longest_lived && (
              <div className="px-2.5 py-1 rounded-lg text-xs" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)', color: '#4ade80' }}>
                Долгожитель: {insights.longest_lived}
              </div>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
              <th className="px-3 py-1.5 text-left label-xs font-medium">Домен</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Акк</th>
              <th className="px-3 py-1.5 text-left label-xs font-medium" style={{ width: '30%' }}>Impression Share</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Overlap</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Дней</th>
            </tr></thead>
            <StaggerContainer as="tbody" staggerDelay={0.02} className="">
              {competitors.slice(0, 30).map((c) => (
                <AnimatedRow key={c.domain}>
                  <td className="px-3 py-1.5 text-xs font-mono" style={{ color: c.is_long_lived ? '#4ade80' : 'var(--text-secondary)' }}>
                    {c.domain}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {c.accounts_seen_in}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.max((c.avg_impression_share / maxImpressionShare) * 100, 2)}%`,
                            background: c.avg_impression_share > 0.5 ? '#f87171' : c.avg_impression_share > 0.2 ? '#fbbf24' : '#818cf8',
                          }}
                        />
                      </div>
                      <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                        {(c.avg_impression_share * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: c.avg_overlap_rate > 0.5 ? '#f87171' : 'var(--text-muted)' }}>
                    {(c.avg_overlap_rate * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: c.longevity_days > 7 ? '#4ade80' : 'var(--text-ghost)' }}>
                    {c.longevity_days}
                  </td>
                </AnimatedRow>
              ))}
            </StaggerContainer>
          </table>
        </div>
      </div>
    </BlurFade>
  );
}

// --- Account Risk Summary ---

function AccountRiskSummarySection({ accounts }: { accounts: AccountRiskSummary[] }) {
  const navigate = useNavigate();
  const riskColor = (score: number) => score >= 70 ? '#f87171' : score >= 40 ? '#fbbf24' : '#4ade80';

  return (
    <BlurFade delay={0.02}>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4" style={{ color: '#818cf8' }} />
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Сводка по аккаунтам</h3>
          <span className="text-xs font-mono" style={{ color: 'var(--text-ghost)' }}>{accounts.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
              <th className="px-3 py-1.5 text-left label-xs font-medium">Аккаунт</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Дней</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Расход</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Скорость</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Нарушения</th>
              <th className="px-3 py-1.5 text-right label-xs font-medium">Баны</th>
              <th className="px-3 py-1.5 text-center label-xs font-medium">Риск</th>
            </tr></thead>
            <StaggerContainer as="tbody" staggerDelay={0.02} className="">
              {accounts.slice(0, 25).map(a => (
                <AnimatedRow key={a.account_id} onClick={() => navigate(`/accounts/${a.account_google_id}`)} className="cursor-pointer">
                  <td className="px-3 py-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {a.display_name ?? formatCid(a.account_google_id)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{a.days_active}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>${a.total_spend.toFixed(0)}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: a.daily_velocity > 100 ? '#f87171' : 'var(--text-muted)' }}>${a.daily_velocity.toFixed(0)}/д</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: a.policy_violations > 0 ? '#fbbf24' : 'var(--text-ghost)' }}>{a.policy_violations}</td>
                  <td className="px-3 py-1.5 text-right text-xs font-mono" style={{ color: a.ban_count > 0 ? '#f87171' : 'var(--text-ghost)' }}>{a.ban_count}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className="text-xs font-bold font-mono" style={{ color: riskColor(a.risk_score) }}>{a.risk_score}</span>
                  </td>
                </AnimatedRow>
              ))}
            </StaggerContainer>
          </table>
        </div>
      </div>
    </BlurFade>
  );
}

// --- Helpers ---

function EmptySection({ title, message }: { title: string; message: string }) {
  return (
    <BlurFade>
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</h3>
        <p className="text-xs" style={{ color: 'var(--text-ghost)' }}>{message}</p>
      </div>
    </BlurFade>
  );
}

function cellColor(intensity: number): string {
  if (intensity === 0) return 'var(--bg-raised)';
  const hue = Math.round(50 - intensity * 50);
  const sat = Math.round(80 + intensity * 20);
  const light = Math.round(65 - intensity * 20);
  const alpha = 0.3 + intensity * 0.7;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}

function pluralize(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return '';
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'а';
  return 'ов';
}
