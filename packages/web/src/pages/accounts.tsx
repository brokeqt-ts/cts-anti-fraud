import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Users, Download, Tag, Plus, X, CheckSquare, Square, Brain, ShieldCheck } from 'lucide-react';
import {
  fetchAccounts, ApiError, type AccountSummary, type OverviewStats, fetchOverview,
  timeAgo, formatCid, riskLevel, effectiveStatus,
  fetchTags, createTag, deleteTag, assignTag, unassignTag, bulkAssignTag, type TagSummary,
} from '../api.js';
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
  const [tagFilter, setTagFilter] = useState('');
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [tagOverrides, setTagOverrides] = useState<Record<string, Array<{ id: string; name: string; color: string }>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const loadTags = useCallback(() => {
    fetchTags().then((d) => setTags(d.tags)).catch(() => {});
  }, []);

  const reloadAccounts = useCallback(() => {
    const params: Record<string, string> = {};
    if (search) params['search'] = search;
    if (statusFilter) params['status'] = statusFilter;
    if (currencyFilter) params['currency'] = currencyFilter;
    if (tagFilter) params['tag_id'] = tagFilter;
    fetchAccounts(params)
      .then((data) => { setAccounts(data.accounts); setTotal(data.total); })
      .catch(() => {});
  }, [search, statusFilter, currencyFilter, tagFilter]);

  useEffect(() => {
    fetchOverview().then(setStats).catch(() => {});
    loadTags();
  }, [loadTags]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params['search'] = search;
    if (statusFilter) params['status'] = statusFilter;
    if (currencyFilter) params['currency'] = currencyFilter;
    if (tagFilter) params['tag_id'] = tagFilter;
    fetchAccounts(params)
      .then((data) => { setAccounts(data.accounts); setTotal(data.total); })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigateRef.current('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, currencyFilter, tagFilter]);

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
              const headers = ['Google ID', 'Название', 'Статус', 'Тип', 'Health', 'Валюта', 'Карта', 'Домен', 'Профиль', 'Баны', 'Уведомления', 'Первый визит', 'Последний визит'];
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
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <Tag className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
              <FilterPill active={!tagFilter} onClick={() => setTagFilter('')}>Все</FilterPill>
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: tagFilter === t.id ? t.color + '30' : 'var(--bg-card)',
                    color: tagFilter === t.id ? t.color : 'var(--text-muted)',
                    border: tagFilter === t.id ? `1px solid ${t.color}50` : '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    onClick={() => setTagFilter(tagFilter === t.id ? '' : t.id)}
                    className="pl-2.5 py-1"
                  >
                    {t.name}
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (tagFilter === t.id) setTagFilter('');
                      setTags(prev => prev.filter(x => x.id !== t.id));
                      setTagOverrides(prev => {
                        const next: typeof prev = {};
                        for (const [k, v] of Object.entries(prev)) next[k] = v.filter(tag => tag.id !== t.id);
                        return next;
                      });
                      await deleteTag(t.id);
                      loadTags();
                    }}
                    className="pr-1.5 py-1 opacity-40 hover:opacity-100 transition-opacity"
                    title="Удалить тег"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <TagManager tags={tags} setTags={setTags} setTagOverrides={setTagOverrides} onUpdate={loadTags} />
            </div>
          )}
          {tags.length === 0 && (
            <TagManager tags={tags} setTags={setTags} setTagOverrides={setTagOverrides} onUpdate={loadTags} />
          )}
        </div>
      </BlurFade>

      {error && (
        <div className="p-4 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>{error}</div>
      )}

      {/* Table */}
      <BlurFade delay={0.12}>
        <div className="card-static overflow-visible">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-2 py-[7px] w-8">
                    <button
                      onClick={() => {
                        if (selected.size === filteredAccounts.length) setSelected(new Set());
                        else setSelected(new Set(filteredAccounts.map(a => a.google_account_id)));
                      }}
                      className="flex items-center justify-center"
                      style={{ color: selected.size > 0 ? '#818cf8' : 'var(--text-muted)' }}
                    >
                      {selected.size > 0 && selected.size === filteredAccounts.length
                        ? <CheckSquare className="w-3.5 h-3.5" />
                        : <Square className="w-3.5 h-3.5" />}
                    </button>
                  </th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Google ID</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Профиль</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Статус</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Тип</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Теги</th>
                  <th className="px-2.5 py-[7px] text-center font-medium label-xs">Риск</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Валюта</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Карта</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Домен</th>
                  <th className="px-2.5 py-[7px] text-center font-medium label-xs">Баны</th>
                  <th className="px-2.5 py-[7px] text-right font-medium label-xs">Возраст</th>
                  <th className="px-2.5 py-[7px] text-right font-medium label-xs">Посл. визит</th>
                  <th className="px-2.5 py-[7px] w-6"></th>
                </tr>
              </thead>
              {loading ? (
                <tbody>
                  <tr><td colSpan={14}><TableSkeleton rows={6} cols={8} /></td></tr>
                </tbody>
              ) : filteredAccounts.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={14}>
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
                        <td className="px-2 py-[7px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelected(prev => {
                                const next = new Set(prev);
                                if (next.has(acc.google_account_id)) next.delete(acc.google_account_id);
                                else next.add(acc.google_account_id);
                                return next;
                              });
                            }}
                            className="flex items-center justify-center"
                            style={{ color: selected.has(acc.google_account_id) ? '#818cf8' : 'var(--text-muted)' }}
                          >
                            {selected.has(acc.google_account_id)
                              ? <CheckSquare className="w-3.5 h-3.5" />
                              : <Square className="w-3.5 h-3.5 opacity-30 group-hover:opacity-100 transition-opacity" />}
                          </button>
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <span className={`font-mono whitespace-nowrap ${acc.profile_name ? 'text-[10px]' : 'text-xs'}`} style={{ color: acc.profile_name ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{formatCid(acc.google_account_id)}</span>
                        </td>
                        <td className="px-2.5 py-[7px]">
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
                        <td className="px-2.5 py-[7px]"><StatusBadge status={effectiveStatus(acc)} /></td>
                        <td className="px-2.5 py-[7px]">
                          {acc.account_type ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                              {ACCOUNT_TYPE_LABELS[acc.account_type] ?? acc.account_type}
                              {acc.account_type_source === 'manual' && <span style={{ color: 'var(--accent-green)', fontSize: 8 }}>M</span>}
                            </span>
                          ) : (
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>-</span>
                          )}
                        </td>
                        <td className="px-2.5 py-[7px]">
                          <AccountTagCell
                            account={acc}
                            allTags={tags}
                            overrideTags={tagOverrides[acc.id]}
                            setTagOverrides={setTagOverrides}
                          />
                        </td>
                        <td className="px-2.5 py-[7px] text-center">
                          <RiskBadge risk={risk} />
                        </td>
                        <td className="px-2.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{acc.currency ?? '-'}</td>
                        <td className="px-2.5 py-[7px] text-xs font-mono" style={{ color: acc.card_info ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{acc.card_info ?? '-'}</td>
                        <td className="px-2.5 py-[7px] text-xs max-w-[120px] truncate" style={{ color: acc.domain ? 'var(--accent-green)' : 'var(--text-muted)' }}>{acc.domain ? <a href={acc.domain.startsWith('http') ? acc.domain : `https://${acc.domain}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:underline">{acc.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a> : '-'}</td>
                        <td className="px-2.5 py-[7px] text-center">
                          {parseInt(acc.ban_count, 10) > 0 ? (
                            <span className="font-mono text-xs text-red-400">{acc.ban_count}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>0</span>
                          )}
                        </td>
                        <td className="px-2.5 py-[7px] text-right text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{accountAge(acc.first_seen)}</td>
                        <td className="px-2.5 py-[7px] text-right text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(acc.last_seen)}</td>
                        <td className="px-2.5 py-[7px]">
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
          style={{ background: 'var(--bg-dropdown)', border: '1px solid var(--border-strong)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            Выбрано: {selected.size}
          </span>
          <div className="w-px h-5" style={{ background: 'var(--border-medium)' }} />

          {/* Bulk tag assign */}
          <BulkTagButton selectedIds={[...selected]} tags={tags} onDone={() => { reloadAccounts(); loadTags(); setSelected(new Set()); }} />

          {/* Bulk assessment */}
          <button
            onClick={async () => {
              setBulkLoading('assessment');
              try {
                for (const gid of selected) {
                  await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/assessment?account_google_id=${gid}`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('cts_access_token') ?? ''}` },
                  });
                }
              } catch { /* ignore */ }
              setBulkLoading(null);
              reloadAccounts();
              setSelected(new Set());
            }}
            disabled={bulkLoading === 'assessment'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {bulkLoading === 'assessment' ? 'Оценка...' : 'Assessment'}
          </button>

          {/* Bulk CSV export */}
          <button
            onClick={() => {
              const selectedAccounts = filteredAccounts.filter(a => selected.has(a.google_account_id));
              const headers = ['Google ID', 'Статус', 'Тип', 'Риск', 'Валюта', 'Карта', 'Домен', 'Профиль', 'Баны'];
              const rows = selectedAccounts.map(acc => [
                acc.google_account_id, effectiveStatus(acc), acc.account_type, riskLevel(acc),
                acc.currency, acc.card_info, acc.domain, acc.profile_name, acc.ban_count,
              ]);
              downloadCsv(`accounts_selected_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>

          {/* Clear selection */}
          <button
            onClick={() => setSelected(new Set())}
            className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-muted)' }}
            title="Снять выделение"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
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

function RiskBadge({ risk }: { risk: string }) {
  const cfg: Record<string, { label: string; color: string; bg: string }> = {
    high:    { label: 'Высокий', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
    medium:  { label: 'Средний', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    low:     { label: 'Низкий',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    unknown: { label: '—',       color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
  };
  const c = cfg[risk] ?? cfg['unknown']!;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[10px] font-medium"
      style={{ background: c.bg, color: c.color, minWidth: 36, height: 22, padding: '0 8px', border: `1px solid ${c.color}25` }}
    >
      {c.label}
    </span>
  );
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

// ── Tag preset constructor ────────────────────────────────────────────────────

const TAG_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

interface TagPreset { name: string; color: string }
interface TagCategory { label: string; items: TagPreset[] }

const TAG_PRESETS: TagCategory[] = [
  { label: 'Вертикаль', items: [
    { name: 'gambling', color: '#f43f5e' },
    { name: 'nutra', color: '#10b981' },
    { name: 'crypto', color: '#f59e0b' },
    { name: 'dating', color: '#ec4899' },
    { name: 'sweepstakes', color: '#8b5cf6' },
    { name: 'finance', color: '#3b82f6' },
    { name: 'ecom', color: '#14b8a6' },
  ]},
  { label: 'ГЕО', items: [
    { name: 'EU', color: '#3b82f6' },
    { name: 'US', color: '#6366f1' },
    { name: 'CIS', color: '#f59e0b' },
    { name: 'TIER1', color: '#10b981' },
    { name: 'TIER2', color: '#f97316' },
    { name: 'TIER3', color: '#ef4444' },
    { name: 'LATAM', color: '#8b5cf6' },
    { name: 'ASIA', color: '#ec4899' },
  ]},
  { label: 'Статус', items: [
    { name: 'тест', color: '#f59e0b' },
    { name: 'скейл', color: '#10b981' },
    { name: 'на паузе', color: '#6b7280' },
    { name: 'горит', color: '#ef4444' },
    { name: 'новый', color: '#3b82f6' },
  ]},
  { label: 'Проект', items: [
    { name: 'проект-A', color: '#6366f1' },
    { name: 'проект-B', color: '#14b8a6' },
    { name: 'проект-C', color: '#f43f5e' },
  ]},
];

// ── TagManager — constructor with presets ────────────────────────────────────

function TagManager({ tags, setTags, setTagOverrides, onUpdate }: {
  tags: TagSummary[];
  setTags: React.Dispatch<React.SetStateAction<TagSummary[]>>;
  setTagOverrides: React.Dispatch<React.SetStateAction<Record<string, Array<{ id: string; name: string; color: string }>>>>;
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [customName, setCustomName] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const existingNames = new Set(tags.map((t) => t.name.toLowerCase()));

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 268) });
    }
    setOpen(!open);
  };

  const handleAdd = async (preset: TagPreset) => {
    try {
      await createTag(preset.name, preset.color);
      onUpdate();
    } catch { /* duplicate */ }
  };

  const handleCustomCreate = async () => {
    const name = customName.trim();
    if (!name || existingNames.has(name.toLowerCase())) return;
    const color = TAG_COLORS[tags.length % TAG_COLORS.length]!;
    try {
      await createTag(name, color);
      setCustomName('');
      onUpdate();
    } catch { /* duplicate */ }
  };

  const handleDelete = async (id: string) => {
    setTags(prev => prev.filter(x => x.id !== id));
    setTagOverrides(prev => {
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.filter(t => t.id !== id);
      return next;
    });
    await deleteTag(id);
    onUpdate();
  };

  const dropdown = open ? createPortal(
    <div
      ref={dropRef}
      className="rounded-xl p-3 space-y-3"
      style={{
        position: 'fixed',
        zIndex: 99999,
        top: pos.top,
        left: pos.left,
        width: 260,
        maxHeight: 420,
        overflowY: 'auto',
        background: 'var(--bg-dropdown)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
      }}
    >
      {TAG_PRESETS.map((cat) => (
        <div key={cat.label}>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            {cat.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {cat.items.map((preset) => {
              const exists = existingNames.has(preset.name.toLowerCase());
              return (
                <button
                  key={preset.name}
                  onClick={() => !exists && handleAdd(preset)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                  style={{
                    background: exists ? preset.color + '20' : 'transparent',
                    color: exists ? preset.color : 'var(--text-secondary)',
                    border: `1px solid ${exists ? preset.color + '40' : 'var(--border-strong)'}`,
                    cursor: exists ? 'default' : 'pointer',
                  }}
                >
                  {exists && <span className="text-[8px]">✓</span>}
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Custom tag input */}
      <div style={{ borderTop: '1px solid var(--border-medium)', paddingTop: 8 }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Свой тег
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomCreate()}
            placeholder="Название тега..."
            className="flex-1 bg-transparent outline-none text-xs px-2 py-1 rounded"
            style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={handleCustomCreate}
            disabled={!customName.trim() || existingNames.has(customName.trim().toLowerCase())}
            className="px-2 py-1 rounded text-xs font-medium transition-colors"
            style={{
              background: customName.trim() && !existingNames.has(customName.trim().toLowerCase()) ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: customName.trim() && !existingNames.has(customName.trim().toLowerCase()) ? '#818cf8' : 'var(--text-muted)',
              border: '1px solid var(--border-medium)',
              cursor: customName.trim() && !existingNames.has(customName.trim().toLowerCase()) ? 'pointer' : 'default',
            }}
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 pt-1" style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-medium)', paddingTop: 8 }}>
            Активные теги
          </div>
          <div className="space-y-0.5">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 py-0.5">
                <span className="flex items-center gap-1.5 text-xs" style={{ color: t.color }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                  {t.name}
                </span>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="p-0.5 rounded hover:bg-red-500/10 transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Удалить тег"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
        style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
      >
        <Plus className="w-3 h-3" /> Тег
      </button>
      {dropdown}
    </>
  );
}

// ── AccountTagCell — show tags + assign/unassign popover ────────────────────

function AccountTagCell({ account, allTags, overrideTags, setTagOverrides }: {
  account: AccountSummary;
  allTags: TagSummary[];
  overrideTags?: Array<{ id: string; name: string; color: string }>;
  setTagOverrides: React.Dispatch<React.SetStateAction<Record<string, Array<{ id: string; name: string; color: string }>>>>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // overrideTags (page-level state) takes priority over server data
  const displayTags = overrideTags ?? account.tags ?? [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleAssign = async (tag: { id: string; name: string; color: string }) => {
    const newTags = [...displayTags, tag];
    setTagOverrides(prev => ({ ...prev, [account.id]: newTags }));
    try {
      await assignTag(account.google_account_id, tag.id);
    } catch {
      setTagOverrides(prev => ({ ...prev, [account.id]: displayTags }));
    }
  };

  const handleUnassign = async (tagId: string) => {
    const newTags = displayTags.filter(t => t.id !== tagId);
    setTagOverrides(prev => ({ ...prev, [account.id]: newTags }));
    try {
      await unassignTag(account.google_account_id, tagId);
    } catch {
      setTagOverrides(prev => ({ ...prev, [account.id]: displayTags }));
    }
  };

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const dropH = 200;
      const fitsBelow = rect.bottom + dropH < window.innerHeight;
      setPos({
        top: fitsBelow ? rect.bottom + 4 : rect.top - dropH - 4,
        left: Math.min(rect.left, window.innerWidth - 170),
      });
    }
    setOpen(!open);
  };

  const dropdown = open && allTags.length > 0 ? createPortal(
    <div
      ref={dropRef}
      className="rounded-lg p-1.5 min-w-[160px]"
      style={{
        position: 'fixed',
        zIndex: 99999,
        top: pos.top,
        left: pos.left,
        background: 'var(--bg-dropdown)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {allTags.map((t) => {
        const assigned = displayTags.some((at) => at.id === t.id);
        return (
          <button
            key={t.id}
            onClick={() => assigned ? handleUnassign(t.id) : handleAssign(t)}
            className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors hover:bg-white/5"
            style={{ color: assigned ? t.color : 'var(--text-secondary)' }}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color, opacity: assigned ? 1 : 0.3 }} />
            {t.name}
            {assigned && <span className="ml-auto text-[10px]" style={{ color: t.color }}>✓</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {displayTags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-0.5 rounded-full pl-1.5 pr-0.5 py-0.5 text-[9px] font-medium group/tag"
          style={{ background: t.color + '20', color: t.color, border: `1px solid ${t.color}30` }}
        >
          {t.name}
          <button
            onClick={(e) => { e.stopPropagation(); handleUnassign(t.id); }}
            className="w-3 h-3 inline-flex items-center justify-center rounded-full opacity-0 group-hover/tag:opacity-100 transition-opacity hover:bg-white/20"
            title="Убрать тег"
          >
            <X className="w-2 h-2" />
          </button>
        </span>
      ))}
      <button
        ref={btnRef}
        onClick={handleOpen}
        className="inline-flex items-center justify-center w-5 h-5 rounded transition-colors"
        style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        title="Управление тегами"
      >
        <Plus className="w-3 h-3" />
      </button>
      {dropdown}
    </div>
  );
}

// ── BulkTagButton — assign tag to multiple selected accounts ────────────────

function BulkTagButton({ selectedIds, tags, onDone }: { selectedIds: string[]; tags: TagSummary[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [loading, setLoading] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) && btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleAssign = async (tagId: string) => {
    setLoading(true);
    try {
      await bulkAssignTag(selectedIds, tagId);
      onDone();
    } catch { /* ignore */ }
    setLoading(false);
    setOpen(false);
  };

  const dropdown = open && tags.length > 0 ? createPortal(
    <div
      ref={dropRef}
      className="rounded-lg p-1.5 min-w-[160px]"
      style={{ position: 'fixed', zIndex: 99999, bottom: 70, left: pos.left, background: 'var(--bg-dropdown)', border: '1px solid var(--border-strong)', boxShadow: '0 10px 40px rgba(0,0,0,0.6)' }}
    >
      {loading ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Назначение...</div>
      ) : tags.map(t => (
        <button
          key={t.id}
          onClick={() => handleAssign(t.id)}
          className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors hover:bg-white/5"
          style={{ color: t.color }}
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
          {t.name}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.top, left: rect.left });
          }
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{ background: 'rgba(163,130,250,0.08)', color: '#a78bfa', border: '1px solid rgba(163,130,250,0.2)' }}
      >
        <Tag className="w-3.5 h-3.5" />
        Тег
      </button>
      {dropdown}
    </>
  );
}
