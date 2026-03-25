import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Eye } from 'lucide-react';
import { motion } from 'framer-motion';
import { createBan, timeAgo } from '../api.js';
import { VerticalBadge, TargetBadge } from '../components/badge.js';
import { StaggerContainer, StaggerItem, BlurFade } from '../components/ui/animations.js';

const VERTICALS = ['gambling', 'nutra', 'crypto', 'dating', 'sweepstakes', 'ecom', 'finance', 'other'];
const TARGETS = ['account', 'domain', 'campaign', 'ad'];
const CAMPAIGN_TYPES = ['pmax', 'search', 'display', 'video', 'shopping', 'other'];

const COMMON_REASONS = [
  'Circumventing systems',
  'Misrepresentation',
  'Malicious software',
  'Unacceptable business practices',
  'Healthcare violations',
  'Counterfeit goods',
];

export function BanFormPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillAccount = searchParams.get('account') ?? '';

  const [form, setForm] = useState({
    account_google_id: prefillAccount,
    ban_date: new Date().toISOString().split('T')[0]!,
    ban_target: 'account',
    ban_reason_google: '',
    ban_reason_internal: '',
    offer_vertical: '',
    domain: '',
    campaign_type: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const isValid = form.account_google_id.length > 0;

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload: Record<string, string> = {
      account_google_id: form.account_google_id,
      ban_date: form.ban_date,
      ban_target: form.ban_target,
    };
    if (form.ban_reason_google) payload['ban_reason_google'] = form.ban_reason_google;
    if (form.ban_reason_internal) payload['ban_reason_internal'] = form.ban_reason_internal;
    if (form.offer_vertical) payload['offer_vertical'] = form.offer_vertical;
    if (form.domain) payload['domain'] = form.domain;
    if (form.campaign_type) payload['campaign_type'] = form.campaign_type;

    try {
      const result = await createBan(payload);
      navigate(`/bans/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать бан');
      setSubmitting(false);
    }
  }

  return (
    <div className="py-5 px-6 max-w-2xl">
      <BlurFade>
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
          Записать бан
        </h1>
      </BlurFade>

      {error && (
        <BlurFade>
          <div className="p-4 text-sm mt-6" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 10, color: '#f87171' }}>
            {error}
          </div>
        </BlurFade>
      )}

      <form onSubmit={handleSubmit}>
        <StaggerContainer className="card-static p-[12px_14px] mt-1.5 space-y-1.5" staggerDelay={0.06}>
          <StaggerItem>
            <FormField label="Google ID аккаунта *">
              <input
                type="text"
                required
                value={form.account_google_id}
                onChange={(e) => updateField('account_google_id', e.target.value)}
                placeholder="напр. 3851655493"
                className="input-field font-mono"
              />
            </FormField>
          </StaggerItem>

          <StaggerItem>
            <div className="grid grid-cols-2 gap-1.5">
              <FormField label="Дата бана *">
                <input
                  type="date"
                  required
                  value={form.ban_date}
                  onChange={(e) => updateField('ban_date', e.target.value)}
                  className="input-field"
                />
              </FormField>
              <FormField label="Цель бана *">
                <select
                  value={form.ban_target}
                  onChange={(e) => updateField('ban_target', e.target.value)}
                  className="input-field"
                >
                  {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
          </StaggerItem>

          <StaggerItem>
            <FormField label="Вертикаль оффера">
              <div className="flex flex-wrap gap-2">
                <VerticalPill active={!form.offer_vertical} onClick={() => updateField('offer_vertical', '')}>
                  Нет
                </VerticalPill>
                {VERTICALS.map((v) => (
                  <VerticalPill key={v} active={form.offer_vertical === v} onClick={() => updateField('offer_vertical', v)}>
                    {v}
                  </VerticalPill>
                ))}
              </div>
            </FormField>
          </StaggerItem>

          <StaggerItem>
            <FormField label="Причина от Google">
              {/* Быстрый выбор причин */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {COMMON_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => updateField('ban_reason_google', reason)}
                    className="px-2.5 py-1 rounded-md text-xs transition-all duration-150"
                    style={{
                      background: form.ban_reason_google === reason ? 'rgba(239,68,68,0.1)' : 'var(--bg-card)',
                      color: form.ban_reason_google === reason ? '#f87171' : 'var(--text-muted)',
                      border: form.ban_reason_google === reason ? '1px solid rgba(239,68,68,0.2)' : '1px solid var(--border-subtle)',
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={form.ban_reason_google}
                onChange={(e) => updateField('ban_reason_google', e.target.value)}
                placeholder="Или введите свою причину..."
                className="input-field"
              />
            </FormField>
          </StaggerItem>

          <StaggerItem>
            <FormField label="Внутренние заметки">
              <textarea
                value={form.ban_reason_internal}
                onChange={(e) => updateField('ban_reason_internal', e.target.value)}
                placeholder="Ваш анализ / заметки"
                rows={3}
                className="input-field resize-none"
              />
            </FormField>
          </StaggerItem>

          <StaggerItem>
            <div className="grid grid-cols-2 gap-1.5">
              <FormField label="Домен">
                <input
                  type="text"
                  value={form.domain}
                  onChange={(e) => updateField('domain', e.target.value)}
                  placeholder="example.com"
                  className="input-field"
                />
              </FormField>
              <FormField label="Тип кампании">
                <select
                  value={form.campaign_type}
                  onChange={(e) => updateField('campaign_type', e.target.value)}
                  className="input-field"
                >
                  <option value="">-</option>
                  {CAMPAIGN_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
                </select>
              </FormField>
            </div>
          </StaggerItem>

          {/* Переключатель превью */}
          <StaggerItem>
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 text-xs transition-colors"
              style={{ color: showPreview ? 'var(--text-secondary)' : 'var(--text-muted)' }}
            >
              <Eye className="w-3.5 h-3.5" />
              {showPreview ? 'Скрыть превью' : 'Предпросмотр записи'}
            </button>
          </StaggerItem>

          {/* Карточка превью */}
          {showPreview && (
            <StaggerItem>
              <div className="p-4 rounded-xl" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Превью</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Аккаунт</span>
                    <p className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{form.account_google_id || '-'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Дата</span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{form.ban_date ? timeAgo(new Date(form.ban_date).toISOString()) : '-'}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Цель</span>
                    <div className="mt-0.5"><TargetBadge target={form.ban_target} /></div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Вертикаль</span>
                    <div className="mt-0.5"><VerticalBadge vertical={form.offer_vertical || null} /></div>
                  </div>
                </div>
                {form.ban_reason_google && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--bg-hover)' }}>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Причина Google</span>
                    <p className="text-xs mt-0.5" style={{ color: '#f87171' }}>{form.ban_reason_google}</p>
                  </div>
                )}
                {form.domain && (
                  <div className="mt-2">
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Домен</span>
                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{form.domain}</p>
                  </div>
                )}
                {form.ban_reason_internal && (
                  <div className="mt-2">
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Заметки</span>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{form.ban_reason_internal}</p>
                  </div>
                )}
              </div>
            </StaggerItem>
          )}

          <StaggerItem>
            <div className="flex items-center gap-3 pt-2">
              <motion.button
                type="submit"
                disabled={submitting}
                className="btn-ghost-green flex-1 py-2.5 disabled:opacity-50"
                animate={isValid && !submitting ? { scale: [1, 1.01, 1] } : {}}
                transition={isValid && !submitting ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : {}}
              >
                {submitting ? 'Сохранение...' : 'Записать бан'}
              </motion.button>
              <Link
                to="/bans"
                className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
              >
                Отмена
              </Link>
            </div>
          </StaggerItem>
        </StaggerContainer>
      </form>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block label-xs mb-2">{label}</label>
      {children}
    </div>
  );
}

function VerticalPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-xs font-medium"
      style={{
        background: active ? 'var(--border-medium)' : 'var(--bg-card)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border-focus)' : '1px solid var(--border-subtle)',
      }}
      whileTap={{ scale: 0.95 }}
      animate={active ? { scale: [1, 1.05, 1] } : {}}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.button>
  );
}
