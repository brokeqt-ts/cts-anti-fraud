import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Globe, ExternalLink, ShieldAlert, CheckCircle, XCircle, AlertTriangle, Cloud, ShieldCheck, EyeOff } from 'lucide-react';
import { fetchDomains, ApiError, type DomainSummary } from '../api.js';
import { TableSkeleton } from '../components/skeleton.js';
import {
  BlurFade,
  StaggerContainer,
  AnimatedRow,
} from '../components/ui/animations.js';

export function DomainsPage() {
  const [domains, setDomains] = useState<DomainSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDomains()
      .then((res) => setDomains(res.domains))
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="py-5 px-6">
        <BlurFade>
          <div className="p-6 text-sm" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>{error}</div>
        </BlurFade>
      </div>
    );
  }

  if (!domains) return <div className="py-5 px-6"><TableSkeleton rows={10} cols={6} /></div>;

  const totalBans = domains.reduce((sum, d) => sum + parseInt(d.ban_count, 10), 0);
  const totalAccounts = new Set(domains.flatMap(d => d.account_ids ?? [])).size;
  const enriched = domains.filter(d => d.last_checked_at != null).length;

  return (
    <div className="py-5 px-6 space-y-1.5">
      <BlurFade>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <Globe className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
              Домены
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {domains.length} доменов · {totalAccounts} аккаунтов · {totalBans} банов
              {enriched > 0 && <> · {enriched} обогащено</>}
            </p>
          </div>
        </div>
      </BlurFade>

      <div className="card-static overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: 'var(--bg-base)' }}>
              <tr style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Домен</th>
                <th className="px-3.5 py-[7px] text-center font-medium label-xs">Статус</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Акк</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Баны</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Возраст</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">SSL</th>
                <th className="px-3.5 py-[7px] text-left font-medium label-xs">Hosting</th>
                <th className="px-3.5 py-[7px] text-center font-medium label-xs">Страницы</th>
                <th className="px-3.5 py-[7px] text-center font-medium label-xs">Клоакинг</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs">Score</th>
                <th className="px-3.5 py-[7px] text-right font-medium label-xs" style={{ width: 32 }}></th>
              </tr>
            </thead>
            <StaggerContainer as="tbody" staggerDelay={0.03} className="">
              {domains.map((d) => {
                const banCount = parseInt(d.ban_count, 10);
                const accCount = parseInt(d.account_count, 10);
                const score = d.safe_page_quality_score ?? (d.content_quality_score != null ? Number(d.content_quality_score) : null);
                const ageLabel = d.domain_age_days != null
                  ? d.domain_age_days > 365
                    ? `${Math.floor(d.domain_age_days / 365)}г${d.domain_age_days % 365 > 30 ? ' ' + Math.floor((d.domain_age_days % 365) / 30) + 'м' : ''}`
                    : `${d.domain_age_days}д`
                  : '-';
                const ageTooltip = [
                  d.registrar ? `Регистратор: ${d.registrar}` : null,
                  d.created_date ? `Создан: ${d.created_date}` : null,
                  d.expires_date ? `Истекает: ${d.expires_date}` : null,
                ].filter(Boolean).join('\n') || undefined;

                const hostingLabel = d.hosting_provider
                  ? `${d.hosting_provider}${d.hosting_country ? ` (${d.hosting_country})` : ''}`
                  : d.hosting_asn ?? d.hosting_ip ?? '-';

                return (
                  <AnimatedRow key={d.domain}>
                    <td className="px-3.5 py-[7px]">
                      <div className="flex items-center gap-1.5">
                        {d.has_cloudflare && (
                          <span title="Cloudflare"><Cloud className="w-3 h-3 flex-shrink-0" style={{ color: '#f6821f' }} /></span>
                        )}
                        <a
                          href={`https://${d.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-mono transition-colors hover:underline"
                          style={{ color: 'var(--accent-green)' }}
                        >
                          {d.domain}
                        </a>
                        <ExternalLink className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                      </div>
                      {d.meta_title && (
                        <div className="text-xs truncate max-w-[200px] mt-0.5" style={{ color: 'var(--text-faint)', fontSize: 10 }}>
                          {d.meta_title}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-[7px] text-center">
                      <StatusBadge status={d.site_status} />
                    </td>
                    <td className="px-3.5 py-[7px] text-right">
                      <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{accCount}</span>
                    </td>
                    <td className="px-3.5 py-[7px] text-right">
                      {banCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono font-semibold" style={{ color: '#f87171' }}>
                          <ShieldAlert className="w-3 h-3" />
                          {banCount}
                        </span>
                      ) : (
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td className="px-3.5 py-[7px] text-xs" style={{ color: 'var(--text-muted)' }} title={ageTooltip}>{ageLabel}</td>
                    <td className="px-3.5 py-[7px]">
                      <SslBadge type={d.ssl_type_enum} />
                    </td>
                    <td className="px-3.5 py-[7px] text-xs max-w-[140px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {hostingLabel}
                    </td>
                    <td className="px-3.5 py-[7px] text-center">
                      <PageIndicators d={d} />
                    </td>
                    <td className="px-3.5 py-[7px] text-center">
                      <CloakingIndicator detected={d.cloaking_detected} type={d.cloaking_type} checkedAt={d.cloaking_checked_at} />
                    </td>
                    <td className="px-3.5 py-[7px] text-right">
                      <ScoreBadge score={score} safeScore={d.safe_page_quality_score} contentScore={d.content_quality_score != null ? Number(d.content_quality_score) : null} pagespeed={d.pagespeed_score != null ? Number(d.pagespeed_score) : null} />
                    </td>
                    <td className="px-3.5 py-[7px] text-right">
                      <Link to={`/assessment?domain=${d.domain}`} className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: 'var(--text-muted)' }} title="Оценить риск">
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </AnimatedRow>
                );
              })}
            </StaggerContainer>
          </table>
        </div>

        {domains.length === 0 && (
          <div className="py-16 flex flex-col items-center justify-center gap-2">
            <Globe className="w-6 h-6" style={{ color: 'var(--border-hover)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Нет доменов — ожидайте данных от объявлений</p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;
  const styles: Record<string, { bg: string; color: string; label: string; Icon: typeof CheckCircle }> = {
    live: { bg: 'rgba(34,197,94,0.08)', color: '#4ade80', label: 'Live', Icon: CheckCircle },
    redirect: { bg: 'rgba(59,130,246,0.08)', color: '#60a5fa', label: 'Redir', Icon: AlertTriangle },
    blocked: { bg: 'rgba(251,191,36,0.08)', color: '#fbbf24', label: 'Block', Icon: AlertTriangle },
    down: { bg: 'rgba(239,68,68,0.08)', color: '#f87171', label: 'Down', Icon: XCircle },
    error: { bg: 'rgba(239,68,68,0.08)', color: '#f87171', label: 'Err', Icon: XCircle },
  };
  const s = styles[status] ?? { bg: 'var(--bg-raised)', color: 'var(--text-muted)', label: status, Icon: AlertTriangle };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}20`, fontSize: 10 }}
    >
      <s.Icon className="w-2.5 h-2.5" />
      {s.label}
    </span>
  );
}

function PageIndicators({ d }: { d: DomainSummary }) {
  const items: { label: string; ok: boolean | null }[] = [
    { label: 'PP', ok: d.has_privacy_page },
    { label: 'TOS', ok: d.has_terms_page },
    { label: 'Blog', ok: d.has_blog },
  ];

  const hasAny = items.some(i => i.ok != null);
  if (!hasAny) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;

  return (
    <div className="flex items-center gap-1 justify-center">
      {items.map(({ label, ok }) => (
        <span
          key={label}
          className="rounded px-1 py-px text-xs font-medium"
          style={{
            fontSize: 9,
            background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.06)',
            color: ok ? '#4ade80' : 'var(--text-ghost)',
            border: `1px solid ${ok ? 'rgba(34,197,94,0.15)' : 'transparent'}`,
          }}
          title={ok ? `${label}: есть` : `${label}: нет`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function SslBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    lets_encrypt: { bg: 'rgba(34,197,94,0.08)', color: '#4ade80', label: 'LE' },
    paid: { bg: 'rgba(59,130,246,0.08)', color: '#60a5fa', label: 'Paid' },
    none: { bg: 'rgba(239,68,68,0.08)', color: '#f87171', label: 'None' },
    unknown: { bg: 'var(--bg-raised)', color: 'var(--text-muted)', label: '?' },
  };
  const s = styles[type] ?? styles['unknown']!;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}20`, fontSize: 10 }}
    >
      {s.label}
    </span>
  );
}

function CloakingIndicator({ detected, type, checkedAt }: { detected: boolean | null; type?: string | null; checkedAt?: string | null }) {
  if (detected == null) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;
  if (detected) {
    const typeLabel = type ? type.replace(/_/g, ' ') : 'detected';
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)', fontSize: 10 }}
        title={`Клоакинг: ${typeLabel}${checkedAt ? `\nПроверен: ${new Date(checkedAt).toLocaleDateString('ru-RU')}` : ''}`}
      >
        <EyeOff className="w-2.5 h-2.5" />
        Cloak
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.15)', fontSize: 10 }}
      title={checkedAt ? `Проверен: ${new Date(checkedAt).toLocaleDateString('ru-RU')}` : undefined}
    >
      OK
    </span>
  );
}

function ScoreBadge({ score, safeScore, contentScore, pagespeed }: { score: number | null; safeScore?: number | null; contentScore?: number | null; pagespeed?: number | null }) {
  if (score == null) return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>-</span>;
  const color = score >= 70 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171';
  const parts = [
    safeScore != null ? `Safe Page: ${Math.round(safeScore)}` : null,
    contentScore != null ? `Content: ${Math.round(contentScore)}` : null,
    pagespeed != null ? `PageSpeed: ${Math.round(pagespeed)}` : null,
  ].filter(Boolean);
  const tooltip = parts.length > 0 ? parts.join('\n') : undefined;
  return (
    <span className="text-xs font-mono font-semibold cursor-help" style={{ color }} title={tooltip}>
      {Math.round(score)}
    </span>
  );
}
