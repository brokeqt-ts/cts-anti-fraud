import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Globe, ExternalLink, ShieldAlert, CheckCircle, XCircle, AlertTriangle, Cloud, ShieldCheck, EyeOff, Search, Loader2, FileSearch } from 'lucide-react';
import { fetchDomains, fetchDomainDetail, scanDomainContent, ApiError, type DomainSummary, type DomainContentAnalysis } from '../api.js';
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

  // Manual domain scan input
  const [manualDomain, setManualDomain] = useState('');

  // Content analysis modal
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<DomainContentAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  function openAnalysis(domain: string, scanImmediately = false) {
    setSelectedDomain(domain);
    setAnalysis(null);
    setAnalysisError(null);

    if (scanImmediately) {
      // For manual domain input — scan directly
      setAnalysisLoading(false);
      setScanning(true);
      scanDomainContent(domain)
        .then((res) => setAnalysis(res))
        .catch((e) => setAnalysisError(e instanceof Error ? e.message : 'Ошибка сканирования'))
        .finally(() => setScanning(false));
    } else {
      // For existing domains — try to load existing analysis first
      setAnalysisLoading(true);
      fetchDomainDetail(domain)
        .then((res) => setAnalysis(res.content_analysis))
        .catch((e) => setAnalysisError(e instanceof Error ? e.message : 'Ошибка'))
        .finally(() => setAnalysisLoading(false));
    }
  }

  async function runScan() {
    if (!selectedDomain) return;
    setScanning(true);
    setAnalysisError(null);
    try {
      const result = await scanDomainContent(selectedDomain);
      setAnalysis(result);
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : 'Ошибка сканирования');
    } finally {
      setScanning(false);
    }
  }

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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const d = manualDomain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
              if (d) openAnalysis(d, true);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              placeholder="example.com"
              value={manualDomain}
              onChange={(e) => setManualDomain(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm w-48"
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="w-3.5 h-3.5" />
              Анализ
            </button>
          </form>
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
                    <td className="px-3.5 py-[7px] text-right flex gap-1 justify-end">
                      <button onClick={() => openAnalysis(d.domain)} className="p-1 rounded transition-colors hover:bg-white/5" style={{ color: 'var(--text-muted)' }} title="Content Analysis">
                        <FileSearch className="w-3.5 h-3.5" />
                      </button>
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

      {/* Content Analysis Modal */}
      {selectedDomain && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSelectedDomain(null)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <FileSearch className="w-4 h-4" /> Content Analysis: {selectedDomain}
              </h2>
              <button onClick={() => setSelectedDomain(null)} className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-muted)' }}>✕</button>
            </div>

            {analysisLoading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} /></div>}

            {analysisError && <div className="text-xs p-3 rounded-lg" style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)' }}>{analysisError}</div>}

            {!analysisLoading && !analysis && !analysisError && (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Анализ контента ещё не проводился для этого домена.</p>
                <button onClick={runScan} disabled={scanning} className="btn-ghost-green px-4 py-2 text-sm flex items-center gap-2 mx-auto">
                  {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {scanning ? 'Сканирование...' : 'Запустить анализ'}
                </button>
              </div>
            )}

            {analysis && (
              <div className="space-y-4">
                {/* Scores */}
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { label: 'Risk', value: analysis.content_risk_score, invert: true },
                    { label: 'Keywords', value: analysis.keyword_risk_score, invert: true },
                    { label: 'Compliance', value: analysis.compliance_score, invert: false },
                    { label: 'Structure', value: analysis.structure_risk_score, invert: true },
                    { label: 'Redirects', value: analysis.redirect_risk_score, invert: true },
                  ].map((s) => {
                    const v = s.value ?? 0;
                    const color = s.invert
                      ? (v >= 70 ? '#f87171' : v >= 40 ? '#fbbf24' : '#4ade80')
                      : (v >= 70 ? '#4ade80' : v >= 40 ? '#fbbf24' : '#f87171');
                    return (
                      <div key={s.label} className="text-center p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                        <div className="text-lg font-bold font-mono" style={{ color }}>{v}</div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                      </div>
                    );
                  })}
                </div>

                {analysis.detected_vertical && (
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Вертикаль: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analysis.detected_vertical}</span>
                  </div>
                )}

                {/* Compliance */}
                <div>
                  <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Compliance</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Privacy Policy', ok: analysis.has_privacy_policy },
                      { label: 'Terms of Service', ok: analysis.has_terms_of_service },
                      { label: 'Contact Info', ok: analysis.has_contact_info },
                      { label: 'Disclaimer', ok: analysis.has_disclaimer },
                      { label: 'About Page', ok: analysis.has_about_page },
                      { label: 'Cookie Consent', ok: analysis.has_cookie_consent },
                      { label: 'Age Verification', ok: analysis.has_age_verification },
                    ].map(({ label, ok }) => (
                      <span key={label} className="text-[11px] px-2 py-0.5 rounded-full" style={{
                        background: ok ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                        color: ok ? '#4ade80' : '#f87171',
                      }}>
                        {ok ? '✓' : '✗'} {label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Keywords */}
                {analysis.keyword_matches.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Grey Keywords ({analysis.keyword_matches.length})</div>
                    <div className="space-y-1">
                      {analysis.keyword_matches.slice(0, 15).map((m, i) => (
                        <div key={i} className="text-xs flex items-start gap-2 p-1.5 rounded" style={{ background: 'var(--bg-base)' }}>
                          <span className="shrink-0" style={{ color: m.severity === 'critical' ? '#f87171' : m.severity === 'warning' ? '#fbbf24' : '#60a5fa' }}>
                            {m.severity === 'critical' ? '●' : m.severity === 'warning' ? '●' : '●'}
                          </span>
                          <span style={{ color: 'var(--text-primary)' }}>
                            <b>{m.keyword}</b> <span style={{ color: 'var(--text-muted)' }}>({m.vertical})</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Red Flags */}
                {analysis.red_flags.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Red Flags ({analysis.red_flags.length})</div>
                    <div className="space-y-1">
                      {analysis.red_flags.map((f, i) => (
                        <div key={i} className="text-xs p-1.5 rounded" style={{
                          background: f.severity === 'critical' ? 'rgba(248,113,113,0.08)' : 'rgba(251,191,36,0.08)',
                          color: f.severity === 'critical' ? '#f87171' : '#fbbf24',
                        }}>
                          {f.detail}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Redirects */}
                {analysis.redirect_count > 1 && (
                  <div>
                    <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>Redirect Chain ({analysis.redirect_count})</div>
                    <div className="text-xs space-y-0.5 font-mono" style={{ color: 'var(--text-muted)' }}>
                      {analysis.redirect_chain.map((u, i) => <div key={i}>→ {u}</div>)}
                    </div>
                    {analysis.url_mismatch && <div className="text-xs mt-1" style={{ color: '#f87171' }}>⚠️ URL mismatch detected</div>}
                  </div>
                )}

                {/* Security & TLD */}
                <div className="grid grid-cols-2 gap-3">
                  {analysis.tld_risk && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>TLD Risk</div>
                      <span className="text-xs font-semibold" style={{ color: analysis.tld_risk.risk === 'high' ? '#f87171' : analysis.tld_risk.risk === 'medium' ? '#fbbf24' : '#4ade80' }}>
                        {analysis.tld_risk.tld} ({analysis.tld_risk.risk})
                      </span>
                    </div>
                  )}
                  {analysis.security_headers && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Security Headers</div>
                      <span className="text-xs font-mono font-semibold" style={{ color: analysis.security_headers.securityScore >= 50 ? '#4ade80' : analysis.security_headers.securityScore >= 25 ? '#fbbf24' : '#f87171' }}>
                        {analysis.security_headers.securityScore}/100
                      </span>
                      {analysis.security_headers.serverHeader && (
                        <span className="text-[10px] ml-2" style={{ color: 'var(--text-muted)' }}>{analysis.security_headers.serverHeader}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* robots.txt */}
                {analysis.robots_txt?.exists && (
                  <div className="text-xs space-y-1">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>robots.txt</div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.robots_txt.blocksGooglebot && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>Blocks Googlebot!</span>}
                      {analysis.robots_txt.hasSitemap && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>✓ Sitemap</span>}
                      {!analysis.robots_txt.blocksGooglebot && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>✓ Googlebot allowed</span>}
                    </div>
                  </div>
                )}

                {/* Third-party Scripts */}
                {analysis.third_party_scripts && (analysis.third_party_scripts.analytics.length > 0 || analysis.third_party_scripts.advertising.length > 0 || analysis.third_party_scripts.suspicious.length > 0) && (
                  <div className="text-xs space-y-1">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Third-party Scripts</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.third_party_scripts.analytics.map((s, i) => (
                        <span key={`a${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>{s}</span>
                      ))}
                      {analysis.third_party_scripts.advertising.map((s, i) => (
                        <span key={`ad${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>{s}</span>
                      ))}
                      {analysis.third_party_scripts.suspicious.map((s, i) => (
                        <span key={`s${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>⚠ {s}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Form Analysis */}
                {analysis.form_analysis && analysis.form_analysis.forms.length > 0 && (
                  <div className="text-xs space-y-1">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Forms ({analysis.form_analysis.forms.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {analysis.form_analysis.collectsPersonalData && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>Collects personal data</span>}
                      {analysis.form_analysis.collectsPaymentData && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>Collects payment data</span>}
                      {analysis.form_analysis.externalFormTargets.length > 0 && <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>External: {analysis.form_analysis.externalFormTargets.join(', ')}</span>}
                    </div>
                  </div>
                )}

                {/* Link Reputation */}
                {analysis.link_reputation && analysis.link_reputation.score > 0 && (
                  <div className="text-xs space-y-1">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Link Reputation Issues</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.link_reputation.affiliateLinks?.map((l, i) => (
                        <span key={`af${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>Affiliate: {l}</span>
                      ))}
                      {analysis.link_reputation.trackerLinks?.map((l, i) => (
                        <span key={`tr${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>Tracker: {l}</span>
                      ))}
                      {analysis.link_reputation.shortenerLinks?.map((l, i) => (
                        <span key={`sh${i}`} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>Shortener: {l}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Structured Data */}
                {analysis.structured_data?.hasJsonLd && (
                  <div className="text-xs space-y-1">
                    <div className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Structured Data (JSON-LD)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.structured_data.schemaTypes.map((t, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extended External APIs */}
                {(analysis as Record<string, unknown>).external_apis && (() => {
                  const ext = (analysis as Record<string, unknown>).external_apis as Record<string, unknown>;
                  const dns = ext.dnsAnalysis as { checked: boolean; hasSpf: boolean; hasDmarc: boolean; hasMx: boolean; mxRecords: string[] } | undefined;
                  const bl = ext.blocklists as { checked: boolean; lists: string[] } | undefined;
                  const crt = ext.crtSh as { checked: boolean; totalCerts: number; subdomains: string[] } | undefined;
                  const shd = ext.shodan as { checked: boolean; ports: number[]; vulns: string[] } | undefined;
                  const ipq = ext.ipqs as { checked: boolean; riskScore: number; malware: boolean; phishing: boolean; parking: boolean; category: string | null } | undefined;
                  const abuse = ext.abuseIpdb as { checked: boolean; abuseScore: number; totalReports: number } | undefined;
                  const uh = ext.urlhaus as { checked: boolean; isMalware: boolean } | undefined;
                  const pt = ext.phishTank as { checked: boolean; isPhishing: boolean } | undefined;
                  const wot = ext.wot as { checked: boolean; trustworthiness: number } | undefined;
                  const serp = ext.serpApi as { checked: boolean; indexed: boolean; totalResults: number } | undefined;
                  const oph = ext.openPhish as { checked: boolean; isPhishing: boolean } | undefined;
                  const cc = ext.commonCrawl as { checked: boolean; found: boolean; pages: number } | undefined;

                  return (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Extended Checks</div>
                      <div className="flex flex-wrap gap-1.5">
                        {dns?.checked && (
                          <>
                            <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: dns.hasSpf ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: dns.hasSpf ? '#4ade80' : '#f87171' }}>{dns.hasSpf ? '✓' : '✗'} SPF</span>
                            <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: dns.hasDmarc ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: dns.hasDmarc ? '#4ade80' : '#f87171' }}>{dns.hasDmarc ? '✓' : '✗'} DMARC</span>
                            <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: dns.hasMx ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)', color: dns.hasMx ? '#4ade80' : '#fbbf24' }}>{dns.hasMx ? '✓' : '✗'} MX</span>
                          </>
                        )}
                        {bl?.checked && bl.lists.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>🚫 Blocklist: {bl.lists.join(', ')}</span>
                        )}
                        {bl?.checked && bl.lists.length === 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>✓ Not blocklisted</span>
                        )}
                        {crt?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>🔐 {crt.totalCerts} certs · {crt.subdomains.length} subdomains</span>
                        )}
                        {shd?.checked && shd.ports.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: shd.vulns.length > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(96,165,250,0.1)', color: shd.vulns.length > 0 ? '#f87171' : '#60a5fa' }}>
                            Ports: {shd.ports.slice(0, 6).join(', ')}{shd.vulns.length > 0 ? ` · ${shd.vulns.length} vulns` : ''}
                          </span>
                        )}
                        {ipq?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: ipq.riskScore >= 75 ? 'rgba(248,113,113,0.1)' : ipq.riskScore >= 50 ? 'rgba(251,191,36,0.1)' : 'rgba(74,222,128,0.1)', color: ipq.riskScore >= 75 ? '#f87171' : ipq.riskScore >= 50 ? '#fbbf24' : '#4ade80' }}>
                            IPQS: {ipq.riskScore}/100{ipq.malware ? ' 🦠' : ''}{ipq.phishing ? ' 🎣' : ''}{ipq.parking ? ' 🅿️' : ''}
                          </span>
                        )}
                        {abuse?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: abuse.abuseScore > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)', color: abuse.abuseScore > 0 ? '#f87171' : '#4ade80' }}>
                            AbuseIPDB: {abuse.abuseScore}% ({abuse.totalReports} reports)
                          </span>
                        )}
                        {uh?.checked && uh.isMalware && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>🦠 URLhaus: malware</span>
                        )}
                        {pt?.checked && pt.isPhishing && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>🎣 PhishTank: phishing</span>
                        )}
                        {oph?.checked && oph.isPhishing && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>🎣 OpenPhish: phishing</span>
                        )}
                        {wot?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: wot.trustworthiness >= 60 ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: wot.trustworthiness >= 60 ? '#4ade80' : '#f87171' }}>
                            WOT: {wot.trustworthiness}/100
                          </span>
                        )}
                        {serp?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: serp.indexed ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', color: serp.indexed ? '#4ade80' : '#f87171' }}>
                            Google: {serp.indexed ? `✓ ${serp.totalResults} pages` : '✗ Not indexed'}
                          </span>
                        )}
                        {cc?.checked && (
                          <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ background: cc.found ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)', color: cc.found ? '#4ade80' : '#fbbf24' }}>
                            CommonCrawl: {cc.found ? `${cc.pages} pages` : 'not found'}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Built-in External APIs */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Safe Browsing */}
                  {analysis.safe_browsing?.checked && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Safe Browsing</div>
                      {analysis.safe_browsing.safe
                        ? <span className="text-xs font-semibold" style={{ color: '#4ade80' }}>✓ Safe</span>
                        : <span className="text-xs font-semibold" style={{ color: '#f87171' }}>⚠ {analysis.safe_browsing.threats.map(t => t.type).join(', ')}</span>
                      }
                    </div>
                  )}
                  {/* PageSpeed */}
                  {analysis.page_speed?.checked && analysis.page_speed.performanceScore != null && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>PageSpeed (mobile)</div>
                      <span className="text-xs font-mono font-semibold" style={{ color: analysis.page_speed.performanceScore >= 90 ? '#4ade80' : analysis.page_speed.performanceScore >= 50 ? '#fbbf24' : '#f87171' }}>
                        {analysis.page_speed.performanceScore}/100
                      </span>
                      {analysis.page_speed.largestContentfulPaint != null && (
                        <span className="text-[10px] ml-2" style={{ color: 'var(--text-muted)' }}>LCP: {(analysis.page_speed.largestContentfulPaint / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                  )}
                  {/* VirusTotal */}
                  {analysis.virus_total?.checked && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>VirusTotal</div>
                      {analysis.virus_total.malicious > 0
                        ? <span className="text-xs font-semibold" style={{ color: '#f87171' }}>{analysis.virus_total.malicious} malicious</span>
                        : analysis.virus_total.suspicious > 0
                          ? <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>{analysis.virus_total.suspicious} suspicious</span>
                          : <span className="text-xs font-semibold" style={{ color: '#4ade80' }}>✓ Clean</span>
                      }
                      {analysis.virus_total.categories.length > 0 && (
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{analysis.virus_total.categories.slice(0, 3).join(', ')}</div>
                      )}
                    </div>
                  )}
                  {/* Wayback */}
                  {analysis.wayback?.checked && analysis.wayback.hasHistory && (
                    <div className="p-2 rounded-lg" style={{ background: 'var(--bg-base)' }}>
                      <div className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Wayback Machine</div>
                      <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                        {analysis.wayback.domainAgeFromArchive != null ? `${Math.round(analysis.wayback.domainAgeFromArchive / 365 * 10) / 10}y` : '?'}
                      </span>
                      <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>
                        since {analysis.wayback.firstSnapshot} · {analysis.wayback.totalSnapshots} snapshots
                      </span>
                    </div>
                  )}
                </div>

                {/* SPA warning */}
                {analysis.word_count < 50 && (
                  <div className="text-xs p-2.5 rounded-lg flex items-start gap-2" style={{ background: 'rgba(96,165,250,0.08)', color: '#60a5fa' }}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Сайт использует JavaScript-рендеринг (SPA). Контент загружается динамически — результаты анализа статического HTML могут быть неполными.</span>
                  </div>
                )}

                {/* Page Metrics */}
                <div className="text-xs flex flex-wrap gap-3" style={{ color: 'var(--text-muted)' }}>
                  <span>{analysis.word_count} words</span>
                  <span>{analysis.total_links} links ({analysis.external_links} ext)</span>
                  <span>{analysis.form_count} forms</span>
                  <span>{analysis.script_count} scripts</span>
                  <span>{analysis.iframe_count} iframes</span>
                  {analysis.page_language && <span>Lang: {analysis.page_language}</span>}
                </div>

                {analysis.analyzed_at && (
                  <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
                    Analyzed: {new Date(analysis.analyzed_at).toLocaleString()}
                  </div>
                )}

                <button onClick={runScan} disabled={scanning} className="btn-ghost-green px-3 py-1.5 text-xs flex items-center gap-2">
                  {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  {scanning ? 'Сканирование...' : 'Пересканировать'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
