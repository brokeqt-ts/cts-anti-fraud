import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Pencil, Trash2, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { fetchBestPractices, createBestPractice, updateBestPractice, deleteBestPractice, ApiError, type BestPractice } from '../api.js';
import { BlurFade, StaggerContainer, StaggerItem } from '../components/ui/animations.js';

const CATEGORIES = [
  { value: '', label: 'Все' },
  { value: 'ban_prevention', label: 'Защита от бана' },
  { value: 'domain_selection', label: 'Выбор домена' },
  { value: 'budget_strategy', label: 'Стратегия бюджета' },
  { value: 'creative_guidelines', label: 'Креативы' },
  { value: 'campaign_setup', label: 'Настройка кампании' },
  { value: 'appeal_strategy', label: 'Апелляция' },
];

const VERTICALS = [
  { value: '', label: 'Все вертикали' },
  { value: 'gambling', label: 'Gambling' },
  { value: 'nutra', label: 'Nutra' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'dating', label: 'Dating' },
  { value: 'sweepstakes', label: 'Sweepstakes' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'finance', label: 'Finance' },
];

const CAMPAIGN_TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'pmax', label: 'PMax' },
  { value: 'search', label: 'Search' },
  { value: 'demand_gen', label: 'Demand Gen' },
  { value: 'display', label: 'Display' },
  { value: 'video', label: 'Video' },
];

export function BestPracticesPage() {
  const [practices, setPractices] = useState<BestPractice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterVertical, setFilterVertical] = useState('');
  const navigate = useNavigate();

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BestPractice | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState('ban_prevention');
  const [formVertical, setFormVertical] = useState('');
  const [formCampaignType, setFormCampaignType] = useState('');
  const [formPriority, setFormPriority] = useState(5);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    try {
      const params: Record<string, string> = {};
      if (filterCategory) params.category = filterCategory;
      if (filterVertical) params.vertical = filterVertical;
      const data = await fetchBestPractices(params);
      setPractices(data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, [filterCategory, filterVertical]);

  function openCreate() {
    setEditing(null);
    setFormTitle('');
    setFormContent('');
    setFormCategory('ban_prevention');
    setFormVertical('');
    setFormCampaignType('');
    setFormPriority(5);
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(bp: BestPractice) {
    setEditing(bp);
    setFormTitle(bp.title);
    setFormContent(bp.content);
    setFormCategory(bp.category);
    setFormVertical(bp.offer_vertical ?? '');
    setFormCampaignType(bp.campaign_type ?? '');
    setFormPriority(bp.priority);
    setFormError(null);
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      if (editing) {
        await updateBestPractice(editing.id, {
          title: formTitle, content: formContent, category: formCategory,
          offer_vertical: formVertical || null, campaign_type: formCampaignType || null,
          priority: formPriority,
        });
        setSuccess('Методичка обновлена');
      } else {
        await createBestPractice({
          title: formTitle, content: formContent, category: formCategory,
          offer_vertical: formVertical || undefined, campaign_type: formCampaignType || undefined,
          priority: formPriority,
        });
        setSuccess('Методичка создана');
      }
      setShowModal(false);
      await load();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(bp: BestPractice) {
    if (!confirm(`Удалить "${bp.title}"?`)) return;
    try {
      await deleteBestPractice(bp.id);
      setSuccess('Методичка удалена');
      await load();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  }

  const selectStyle = { background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' };

  return (
    <div className="py-5 px-6 space-y-4">
      <BlurFade>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <BookOpen className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
              Методички
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Best practices для AI-анализа и команды
            </p>
          </div>
          <button onClick={openCreate} className="btn-ghost-green px-3 py-1.5 text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Создать
          </button>
        </div>
      </BlurFade>

      {success && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}>
          <CheckCircle className="w-3.5 h-3.5" /> {success}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm" style={selectStyle}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={filterVertical} onChange={e => setFilterVertical(e.target.value)} className="px-3 py-1.5 rounded-lg text-sm" style={selectStyle}>
          {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </div>

      {error && <div className="text-xs p-3 rounded-lg" style={{ color: '#f87171', background: 'rgba(239,68,68,0.08)' }}>{error}</div>}

      {/* Cards */}
      <StaggerContainer className="grid gap-3" staggerDelay={0.04}>
        {practices?.map((bp) => (
          <StaggerItem key={bp.id}>
            <div className="p-4 rounded-xl space-y-2" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{bp.title}</h3>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>
                      {CATEGORIES.find(c => c.value === bp.category)?.label ?? bp.category}
                    </span>
                    {bp.offer_vertical && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24' }}>
                        {bp.offer_vertical}
                      </span>
                    )}
                    {bp.campaign_type && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>
                        {bp.campaign_type}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)' }}>
                      P{bp.priority}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(bp)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(bp)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {bp.content.length > 300 ? bp.content.slice(0, 300) + '...' : bp.content}
              </div>
              {bp.author_name && (
                <div className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>
                  {bp.author_name} · {new Date(bp.created_at).toLocaleDateString()}
                </div>
              )}
            </div>
          </StaggerItem>
        ))}
        {practices?.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
            Нет методичек. Нажмите "Создать" чтобы добавить.
          </div>
        )}
      </StaggerContainer>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl p-5" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              {editing ? 'Редактировать' : 'Создать'} методичку
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block label-xs mb-1">Название</label>
                <input required value={formTitle} onChange={e => setFormTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={selectStyle} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block label-xs mb-1">Категория</label>
                  <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={selectStyle}>
                    {CATEGORIES.filter(c => c.value).map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block label-xs mb-1">Вертикаль</label>
                  <select value={formVertical} onChange={e => setFormVertical(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={selectStyle}>
                    {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label || 'Общая'}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block label-xs mb-1">Приоритет</label>
                  <input type="number" min={0} max={10} value={formPriority} onChange={e => setFormPriority(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg text-sm" style={selectStyle} />
                </div>
              </div>
              <div>
                <label className="block label-xs mb-1">Тип кампании</label>
                <select value={formCampaignType} onChange={e => setFormCampaignType(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm" style={selectStyle}>
                  {CAMPAIGN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label || 'Все'}</option>)}
                </select>
              </div>
              <div>
                <label className="block label-xs mb-1">Содержимое (Markdown)</label>
                <textarea required value={formContent} onChange={e => setFormContent(e.target.value)} rows={10} className="w-full px-3 py-2 rounded-lg text-sm font-mono" style={selectStyle} placeholder="## Заголовок&#10;&#10;- Пункт 1&#10;- Пункт 2" />
              </div>

              {formError && <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}><AlertCircle className="w-3.5 h-3.5" /> {formError}</div>}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={formLoading} className="btn-ghost-green flex-1 py-2 flex items-center justify-center gap-2 text-sm">
                  {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? 'Сохранить' : 'Создать'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
