import { useEffect, useState } from 'react';
import { ClipboardList, ChevronDown, ChevronUp } from 'lucide-react';
import { fetchAuditLog, type AuditEntry, timeAgo } from '../api.js';
import { TableSkeleton } from '../components/skeleton.js';
import { BlurFade, StaggerContainer, AnimatedRow } from '../components/ui/animations.js';

const ACTION_LABELS: Record<string, string> = {
  'ban.create': 'Записал бан',
  'account.update': 'Обновил аккаунт',
  'user.create': 'Создал пользователя',
  'user.update': 'Обновил пользователя',
  'user.delete': 'Деактивировал пользователя',
  'tag.create': 'Создал тег',
  'tag.delete': 'Удалил тег',
  'extension.download': 'Скачал расширение',
  'settings.update': 'Изменил настройки',
};

const ACTION_COLORS: Record<string, string> = {
  'ban.create': '#f87171',
  'account.update': '#60a5fa',
  'user.create': '#4ade80',
  'user.update': '#fbbf24',
  'user.delete': '#f87171',
  'tag.create': '#a78bfa',
  'tag.delete': '#f87171',
  'extension.download': '#14b8a6',
  'settings.update': '#fbbf24',
};

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 30;

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { limit: String(limit), offset: String(page * limit) };
    if (actionFilter) params['action'] = actionFilter;
    fetchAuditLog(params)
      .then((d) => { setEntries(d.entries); setTotal(d.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [actionFilter, page]);

  return (
    <div className="py-5 px-6 space-y-3">
      <BlurFade>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Аудит</h1>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{total} записей</span>
          </div>
        </div>
      </BlurFade>

      {/* Filters */}
      <BlurFade delay={0.04}>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={!actionFilter} onClick={() => { setActionFilter(''); setPage(0); }}>Все</FilterPill>
          {['ban.create', 'account.update', 'user.create', 'user.update', 'user.delete', 'tag.create', 'tag.delete', 'extension.download', 'settings.update'].map(a => (
            <FilterPill key={a} active={actionFilter === a} onClick={() => { setActionFilter(a); setPage(0); }}>
              {ACTION_LABELS[a] ?? a}
            </FilterPill>
          ))}
        </div>
      </BlurFade>

      {/* Table */}
      <BlurFade delay={0.08}>
        <div className="card-static overflow-visible">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2 text-left font-medium label-xs">Время</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Пользователь</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Действие</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Объект</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">IP</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              {loading ? (
                <tbody>
                  <tr><td colSpan={6}><TableSkeleton rows={6} cols={5} /></td></tr>
                </tbody>
              ) : entries.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={6}>
                      <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                        Нет записей аудита
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <StaggerContainer as="tbody" staggerDelay={0.03}>
                  {entries.map((entry) => {
                    const expanded = expandedId === entry.id;
                    const color = ACTION_COLORS[entry.action] ?? '#94a3b8';
                    return (
                      <AnimatedRow key={entry.id} className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : entry.id)}>
                        <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                          {timeAgo(entry.created_at)}
                          <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
                            {new Date(entry.created_at).toLocaleString('ru-RU')}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {entry.user_name}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{ background: color + '15', color, border: `1px solid ${color}30` }}
                          >
                            {ACTION_LABELS[entry.action] ?? entry.action}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {entry.entity_type && (
                            <span>
                              <span style={{ color: 'var(--text-secondary)' }}>{entry.entity_type}</span>
                              {entry.entity_id && <span>:{entry.entity_id.slice(0, 8)}</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--text-ghost)' }}>
                          {entry.ip_address ?? '-'}
                        </td>
                        <td className="px-3 py-2">
                          {entry.details ? (
                            expanded
                              ? <ChevronUp className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                              : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                          ) : null}
                        </td>
                        {expanded && entry.details && (
                          <td colSpan={6} className="px-3 pb-3">
                            <pre
                              className="text-[10px] p-2 rounded-lg mt-1 overflow-x-auto"
                              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                            >
                              {JSON.stringify(entry.details, null, 2)}
                            </pre>
                          </td>
                        )}
                      </AnimatedRow>
                    );
                  })}
                </StaggerContainer>
              )}
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {page * limit + 1}–{Math.min((page + 1) * limit, total)} из {total}
              </span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: page === 0 ? 'transparent' : 'var(--bg-card)',
                    color: page === 0 ? 'var(--text-ghost)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    cursor: page === 0 ? 'default' : 'pointer',
                  }}
                >
                  Назад
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * limit >= total}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: (page + 1) * limit >= total ? 'transparent' : 'var(--bg-card)',
                    color: (page + 1) * limit >= total ? 'var(--text-ghost)' : 'var(--text-secondary)',
                    border: '1px solid var(--border-subtle)',
                    cursor: (page + 1) * limit >= total ? 'default' : 'pointer',
                  }}
                >
                  Далее
                </button>
              </div>
            </div>
          )}
        </div>
      </BlurFade>
    </div>
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
