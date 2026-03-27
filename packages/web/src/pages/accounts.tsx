import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Users, Download } from 'lucide-react';
import { fetchAccounts, ApiError, type AccountSummary, type OverviewStats, fetchOverview, timeAgo, formatCid, riskLevel, effectiveStatus } from '../api.js';
import { downloadCsv } from '../utils/csv.js';
import { StatusBadge } from '../components/badge.js';
import { TableSkeleton } from '../components/skeleton.js';
import {
  BlurFade,
  StaggerContainer,
  AnimatedRow,
  DotPattern,
} from '../components/ui/animations.js';

const RISK_LABELS: Record<string, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
  unknown: 'Неизвестен',
};

const STATUSES = ['active', 'suspended', 'banned'] as const;
const STATUS_LABELS: Record<string, string> = { active: 'Активный', suspended: 'Заблок.', banned: 'Забанен' };
const CURRENCIES = ['USD', 'EUR', 'GBP', 'PLN', 'UAH', 'RUB'] as const;
const ACCOUNT_TYPES = ['farm', 'bought', 'rent', 'agency', 'restored', 'other'] as const;
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  farm: 'Фарм',
  bought: 'Покупной',
  rent: 'Аренда',
  agency: 'Агентский',
  restored: 'Восст.',
  other: 'Другой',
  unknown: 'Неизвестен',
};

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [accountTypeFilter, setAccountTypeFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchOverview().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params['search'] = search;
    if (statusFilter) params['status'] = statusFilter;
    if (currencyFilter) params['currency'] = currencyFilter;
    fetchAccounts(params)
      .then((data) => { setAccounts(data.accounts); setTotal(data.total); })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      })
      .finally(() => setLoading(false));
  }, [search, statusFilter, currencyFilter, navigate]);

  const suspended = stats?.suspended_accounts ?? 0;

  // Client-side filters (risk is computed, account_type comes from DB)
  const filteredAccounts = accounts.filter((acc) => {
    if (riskFilter && riskLevel(acc) !== riskFilter) return false;
    if (accountTypeFilter && (acc.account_type ?? '') !== accountTypeFilter) return false;
    return true;
  });

  return (
    <div className="py-5 px-6 space-y-1.5">
      <BlurFade>
        <div className="flex items-center justify-between mb-[14px]">
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Аккаунты</h1>
          <button
            onClick={() => {
              const headers = ['Google ID', 'Название', 'Статус', 'Тип', 'Риск', 'Валюта', 'Карта', 'Домен', 'Профиль', 'Баны', 'Уведомления', 'Первый визит', 'Последний визит'];
              const rows = filteredAccounts.map((acc) => [
                acc.google_account_id,
                acc.display_name,
                effectiveStatus(acc),
                acc.account_type,
                riskLevel(acc),
                acc.currency,
                acc.card_info,
                acc.domain,
                acc.profile_name,
                acc.ban_count,
                acc.notifications_count,
                acc.first_seen ? new Date(acc.first_seen).toLocaleDateString('ru-RU') : null,
                acc.last_seen ? new Date(acc.last_seen).toLocaleDateString('ru-RU') : null,
              ]);
              downloadCsv(`accounts_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}
            title="Экспорт в CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Скачать CSV
          </button>
        </div>
      </BlurFade>

      {/* Summary bar */}
      {stats && (
        <BlurFade delay={0.04}>
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{stats.total_accounts} аккаунтов:</span>
            <span style={{ color: '#4ade80' }}>{stats.active_accounts} активных</span>
            <span>·</span>
            <span style={{ color: '#f87171' }}>{suspended} заблокировано</span>
            <span>·</span>
            <span style={{ color: '#fbbf24' }}>{stats.at_risk_accounts ?? 0} под угрозой</span>
          </div>
        </BlurFade>
      )}

      {/* Search + Filters */}
      <BlurFade delay={0.06}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
            <input type="text" placeholder="Поиск аккаунтов..." value={search} onChange={(e) => setSearch(e.target.value)} className="input-field pl-10" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={!statusFilter} onClick={() => setStatusFilter('')}>Все</FilterPill>
            {STATUSES.map((s) => (
              <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>{STATUS_LABELS[s] ?? s}</FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={!currencyFilter} onClick={() => setCurrencyFilter('')}>Валюта</FilterPill>
            {CURRENCIES.map((c) => (
              <FilterPill key={c} active={currencyFilter === c} onClick={() => setCurrencyFilter(c)}>{c}</FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={!riskFilter} onClick={() => setRiskFilter('')}>Риск</FilterPill>
            {(['high', 'medium', 'low'] as const).map((r) => (
              <FilterPill key={r} active={riskFilter === r} onClick={() => setRiskFilter(r)}>{RISK_LABELS[r]}</FilterPill>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={!accountTypeFilter} onClick={() => setAccountTypeFilter('')}>Тип</FilterPill>
            {ACCOUNT_TYPES.map((t) => (
              <FilterPill key={t} active={accountTypeFilter === t} onClick={() => setAccountTypeFilter(t)}>{ACCOUNT_TYPE_LABELS[t]}</FilterPill>
            ))}
          </div>
        </div>
      </BlurFade>

      {error && (
        <div className="p-4 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>{error}</div>
      )}

      {/* Table */}
      <BlurFade delay={0.12}>
        <div className="card-static overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Google ID</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Профиль</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Название</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Статус</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Тип</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Риск</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Валюта</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Карта</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                  <th className="px-3.5 py-[7px] text-center font-medium label-xs">Баны</th>
                  <th className="px-3.5 py-[7px] text-center font-medium label-xs">Увед.</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Возраст</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Посл. визит</th>
                  <th className="px-3.5 py-[7px] w-8"></th>
                </tr>
              </thead>
              {loading ? (
                <tbody>
                  <tr><td colSpan={15}><TableSkeleton rows={6} cols={8} /></td></tr>
                </tbody>
              ) : filteredAccounts.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={15}>
                      <div className="relative py-16 flex flex-col items-center justify-center gap-3 overflow-hidden">
                        <DotPattern />
                        <Users className="w-8 h-8" style={{ color: 'var(--border-strong)' }} />
                        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Аккаунты не найдены</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <StaggerContainer as="tbody" staggerDelay={0.04}>
                  {filteredAccounts.map((acc) => {
                    const risk = riskLevel(acc);
                    return (
                      <AnimatedRow key={acc.id} className="cursor-pointer group" onClick={() => navigate(`/accounts/${acc.google_account_id}`)}>
                        <td className="px-3.5 py-[7px]">
                          <span className={`font-mono whitespace-nowrap ${acc.profile_name ? 'text-[10px]' : 'text-xs'}`} style={{ color: acc.profile_name ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{formatCid(acc.google_account_id)}</span>
                        </td>
                        <td className="px-3.5 py-[7px]">
                          {acc.profile_name ? (
                            <div className="flex flex-col">
                              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{acc.profile_name}</span>
                              {acc.browser_type && (
                                <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{acc.browser_type}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] italic" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>не подключен</span>
                          )}
                        </td>
                        <td className="px-3.5 py-[7px] max-w-[160px]">
                          <span className="text-xs truncate block whitespace-nowrap overflow-hidden" style={{ color: 'var(--text-secondary)' }}>
                            {acc.display_name && /^Google Ads \d{3}-\d{3}-\d{4}$/.test(acc.display_name) ? '-' : (acc.display_name ?? formatCid(acc.google_account_id))}
                          </span>
                        </td>
                        <td className="px-3.5 py-[7px]"><StatusBadge status={effectiveStatus(acc)} /></td>
                        <td className="px-3.5 py-[7px]">
                          {acc.account_type ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                              {ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type}
                              {acc.account_type_source === 'manual' && <span style={{ color: 'var(--accent-green)', fontSize: 8 }}>M</span>}
                            </span>
                          ) : (
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td className="px-3.5 py-[7px]">
                          <span className={`risk-badge-${risk} inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}>{RISK_LABELS[risk]}</span>
                        </td>
                        <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{acc.currency ?? '-'}</td>
                        <td className="px-3.5 py-[7px] text-xs font-mono" style={{ color: acc.card_info ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{acc.card_info ?? '-'}</td>
                        <td className="px-3.5 py-[7px] text-xs max-w-[140px] truncate" style={{ color: acc.domain ? 'var(--accent-green)' : 'var(--text-muted)' }}>{acc.domain ? <a href={acc.domain.startsWith('http') ? acc.domain : `https://${acc.domain}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline">{acc.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : '-'}</td>
                        <td className="px-3.5 py-[7px] text-center">
                          {parseInt(acc.ban_count, 10) > 0 ? (
                            <span className="font-mono text-xs text-red-400">{acc.ban_count}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>0</span>
                          )}
                        </td>
                        <td className="px-3.5 py-[7px] text-center">
                          {(acc.notifications_count ?? 0) > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full text-xs font-mono" style={{ width: 22, height: 22, background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}>{acc.notifications_count}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td className="px-3.5 py-[7px] text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{accountAge(acc.first_seen)}</td>
                        <td className="px-3.5 py-[7px] text-right text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(acc.last_seen)}</td>
                        <td className="px-3.5 py-[7px]">
                          <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} />
                        </td>
                      </AnimatedRow>
                    );
                  })}
                </StaggerContainer>
              )}
            </table>
          </div>
          {total > 0 && (
            <div className="px-3.5 py-[7px] text-xs" style={{ borderTop: '1px solid var(--bg-hover)', color: 'var(--text-muted)' }}>{filteredAccounts.length} из {total} аккаунтов</div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}

function accountAge(firstSeen: string | null | undefined): string {
  if (!firstSeen) return '-';
  const ms = Date.now() - new Date(firstSeen).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return '<1д';
  if (days < 30) return `${days}д`;
  const months = Math.floor(days / 30);
  const remDays = days % 30;
  if (months < 12) return remDays > 0 ? `${months}м ${remDays}д` : `${months}м`;
  const years = Math.floor(days / 365);
  return `${years}г`;
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200"
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
