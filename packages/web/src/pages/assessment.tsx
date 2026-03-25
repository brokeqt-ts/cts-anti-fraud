import { useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Info, Ban, Loader2 } from 'lucide-react';
import {
  assessRisk,
  ApiError,
  type AssessmentRequest,
  type AssessmentResult,
} from '../api.js';
import { BlurFade, NumberTicker } from '../components/ui/animations.js';

const VERTICALS = [
  { value: '', label: 'Не выбрано' },
  { value: 'nutra', label: 'Nutra (нутра)' },
  { value: 'gambling', label: 'Gambling (гемблинг)' },
  { value: 'finance', label: 'Finance (финансы)' },
  { value: 'ecom', label: 'Ecom (товарка)' },
  { value: 'crypto', label: 'Crypto (крипто)' },
  { value: 'dating', label: 'Dating (дейтинг)' },
  { value: 'sweepstakes', label: 'Sweepstakes (свипы)' },
  { value: 'other', label: 'Other (другое)' },
];

const GEO_OPTIONS = [
  '', 'US', 'CA', 'GB', 'DE', 'FR', 'AU', 'IT', 'ES', 'NL', 'PL',
  'BR', 'MX', 'AR', 'CL', 'CO',
  'JP', 'KR', 'IN', 'TH', 'VN', 'ID', 'PH',
  'RU', 'UA', 'KZ', 'BY',
  'TR', 'SA', 'AE', 'EG', 'ZA', 'NG',
];

function riskColor(score: number): string {
  if (score <= 30) return '#4ade80';
  if (score <= 60) return '#fbbf24';
  if (score <= 80) return '#fb923c';
  return '#f87171';
}

function riskLabel(level: string): string {
  const labels: Record<string, string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критический',
  };
  return labels[level] ?? level;
}

export function AssessmentPage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<AssessmentRequest>({
    domain: searchParams.get('domain') ?? '',
    account_google_id: searchParams.get('account') ?? '',
    bin: '',
    vertical: '',
    geo: '',
  });
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    const req: AssessmentRequest = {};
    if (form.domain?.trim()) req.domain = form.domain.trim();
    if (form.account_google_id?.trim()) req.account_google_id = form.account_google_id.trim();
    if (form.bin?.trim()) req.bin = form.bin.trim();
    if (form.vertical) req.vertical = form.vertical;
    if (form.geo) req.geo = form.geo;

    if (!req.domain && !req.account_google_id && !req.bin && !req.vertical && !req.geo) {
      setError('Укажите хотя бы один параметр');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await assessRisk(req);
      setResult(res);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Ошибка запроса');
      }
    } finally {
      setLoading(false);
    }
  }, [form]);

  const update = (field: keyof AssessmentRequest, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="py-5 px-6 space-y-6">
      <BlurFade>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          <ShieldCheck className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
          Оценка рисков
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Предварительная оценка риска бана перед запуском
        </p>
      </BlurFade>

      {/* Section A: Input Form */}
      <BlurFade delay={0.05}>
        <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormField label="Домен" placeholder="example.com" value={form.domain ?? ''} onChange={(v) => update('domain', v)} />
            <FormField label="Google Account ID" placeholder="7973813934" value={form.account_google_id ?? ''} onChange={(v) => update('account_google_id', v)} />
            <FormField label="BIN (6 цифр)" placeholder="411111" value={form.bin ?? ''} onChange={(v) => update('bin', v.replace(/\D/g, '').slice(0, 6))} />

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Вертикаль</label>
              <select
                value={form.vertical ?? ''}
                onChange={(e) => update('vertical', e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              >
                {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Целевой GEO</label>
              <select
                value={form.geo ?? ''}
                onChange={(e) => update('geo', e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
              >
                <option value="">Не выбрано</option>
                {GEO_OPTIONS.filter(Boolean).map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-ghost-green flex items-center gap-2 text-sm font-medium"
              style={{ padding: '8px 20px', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {loading ? 'Оценка...' : 'Оценить риск'}
            </button>
            {error && (
              <span className="text-xs" style={{ color: '#f87171' }}>{error}</span>
            )}
          </div>
        </div>
      </BlurFade>

      {/* Results */}
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Section B: Risk Score + Factors */}
          <div className="lg:col-span-2 space-y-4">
            <BlurFade delay={0.1}>
              <RiskGauge score={result.risk_score} level={result.risk_level} />
            </BlurFade>

            <BlurFade delay={0.15}>
              <FactorBreakdown factors={result.factors} />
            </BlurFade>

            {result.recommendations.length > 0 && (
              <BlurFade delay={0.25}>
                <RulesTriggered recommendations={result.recommendations} />
              </BlurFade>
            )}
          </div>

          {/* Section C: Context Panel */}
          <div className="space-y-4">
            <BlurFade delay={0.2}>
              <ComparableAccounts data={result.comparable_accounts} />
            </BlurFade>

            {result.budget_recommendation != null && (
              <BlurFade delay={0.25}>
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                  <h3 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Рекомендация по бюджету</h3>
                  <div className="text-lg font-bold font-mono" style={{ color: '#60a5fa' }}>
                    ${result.budget_recommendation}/день
                  </div>
                </div>
              </BlurFade>
            )}

            {form.domain && (
              <BlurFade delay={0.3}>
                <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                  <h3 className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Быстрые действия</h3>
                  <div className="space-y-2">
                    <Link to="/domains" className="block text-xs transition-colors hover:underline" style={{ color: 'var(--accent-green)' }}>
                      Посмотреть домен в деталях
                    </Link>
                    <Link to="/analytics" className="block text-xs transition-colors hover:underline" style={{ color: 'var(--accent-green)' }}>
                      Найти альтернативный BIN
                    </Link>
                    {form.account_google_id && (
                      <Link to={`/accounts/${form.account_google_id}`} className="block text-xs transition-colors hover:underline" style={{ color: 'var(--accent-green)' }}>
                        Детали аккаунта
                      </Link>
                    )}
                  </div>
                </div>
              </BlurFade>
            )}
          </div>
        </div>
      )}

      {/* Empty state — before first assessment */}
      {!result && !loading && !error && (
        <BlurFade delay={0.1}>
          <div className="rounded-xl py-16 flex flex-col items-center justify-center gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <ShieldCheck className="w-8 h-8" style={{ color: 'var(--border-hover)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Заполните параметры и нажмите «Оценить риск»
            </p>
            <p className="text-xs" style={{ color: 'var(--text-ghost)' }}>
              14 правил анализа · 5 факторов · Экспертная система
            </p>
          </div>
        </BlurFade>
      )}
    </div>
  );
}

/* ── Form Field ── */

function FormField({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg text-sm"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)' }}
      />
    </div>
  );
}

/* ── Risk Gauge (SVG semicircle) ── */

function RiskGauge({ score, level }: { score: number; level: string }) {
  const color = riskColor(score);
  const radius = 80;
  const circumference = Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="rounded-xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-8">
        <div className="flex-shrink-0">
          <svg width="200" height="120" viewBox="0 0 200 120">
            {/* Background arc */}
            <path
              d="M 10 110 A 80 80 0 0 1 190 110"
              fill="none"
              stroke="var(--bg-hover)"
              strokeWidth="12"
              strokeLinecap="round"
            />
            {/* Progress arc */}
            <path
              d="M 10 110 A 80 80 0 0 1 190 110"
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${progress} ${circumference}`}
              style={{ filter: `drop-shadow(0 0 6px ${color}40)`, transition: 'stroke-dasharray 0.8s ease-out' }}
            />
            {/* Score text */}
            <text x="100" y="95" textAnchor="middle" style={{ fontSize: 36, fontWeight: 700, fill: color, fontFamily: 'monospace' }}>
              <NumberTicker value={score} />
            </text>
            <text x="100" y="75" textAnchor="middle" style={{ fontSize: 36, fontWeight: 700, fill: color, fontFamily: 'monospace' }}>
              {score}
            </text>
          </svg>
        </div>
        <div>
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Уровень риска</div>
          <div className="text-2xl font-bold" style={{ color }}>{riskLabel(level)}</div>
          <div className="text-xs mt-2" style={{ color: 'var(--text-ghost)' }}>
            {score <= 30 && 'Можно запускать. Следите за сигналами.'}
            {score > 30 && score <= 60 && 'Умеренный риск. Рекомендуем проверить домен и BIN.'}
            {score > 60 && score <= 80 && 'Высокий риск бана. Пересмотрите настройки.'}
            {score > 80 && 'Критический риск. Запуск не рекомендуется.'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Factor Breakdown ── */

const FACTOR_LABELS: Record<string, string> = {
  domain_age: 'Возраст домена',
  domain: 'Домен',
  bin_ban_rate: 'BIN ban rate',
  bin: 'BIN',
  account_age: 'Возраст аккаунта',
  account: 'Аккаунт',
  vertical_risk: 'Риск вертикали',
  vertical: 'Вертикаль',
  geo_risk: 'Риск GEO',
  geo: 'GEO',
};

function FactorBreakdown({ factors }: { factors: AssessmentResult['factors'] }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Факторы риска</h3>
      <div className="space-y-3">
        {factors.map((f) => {
          const color = riskColor(f.score);
          return (
            <div key={f.category}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {FACTOR_LABELS[f.category] ?? f.category}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color }}>
                    {f.score}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-ghost)' }}>
                    ×{f.weight}
                  </span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(f.score, 2)}%`, background: color, transition: 'width 0.6s ease-out' }}
                />
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-ghost)' }}>{f.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Rules Triggered / Recommendations ── */

function RulesTriggered({ recommendations }: { recommendations: string[] }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Рекомендации и предупреждения</h3>
      <div className="space-y-2">
        {recommendations.map((r, i) => {
          const isBlock = r.includes('\u26d4') || r.toLowerCase().includes('block');
          const isWarning = r.includes('\u26a0') || r.toLowerCase().includes('warn');
          const bg = isBlock ? 'rgba(239,68,68,0.06)' : isWarning ? 'rgba(251,191,36,0.06)' : 'rgba(59,130,246,0.06)';
          const border = isBlock ? 'rgba(239,68,68,0.15)' : isWarning ? 'rgba(251,191,36,0.15)' : 'rgba(59,130,246,0.15)';
          const iconColor = isBlock ? '#f87171' : isWarning ? '#fbbf24' : '#60a5fa';
          const Icon = isBlock ? Ban : isWarning ? AlertTriangle : Info;

          return (
            <div key={i} className="rounded-lg p-3 flex items-start gap-2" style={{ background: bg, border: `1px solid ${border}` }}>
              <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: iconColor }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Comparable Accounts ── */

function ComparableAccounts({ data }: { data: AssessmentResult['comparable_accounts'] }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
      <h3 className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Похожие аккаунты</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Похожих аккаунтов</span>
          <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{data.total}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Из них забанено</span>
          <span className="text-sm font-bold font-mono" style={{ color: data.banned > 0 ? '#f87171' : 'var(--text-primary)' }}>{data.banned}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Ban rate</span>
          <span className="text-sm font-bold font-mono" style={{ color: data.ban_rate > 50 ? '#f87171' : data.ban_rate > 25 ? '#fbbf24' : '#4ade80' }}>{data.ban_rate}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Средний срок жизни</span>
          <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{data.avg_lifetime_days}д</span>
        </div>
      </div>
    </div>
  );
}
