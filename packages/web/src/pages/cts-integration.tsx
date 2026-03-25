import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, Plus, Trash2, ExternalLink, RefreshCw, Loader2, Users, Settings } from 'lucide-react';
import {
  fetchCtsSites, createCtsSite, updateCtsSite, deleteCtsSite,
  syncCTS, fetchCTSTraffic, linkCTSSite, fetchAccounts,
  ApiError, type CtsSite, type CTSTrafficDay, type AccountSummary, timeAgo,
} from '../api.js';
import { TableSkeleton } from '../components/skeleton.js';
import {
  BlurFade,
  StaggerContainer,
  AnimatedRow,
} from '../components/ui/animations.js';

export function CtsIntegrationPage() {
  const [sites, setSites] = useState<CtsSite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newCtsId, setNewCtsId] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<Record<string, CTSTrafficDay[]>>({});
  const [linkModal, setLinkModal] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [linkAccountId, setLinkAccountId] = useState('');
  const navigate = useNavigate();

  const load = useCallback(() => {
    fetchCtsSites()
      .then((res) => setSites(res.sites))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      });
  }, [navigate]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    setSaving(true);
    try {
      await createCtsSite({ domain: newDomain.trim(), external_cts_id: newCtsId.trim() || undefined });
      setNewDomain('');
      setNewCtsId('');
      setShowAdd(false);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncCTS();
      setSyncResult(`Синхронизировано: ${res.synced} сайтов`);
      load();
    } catch (e: unknown) {
      setSyncResult(e instanceof Error ? e.message : 'Ошибка синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateCtsId = async (site: CtsSite, value: string) => {
    try {
      await updateCtsSite(site.id, { external_cts_id: value || undefined });
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка обновления');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteCtsSite(id);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    }
  };

  const toggleTraffic = async (siteId: string) => {
    if (expandedSite === siteId) {
      setExpandedSite(null);
      return;
    }
    setExpandedSite(siteId);
    if (!traffic[siteId]) {
      try {
        const res = await fetchCTSTraffic(siteId, '30d');
        setTraffic(prev => ({ ...prev, [siteId]: res.traffic }));
      } catch {
        setTraffic(prev => ({ ...prev, [siteId]: [] }));
      }
    }
  };

  const openLinkModal = async (siteId: string) => {
    setLinkModal(siteId);
    setLinkAccountId('');
    if (!accounts) {
      try {
        const res = await fetchAccounts();
        setAccounts(res.accounts);
      } catch { /* ignore */ }
    }
  };

  const handleLink = async () => {
    if (!linkModal || !linkAccountId) return;
    try {
      await linkCTSSite(linkModal, linkAccountId);
      setLinkModal(null);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка привязки');
    }
  };

  if (error) {
    return (
      <div className="py-5 px-6">
        <BlurFade>
          <div className="p-6 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>
            {error}
            <button onClick={() => setError(null)} className="ml-4 underline text-xs">Закрыть</button>
          </div>
        </BlurFade>
      </div>
    );
  }

  if (!sites) return <div className="py-5 px-6"><TableSkeleton rows={5} cols={4} /></div>;

  return (
    <div className="py-5 px-6 space-y-4">
      <BlurFade>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <Link2 className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
              CTS Интеграция
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {sites.length} сайтов · Связь доменов с CTS
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-ghost-green flex items-center gap-1.5 text-xs"
              style={{ padding: '6px 12px', opacity: syncing ? 0.6 : 1 }}
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Синхронизировать
            </button>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="btn-ghost-green flex items-center gap-1.5 text-xs"
              style={{ padding: '6px 12px' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить
            </button>
          </div>
        </div>
        {syncResult && (
          <div className="text-xs mt-1" style={{ color: syncResult.includes('Ошибка') ? '#f87171' : '#4ade80' }}>
            {syncResult}
          </div>
        )}
      </BlurFade>

      {showAdd && (
        <BlurFade>
          <div className="p-4 rounded-xl flex items-end gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Домен</label>
              <input type="text" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" className="w-full px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>CTS ID (опционально)</label>
              <input type="text" value={newCtsId} onChange={(e) => setNewCtsId(e.target.value)} placeholder="cts-12345" className="w-full px-3 py-1.5 rounded-lg text-sm" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }} />
            </div>
            <button onClick={handleAdd} disabled={saving || !newDomain.trim()} className="btn-ghost-green text-xs" style={{ padding: '6px 16px', opacity: saving ? 0.5 : 1 }}>
              {saving ? 'Сохр...' : 'Сохранить'}
            </button>
          </div>
        </BlurFade>
      )}

      {/* Site List */}
      <div className="card-static overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--bg-base)' }}>
              <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">CTS ID</th>
                <th className="px-3.5 py-[7px] text-center font-medium label-xs">Статус</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Score</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Обновлён</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs" style={{ width: 120 }}>Действия</th>
              </tr>
            </thead>
            <StaggerContainer as="tbody" staggerDelay={0.03} className="">
              {sites.map((site) => (
                <AnimatedRow key={site.id}>
                  <td className="px-3.5 py-[7px]">
                    <div className="flex items-center gap-1.5">
                      <a href={`https://${site.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono transition-colors hover:underline" style={{ color: 'var(--accent-green)' }}>
                        {site.domain}
                      </a>
                      <ExternalLink className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </td>
                  <td className="px-3.5 py-[7px]">
                    <InlineEditCtsId value={site.external_cts_id ?? ''} onSave={(v) => handleUpdateCtsId(site, v)} />
                  </td>
                  <td className="px-3.5 py-[7px] text-center">
                    <SiteStatusBadge status={site.site_status} />
                  </td>
                  <td className="px-3.5 py-[7px] text-right">
                    <ScoreDisplay score={site.safe_page_quality_score} />
                  </td>
                  <td className="px-3.5 py-[7px] text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    {timeAgo(site.updated_at)}
                  </td>
                  <td className="px-3.5 py-[7px] text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => toggleTraffic(site.id)} className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: expandedSite === site.id ? 'var(--accent-green)' : 'var(--text-muted)' }} title="Посмотреть трафик">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openLinkModal(site.id)} className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: 'var(--text-muted)' }} title="Привязать к аккаунту">
                        <Users className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(site.id)} className="p-1 rounded transition-colors hover:bg-red-500/10" style={{ color: 'var(--text-muted)' }} title="Удалить">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </AnimatedRow>
              ))}
            </StaggerContainer>
          </table>
        </div>

        {/* Traffic mini-dashboard */}
        {expandedSite && (
          <BlurFade>
            <TrafficPanel traffic={traffic[expandedSite] ?? null} />
          </BlurFade>
        )}

        {sites.length === 0 && (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <Settings className="w-6 h-6" style={{ color: 'var(--border-hover)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Нет сайтов CTS</p>
            <p className="text-xs max-w-md text-center" style={{ color: 'var(--text-ghost)' }}>
              Для подключения CTS укажите CTS_API_URL и CTS_API_KEY в настройках сервера, затем нажмите «Синхронизировать».
            </p>
          </div>
        )}
      </div>

      {/* Link Modal */}
      {linkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setLinkModal(null)}>
          <div className="rounded-xl p-5 w-full max-w-md" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Привязать к аккаунту</h3>
            {accounts ? (
              <select value={linkAccountId} onChange={(e) => setLinkAccountId(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm mb-3" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}>
                <option value="">Выберите аккаунт...</option>
                {accounts.map(a => (
                  <option key={a.google_account_id} value={a.google_account_id}>
                    {a.display_name ?? a.google_account_id} ({a.google_account_id})
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Загрузка аккаунтов...</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setLinkModal(null)} className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>Отмена</button>
              <button onClick={handleLink} disabled={!linkAccountId} className="btn-ghost-green text-xs" style={{ padding: '6px 16px', opacity: linkAccountId ? 1 : 0.5 }}>Привязать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrafficPanel({ traffic }: { traffic: CTSTrafficDay[] | null }) {
  if (!traffic) return <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>Загрузка трафика...</div>;
  if (traffic.length === 0) return <div className="p-4 text-xs" style={{ color: 'var(--text-ghost)' }}>Нет данных о трафике</div>;

  const maxVisits = Math.max(...traffic.map(t => t.visits), 1);
  const totalVisits = traffic.reduce((s, t) => s + t.visits, 0);
  const totalUnique = traffic.reduce((s, t) => s + t.unique_visitors, 0);

  return (
    <div className="p-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Трафик за 30 дней</span>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Визиты: {totalVisits.toLocaleString()}</span>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Уники: {totalUnique.toLocaleString()}</span>
        </div>
      </div>
      <div className="flex items-end gap-[2px]" style={{ height: 60 }}>
        {traffic.map(t => {
          const h = Math.max((t.visits / maxVisits) * 100, 2);
          return (
            <div key={t.date} className="flex-1 rounded-t" style={{ height: `${h}%`, background: 'var(--accent-green)', opacity: 0.7, minWidth: 3 }} title={`${t.date}: ${t.visits} визитов`} />
          );
        })}
      </div>
    </div>
  );
}

function InlineEditCtsId({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span className="text-xs font-mono cursor-pointer px-1 py-0.5 rounded hover:bg-white/5" style={{ color: value ? 'var(--text-secondary)' : 'var(--text-ghost)' }} onClick={() => { setDraft(value); setEditing(true); }}>
        {value || '—'}
      </span>
    );
  }

  return (
    <input autoFocus type="text" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { onSave(draft); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Enter') { onSave(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} className="px-1.5 py-0.5 rounded text-xs font-mono w-32" style={{ background: 'var(--bg-base)', border: '1px solid var(--accent-green)', color: 'var(--text-primary)', outline: 'none' }} />
  );
}

function SiteStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
  const colors: Record<string, string> = { live: '#4ade80', redirect: '#60a5fa', blocked: '#fbbf24', down: '#f87171', error: '#f87171' };
  const color = colors[status] ?? 'var(--text-muted)';
  return <span className="text-xs font-medium" style={{ color }}>{status}</span>;
}

function ScoreDisplay({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>;
  const color = score >= 70 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171';
  return <span className="text-xs font-mono font-semibold" style={{ color }}>{Math.round(score)}</span>;
}
