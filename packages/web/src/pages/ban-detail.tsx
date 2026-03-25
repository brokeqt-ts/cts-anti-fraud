import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, DollarSign, Globe, Layers, CreditCard, AlertTriangle, ChevronRight } from 'lucide-react';
import { fetchBan, fetchSimilarBans, ApiError, type BanDetail, type BanSummary, timeAgo, formatDateShortRu } from '../api.js';
import { VerticalBadge, TargetBadge } from '../components/badge.js';
import { TableSkeleton } from '../components/skeleton.js';
import { StaggerContainer, StaggerItem, BlurFade } from '../components/ui/animations.js';

export function BanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ban, setBan] = useState<BanDetail | null>(null);
  const [similar, setSimilar] = useState<BanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    fetchBan(id)
      .then((data) => {
        setBan(data);
        fetchSimilarBans(data).then(setSimilar).catch(() => {});
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Неизвестная ошибка');
      });
  }, [id, navigate]);

  if (error) {
    return (
      <div className="py-5 px-6">
        <BlurFade>
          <div className="p-6 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>
            {error}
          </div>
        </BlurFade>
      </div>
    );
  }

  if (!ban) return <div className="py-5 px-6"><TableSkeleton rows={6} cols={3} /></div>;

  // Snapshot data
  const snap = ban.snapshot as Record<string, unknown> | null;
  const snapDomains = (snap?.domains_active ?? []) as string[];
  const snapSignals = (snap?.signals_at_ban ?? []) as Array<Record<string, unknown>>;

  // Lifetime visualization
  const createdAt = ban.created_at ? new Date(ban.created_at) : null;
  const bannedAt = ban.banned_at ? new Date(ban.banned_at) : null;
  const lifetimeHours = ban.lifetime_hours;

  return (
    <StaggerContainer className="py-5 px-6 space-y-1.5" staggerDelay={0.06}>
      <StaggerItem>
        <Link
          to="/bans"
          className="inline-flex items-center gap-1.5 text-xs transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
        >
          <ArrowLeft className="w-3 h-3" /> Баны
        </Link>
        <h1 className="text-lg font-semibold tracking-tight mt-2 mb-[14px]" style={{ color: 'var(--text-primary)' }}>
          Разбор бана
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {ban.account_google_id} &middot; {ban.domain ?? 'без домена'} &middot; {ban.offer_vertical ?? 'неизвестная вертикаль'}
        </p>
      </StaggerItem>

      {/* Визуализация лайфтайма */}
      {createdAt && bannedAt && lifetimeHours != null && (
        <StaggerItem>
          <div className="card-static p-[12px_14px]">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} strokeWidth={1.5} />
              <span className="label-xs">Время жизни аккаунта</span>
            </div>
            <div className="relative">
              <div className="flex items-center gap-0">
                <div className="flex flex-col items-center" style={{ minWidth: 80 }}>
                  <span className="text-[10px] font-mono" style={{ color: '#4ade80' }}>Создан</span>
                  <div className="w-3 h-3 rounded-full mt-1" style={{ background: '#4ade80', border: '2px solid rgba(34,197,94,0.3)' }} />
                  <span className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    {formatDateShortRu(createdAt.toISOString())}
                  </span>
                </div>
                <div className="flex-1 relative" style={{ height: 2 }}>
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #4ade80, #f87171)' }} />
                  <div className="absolute left-1/2 -translate-x-1/2 -top-3 px-2 py-0.5 rounded text-[10px] font-mono font-semibold" style={{ background: 'var(--border-subtle)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {lifetimeHours}ч ({Math.round(lifetimeHours / 24)}д)
                  </div>
                </div>
                <div className="flex flex-col items-center" style={{ minWidth: 80 }}>
                  <span className="text-[10px] font-mono" style={{ color: '#f87171' }}>Забанен</span>
                  <div className="w-3 h-3 rounded-full mt-1" style={{ background: '#f87171', border: '2px solid rgba(239,68,68,0.3)' }} />
                  <span className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    {formatDateShortRu(bannedAt.toISOString())}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </StaggerItem>
      )}

      {/* Карточка информации */}
      <StaggerItem>
        <div className="card-static p-[12px_14px]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div>
              <dt className="label-xs">Аккаунт</dt>
              <dd className="mt-1">
                <Link to={`/accounts/${ban.account_google_id}`} className="font-mono text-sm transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
                  {ban.account_google_id}
                </Link>
              </dd>
            </div>
            <Field label="Дата бана" value={ban.banned_at ? new Date(ban.banned_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'} />
            <div>
              <dt className="label-xs">Цель</dt>
              <dd className="mt-1"><TargetBadge target={ban.ban_target} /></dd>
            </div>
            <Field label="Лайфтайм" value={lifetimeHours != null ? `${lifetimeHours}ч` : '-'} />
            <div>
              <dt className="label-xs">Вертикаль</dt>
              <dd className="mt-1"><VerticalBadge vertical={ban.offer_vertical} /></dd>
            </div>
            <Field label="Домен" value={ban.domain ?? '-'} />
            <Field label="Тип кампании" value={ban.campaign_type ?? '-'} />
            <Field label="Апелляция" value={ban.appeal_status} />
          </div>

          {ban.lifetime_spend != null && (
            <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" style={{ color: '#fbbf24' }} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Расход за время жизни:</span>
                <span className="text-sm font-mono font-semibold" style={{ color: '#fbbf24' }}>${ban.lifetime_spend.toLocaleString()}</span>
              </div>
            </div>
          )}

          {ban.ban_reason && (
            <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="label-xs mb-2">Причина Google</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{ban.ban_reason}</p>
            </div>
          )}
          {ban.ban_reason_internal && (
            <div className="mt-4">
              <p className="label-xs mb-2">Внутренние заметки</p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{ban.ban_reason_internal}</p>
            </div>
          )}
        </div>
      </StaggerItem>

      {/* Снепшот аккаунта на момент бана */}
      {snap != null && (
        <StaggerItem>
          <div className="card-static p-[12px_14px]">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4" style={{ color: '#fbbf24' }} strokeWidth={1.5} />
              <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Состояние аккаунта на момент бана</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              <SnapshotCard icon={<Layers className="w-3.5 h-3.5" />} label="Статус до бана" value={String(snap.account_status_before ?? '-')} />
              <SnapshotCard icon={<CreditCard className="w-3.5 h-3.5" />} label="Способ оплаты" value={String(snap.payment_method ?? '-')} />
              <SnapshotCard icon={<DollarSign className="w-3.5 h-3.5" />} label="Расход на момент бана" value={String(snap.total_spend_at_ban ?? '-')} />
              <SnapshotCard icon={<Layers className="w-3.5 h-3.5" />} label="Активных кампаний" value={String(snap.campaigns_active ?? '-')} />
              <SnapshotCard icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Уведомлений" value={String(snap.notifications_at_ban ?? '-')} />
              <SnapshotCard icon={<Globe className="w-3.5 h-3.5" />} label="Активных доменов" value={String(snapDomains.length)} />
            </div>

            {snapDomains.length > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="label-xs">Активные домены на момент бана:</span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {snapDomains.map((d) => (
                    <span key={d} className="px-2 py-0.5 rounded text-xs font-mono" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{d}</span>
                  ))}
                </div>
              </div>
            )}

            {snapSignals.length > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="label-xs">Последние сигналы перед баном:</span>
                <div className="mt-2 space-y-1">
                  {snapSignals.map((sig, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: sig.signal_value ? '#f87171' : '#4ade80' }} />
                      <span className="font-mono">{String(sig.signal_name)}</span>
                      <span>= {String(sig.signal_value)}</span>
                      {sig.captured_at != null && <span className="ml-auto">{timeAgo(String(sig.captured_at))}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </StaggerItem>
      )}

      {/* Навигация */}
      <StaggerItem>
        <div className="flex flex-wrap gap-2">
          {ban.account_google_id && (
            <Link to={`/accounts/${ban.account_google_id}`} className="text-xs px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--accent-green)', border: '1px solid var(--border-subtle)' }}>
              Детали аккаунта
            </Link>
          )}
          <Link to="/analytics" className="text-xs px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--accent-green)', border: '1px solid var(--border-subtle)' }}>
            Ban Chain (аналитика)
          </Link>
          {ban.domain && (
            <Link to={`/assessment?domain=${ban.domain}`} className="text-xs px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5" style={{ color: 'var(--accent-green)', border: '1px solid var(--border-subtle)' }}>
              Оценить риск домена
            </Link>
          )}
        </div>
      </StaggerItem>

      {/* Похожие баны */}
      {similar.length > 0 && (
        <StaggerItem>
          <div className="card-static overflow-hidden">
            <div className="px-3.5 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Похожие баны
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                  (та же вертикаль или домен)
                </span>
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Дата</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Аккаунт</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                  <th className="px-3.5 py-[7px] text-left font-medium label-xs">Причина</th>
                  <th className="px-3.5 py-[7px] text-right font-medium label-xs">Лайфтайм</th>
                  <th className="px-3 py-[7px] w-8"></th>
                </tr>
              </thead>
              <tbody>
                {similar.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer group transition-colors"
                    style={{ borderBottom: '1px solid var(--bg-hover)' }}
                    onClick={() => navigate(`/bans/${s.id}`)}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-raised)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(s.banned_at)}</td>
                    <td className="px-3.5 py-[7px] font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{s.account_google_id}</td>
                    <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }}>{s.domain ?? '-'}</td>
                    <td className="px-3.5 py-[7px] text-xs truncate max-w-[160px]" style={{ color: 'var(--text-muted)' }}>{s.ban_reason ?? '-'}</td>
                    <td className="px-3.5 py-[7px] text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{s.lifetime_hours != null ? `${s.lifetime_hours}ч` : '-'}</td>
                    <td className="px-3 py-3">
                      <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </StaggerItem>
      )}
    </StaggerContainer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{value}</dd>
    </div>
  );
}

function SnapshotCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg" style={{ background: 'var(--bg-raised)', border: '1px solid var(--bg-hover)' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}
