import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { fetchBuyerDetail, type BuyerDetail, type AuditEntry, timeAgo, formatCid } from '../api.js';
import { StatusBadge } from '../components/badge.js';
import { TableSkeleton } from '../components/skeleton.js';
import { BlurFade, StaggerContainer, AnimatedRow } from '../components/ui/animations.js';
import { CollapsibleSection } from '../components/collapsible-section.js';

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

export function BuyerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<BuyerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditPage, setAuditPage] = useState(0);
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const navigate = useNavigate();
  const auditLimit = 20;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchBuyerDetail(id, auditPage * auditLimit)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, auditPage]);

  if (loading && !data) return <div className="py-5 px-6"><TableSkeleton rows={6} cols={4} /></div>;
  if (!data) return <div className="py-5 px-6 text-sm" style={{ color: 'var(--text-muted)' }}>Байер не найден</div>;

  const b = data.buyer;
  const banRate = parseFloat(String(b.ban_rate) || '0');
  const lifetime = parseFloat(String(b.avg_lifetime_hours) || '0');

  return (
    <div className="py-5 px-6 space-y-3">
      <BlurFade>
        <Link to="/admin/buyers" className="inline-flex items-center gap-1.5 text-xs transition-colors mb-3" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft className="w-3 h-3" /> Buyer Performance
        </Link>

        {/* Header */}
        <div className="card-static p-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{b.name}</h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{b.email} · {b.role}</p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-ghost)' }}>
                Зарегистрирован {new Date(b.created_at).toLocaleDateString('ru-RU')}
                {b.last_login_at && ` · Последний вход ${timeAgo(b.last_login_at)}`}
              </p>
            </div>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
              style={{
                background: banRate > 50 ? 'rgba(239,68,68,0.1)' : banRate > 20 ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)',
                color: banRate > 50 ? '#ef4444' : banRate > 20 ? '#f59e0b' : '#22c55e',
              }}
            >
              Ban rate: {banRate}%
            </span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <StatPill label="Аккаунты" value={String(b.total_accounts)} />
            <StatPill label="Активные" value={String(b.active_accounts)} color="#4ade80" />
            <StatPill label="Забанено" value={String(b.suspended_accounts)} color="#f87171" />
            <StatPill label="Avg Lifetime" value={lifetime > 24 ? `${(lifetime / 24).toFixed(1)}д` : `${lifetime.toFixed(0)}ч`} />
            <StatPill label="Spend" value={`$${parseFloat(String(b.total_spend) || '0').toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#60a5fa" />
          </div>
        </div>
      </BlurFade>

      {/* Bans by vertical */}
      {data.bans_by_vertical.length > 0 && (
        <BlurFade delay={0.04}>
          <div className="card-static p-4">
            <h2 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Баны по вертикалям</h2>
            <div className="flex flex-wrap gap-2">
              {data.bans_by_vertical.map(v => (
                <span key={v.offer_vertical} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                  {v.offer_vertical}
                  <span className="font-mono font-semibold" style={{ color: '#f87171' }}>{v.count}</span>
                </span>
              ))}
            </div>
          </div>
        </BlurFade>
      )}

      {/* Accounts */}
      <BlurFade delay={0.06}>
        <CollapsibleSection title="Аккаунты" count={data.accounts.length} defaultOpen>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2 text-left font-medium label-xs">Google ID</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Название</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Статус</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Тип</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Валюта</th>
                  <th className="px-3 py-2 text-center font-medium label-xs">Баны</th>
                  <th className="px-3 py-2 w-6"></th>
                </tr>
              </thead>
              <StaggerContainer as="tbody" staggerDelay={0.03}>
                {data.accounts.map(acc => (
                  <AnimatedRow key={acc.google_account_id} className="cursor-pointer" onClick={() => navigate(`/accounts/${acc.google_account_id}`)}>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{formatCid(acc.google_account_id)}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{acc.display_name ?? '-'}</td>
                    <td className="px-3 py-2"><StatusBadge status={acc.status} /></td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{acc.account_type ?? '-'}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{acc.currency ?? '-'}</td>
                    <td className="px-3 py-2 text-center">
                      {acc.ban_count > 0 ? <span className="font-mono text-xs" style={{ color: '#f87171' }}>{acc.ban_count}</span> : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                    </td>
                    <td className="px-3 py-2"><ExternalLink className="w-3 h-3" style={{ color: 'var(--text-muted)' }} /></td>
                  </AnimatedRow>
                ))}
              </StaggerContainer>
            </table>
          </div>
        </CollapsibleSection>
      </BlurFade>

      {/* Audit log */}
      <BlurFade delay={0.08}>
        <CollapsibleSection title="История действий" count={data.audit.total} defaultOpen>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <th className="px-3 py-2 text-left font-medium label-xs">Время</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Действие</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">Объект</th>
                  <th className="px-3 py-2 text-left font-medium label-xs">IP</th>
                  <th className="px-3 py-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {data.audit.entries.map((entry: AuditEntry) => {
                  const expanded = expandedAudit === entry.id;
                  const color = ACTION_COLORS[entry.action] ?? '#94a3b8';
                  return (
                    <tr
                      key={entry.id}
                      className="cursor-pointer animated-row"
                      onClick={() => setExpandedAudit(expanded ? null : entry.id)}
                      style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    >
                      <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {timeAgo(entry.created_at)}
                        <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{new Date(entry.created_at).toLocaleString('ru-RU')}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: color + '15', color, border: `1px solid ${color}30` }}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                        {entry.entity_type && <span><span style={{ color: 'var(--text-secondary)' }}>{entry.entity_type}</span>{entry.entity_id && `:${entry.entity_id.slice(0, 8)}`}</span>}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--text-ghost)' }}>{entry.ip_address ?? '-'}</td>
                      <td className="px-3 py-2">
                        {entry.details && (expanded ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />)}
                      </td>
                      {expanded && entry.details && (
                        <td colSpan={5} className="px-3 pb-3">
                          <pre className="text-[10px] p-2 rounded-lg mt-1 overflow-x-auto" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                            {JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {data.audit.total > auditLimit && (
            <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {auditPage * auditLimit + 1}–{Math.min((auditPage + 1) * auditLimit, data.audit.total)} из {data.audit.total}
              </span>
              <div className="flex gap-1.5">
                <button onClick={() => setAuditPage(p => Math.max(0, p - 1))} disabled={auditPage === 0} className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: auditPage === 0 ? 'transparent' : 'var(--bg-card)', color: auditPage === 0 ? 'var(--text-ghost)' : 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>Назад</button>
                <button onClick={() => setAuditPage(p => p + 1)} disabled={(auditPage + 1) * auditLimit >= data.audit.total} className="px-2.5 py-1 rounded-lg text-xs font-medium" style={{ background: (auditPage + 1) * auditLimit >= data.audit.total ? 'transparent' : 'var(--bg-card)', color: (auditPage + 1) * auditLimit >= data.audit.total ? 'var(--text-ghost)' : 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>Далее</button>
              </div>
            </div>
          )}
        </CollapsibleSection>
      </BlurFade>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-base font-bold font-mono mt-0.5" style={{ color: color ?? 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
