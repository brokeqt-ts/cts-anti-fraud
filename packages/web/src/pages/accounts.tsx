import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Users, Download, Tag, Plus, X } from 'lucide-react';
import {
  fetchAccounts, ApiError, type AccountSummary, type OverviewStats, fetchOverview,
  timeAgo, formatCid, riskLevel, effectiveStatus,
  fetchTags, createTag, deleteTag, assignTag, unassignTag, type TagSummary,
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const loadTags = useCallback(() => {
    fetchTags().then((d) => setTags(d.tags)).catch(() => {});
  }, []);

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
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      })
      .finally(() => setLoading(false));
  }, [search, statusFilter, currencyFilter, tagFilter, navigate]);

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
                acc.health_score ?? riskLevel(acc),
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
                <button
                  key={t.id}
                  onClick={() => setTagFilter(tagFilter === t.id ? '' : t.id)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200"
                  style={{
                    background: tagFilter === t.id ? t.color + '30' : 'var(--bg-card)',
                    color: tagFilter === t.id ? t.color : 'var(--text-muted)',
                    border: tagFilter === t.id ? `1px solid ${t.color}50` : '1px solid var(--border-subtle)',
                  }}
                >
                  {t.name}
                  <span className="ml-1 opacity-60">{t.account_count}</span>
                </button>
              ))}
              <TagManager tags={tags} onUpdate={loadTags} />
            </div>
          )}
          {tags.length === 0 && (
            <TagManager tags={tags} onUpdate={loadTags} />
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
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Google ID</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Профиль</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Статус</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Тип</th>
                  <th className="px-2.5 py-[7px] text-left font-medium label-xs">Теги</th>
                  <th className="px-2.5 py-[7px] text-center font-medium label-xs">Health</th>
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
                  <tr><td colSpan={13}><TableSkeleton rows={6} cols={8} /></td></tr>
                </tbody>
              ) : filteredAccounts.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={13}>
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
                          <AccountTagCell account={acc} allTags={tags} onUpdate={() => {
                            const params: Record<string, string> = {};
                            if (search) params['search'] = search;
                            if (statusFilter) params['status'] = statusFilter;
                            if (currencyFilter) params['currency'] = currencyFilter;
                            if (tagFilter) params['tag_id'] = tagFilter;
                            fetchAccounts(params).then((d) => { setAccounts(d.accounts); setTotal(d.total); }).catch(() => {});
                            loadTags();
                          }} />
                        </td>
                        <td className="px-2.5 py-[7px] text-center">
                          <HealthBadge score={acc.health_score} risk={risk} />
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

function HealthBadge({ score, risk }: { score?: number | null; risk: string }) {
  if (score == null) {
    // Fallback to old risk badge if no health score calculated yet
    const RISK_LABELS: Record<string, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий', unknown: '—' };
    return <span className={`risk-badge-${risk} inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium`}>{RISK_LABELS[risk] ?? '—'}</span>;
  }
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : score >= 25 ? '#f97316' : '#ef4444';
  const bg = score >= 80 ? 'rgba(34,197,94,0.12)' : score >= 50 ? 'rgba(234,179,8,0.12)' : score >= 25 ? 'rgba(249,115,22,0.12)' : 'rgba(239,68,68,0.12)';
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-mono text-[11px] font-semibold"
      style={{ background: bg, color, minWidth: 36, height: 22, padding: '0 6px' }}
      title={`Health Score: ${score}/100`}
    >
      {score}
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

// ── Tag Colors ────────────────────────────────────────────────────────────────
const TAG_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

// ── TagManager — create/delete tags (button + dropdown) ─────────────────────

function TagManager({ tags, onUpdate }: { tags: TagSummary[]; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLORS[0]!);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await createTag(newName.trim(), newColor);
      setNewName('');
      onUpdate();
    } catch { /* ignore duplicate */ }
  };

  const handleDelete = async (id: string) => {
    await deleteTag(id);
    onUpdate();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
        style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px dashed var(--border-strong)' }}
      >
        <Plus className="w-3 h-3" /> Тег
      </button>
      {open && (
        <div
          className="absolute right-0 bottom-full mb-1 z-50 rounded-xl p-3 space-y-2 shadow-2xl min-w-[220px]"
          style={{ background: 'var(--bg-dropdown)', border: '1px solid var(--border-medium)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Создать тег
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="gambling-eu"
              className="flex-1 bg-transparent outline-none text-xs px-2 py-1 rounded"
              style={{ border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
            />
            <button onClick={handleCreate} className="px-2 py-1 rounded text-xs font-medium" style={{ background: newColor + '20', color: newColor, border: `1px solid ${newColor}40` }}>
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <div className="flex gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full transition-transform"
                style={{
                  background: c,
                  transform: newColor === c ? 'scale(1.2)' : 'scale(1)',
                  boxShadow: newColor === c ? `0 0 0 2px var(--bg-base), 0 0 0 3px ${c}` : 'none',
                }}
              />
            ))}
          </div>
          {tags.length > 0 && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider pt-1" style={{ color: 'var(--text-muted)' }}>
                Существующие
              </div>
              <div className="space-y-1 max-h-[150px] overflow-y-auto">
                {tags.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color }} />
                      {t.name}
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>({t.account_count})</span>
                    </span>
                    <button onClick={() => handleDelete(t.id)} className="p-0.5 rounded hover:bg-white/10 transition-colors" style={{ color: 'var(--text-muted)' }}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── AccountTagCell — show tags + assign/unassign popover ────────────────────

function AccountTagCell({ account, allTags, onUpdate }: { account: AccountSummary; allTags: TagSummary[]; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const accTags = account.tags ?? [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleToggle = async (tagId: string, assigned: boolean) => {
    try {
      if (assigned) {
        await unassignTag(account.google_account_id, tagId);
      } else {
        await assignTag(account.google_account_id, tagId);
      }
      onUpdate();
    } catch { /* ignore */ }
  };

  return (
    <div className="relative flex flex-wrap gap-1 items-center" ref={ref}>
      {accTags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
          style={{ background: t.color + '20', color: t.color, border: `1px solid ${t.color}30` }}
        >
          {t.name}
        </span>
      ))}
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors hover:bg-white/10"
        style={{ color: 'var(--text-muted)', opacity: accTags.length > 0 ? 0.5 : 0.3 }}
        title="Управление тегами"
      >
        <Plus className="w-3 h-3" />
      </button>
      {open && allTags.length > 0 && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-lg p-1.5 shadow-2xl min-w-[160px]"
          style={{ background: 'var(--bg-dropdown)', border: '1px solid var(--border-medium)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {allTags.map((t) => {
            const assigned = accTags.some((at) => at.id === t.id);
            return (
              <button
                key={t.id}
                onClick={() => handleToggle(t.id, assigned)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors hover:bg-white/5"
                style={{ color: assigned ? t.color : 'var(--text-muted)' }}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: t.color, opacity: assigned ? 1 : 0.3 }} />
                {t.name}
                {assigned && <span className="ml-auto text-[10px]" style={{ color: t.color }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
