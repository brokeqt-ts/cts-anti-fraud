import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { fetchBuyerPerformance, type BuyerPerformance, timeAgo } from '../api.js';
import { TableSkeleton } from '../components/skeleton.js';
import { BlurFade, StaggerContainer, AnimatedRow } from '../components/ui/animations.js';

export function BuyerPerformancePage() {
  const [buyers, setBuyers] = useState<BuyerPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<keyof BuyerPerformance>('total_accounts');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();

  useEffect(() => {
    fetchBuyerPerformance()
      .then((d) => setBuyers(d.buyers))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (col: keyof BuyerPerformance) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sorted = [...buyers].sort((a, b) => {
    const av = a[sortBy], bv = b[sortBy];
    const an = typeof av === 'number' ? av : parseFloat(String(av) || '0');
    const bn = typeof bv === 'number' ? bv : parseFloat(String(bv) || '0');
    return sortDir === 'desc' ? bn - an : an - bn;
  });

  // Totals
  const totals = buyers.reduce((t, b) => ({
    accounts: t.accounts + b.total_accounts,
    bans: t.bans + b.total_bans,
    spend: t.spend + parseFloat(b.total_spend || '0'),
    active: t.active + b.active_accounts,
  }), { accounts: 0, bans: 0, spend: 0, active: 0 });

  return (
    <div className="py-5 px-6 space-y-3">
      <BlurFade>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Buyer Performance</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Статистика по каждому байеру</p>
          </div>
        </div>
      </BlurFade>

      {/* Summary cards */}
      {!loading && (
        <BlurFade delay={0.04}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SummaryCard label="Всего аккаунтов" value={String(totals.accounts)} />
            <SummaryCard label="Активных" value={String(totals.active)} color="#4ade80" />
            <SummaryCard label="Всего банов" value={String(totals.bans)} color="#f87171" />
            <SummaryCard label="Общий spend" value={`$${totals.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#60a5fa" />
          </div>
        </BlurFade>
      )}

      {/* Table */}
      <BlurFade delay={0.08}>
        <div className="card-static overflow-visible">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <SortHeader label="Байер" col="name" current={sortBy} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Аккаунты" col="total_accounts" current={sortBy} dir={sortDir} onClick={handleSort} align="center" />
                  <SortHeader label="Активные" col="active_accounts" current={sortBy} dir={sortDir} onClick={handleSort} align="center" />
                  <SortHeader label="Баны" col="total_bans" current={sortBy} dir={sortDir} onClick={handleSort} align="center" />
                  <SortHeader label="Ban rate" col="ban_rate" current={sortBy} dir={sortDir} onClick={handleSort} align="center" />
                  <SortHeader label="Avg Lifetime" col="avg_lifetime_hours" current={sortBy} dir={sortDir} onClick={handleSort} align="right" />
                  <SortHeader label="Spend" col="total_spend" current={sortBy} dir={sortDir} onClick={handleSort} align="right" />
                  <th className="px-3 py-2 text-right font-medium label-xs">Последняя активность</th>
                </tr>
              </thead>
              {loading ? (
                <tbody><tr><td colSpan={8}><TableSkeleton rows={4} cols={7} /></td></tr></tbody>
              ) : sorted.length === 0 ? (
                <tbody><tr><td colSpan={8} className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Нет данных</td></tr></tbody>
              ) : (
                <StaggerContainer as="tbody" staggerDelay={0.04}>
                  {sorted.map((b) => {
                    const banRate = parseFloat(b.ban_rate || '0');
                    const lifetime = parseFloat(b.avg_lifetime_hours || '0');
                    return (
                      <AnimatedRow key={b.user_id} className="cursor-pointer" onClick={() => navigate(`/admin/buyers/${b.user_id}`)}>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{b.name}</span>
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{b.email}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{b.total_accounts}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="font-mono text-xs" style={{ color: '#4ade80' }}>{b.active_accounts}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {b.total_bans > 0 ? (
                            <span className="font-mono text-xs font-semibold" style={{ color: '#f87171' }}>{b.total_bans}</span>
                          ) : (
                            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              background: banRate > 50 ? 'rgba(239,68,68,0.1)' : banRate > 20 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                              color: banRate > 50 ? '#ef4444' : banRate > 20 ? '#f59e0b' : '#22c55e',
                            }}
                          >
                            {banRate > 50 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                            {banRate}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {lifetime > 24 ? `${(lifetime / 24).toFixed(1)}д` : `${lifetime.toFixed(0)}ч`}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                            ${parseFloat(b.total_spend || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                          {timeAgo(b.last_activity)}
                        </td>
                      </AnimatedRow>
                    );
                  })}
                </StaggerContainer>
              )}
            </table>
          </div>
        </div>
      </BlurFade>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card-static px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-lg font-bold font-mono mt-1" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function SortHeader({ label, col, current, dir, onClick, align = 'left' }: {
  label: string;
  col: keyof BuyerPerformance;
  current: keyof BuyerPerformance;
  dir: 'asc' | 'desc';
  onClick: (col: keyof BuyerPerformance) => void;
  align?: 'left' | 'center' | 'right';
}) {
  const active = current === col;
  return (
    <th
      className={`px-3 py-2 font-medium label-xs cursor-pointer select-none transition-colors text-${align}`}
      style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
      onClick={() => onClick(col)}
    >
      {label}
      {active && <span className="ml-0.5">{dir === 'desc' ? '↓' : '↑'}</span>}
    </th>
  );
}
