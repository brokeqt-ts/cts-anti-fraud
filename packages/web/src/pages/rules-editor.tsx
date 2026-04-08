import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Plus, Pencil, Trash2, Loader2, AlertCircle, CheckCircle,
  ToggleLeft, ToggleRight, ChevronUp, ChevronDown, Lightbulb, X,
} from 'lucide-react';
import {
  fetchRules, createRule, updateRule, deleteRule, toggleRule, reorderRules,
  ApiError, type ExpertRule, type CreateRuleRequest,
} from '../api.js';
import { BlurFade, StaggerContainer, StaggerItem } from '../components/ui/animations.js';

// ─── Категории ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'bin',      label: 'BIN / Карта',   icon: '💳' },
  { value: 'domain',   label: 'Домен',          icon: '🌐' },
  { value: 'account',  label: 'Аккаунт',        icon: '👤' },
  { value: 'geo',      label: 'ГЕО',            icon: '🌍' },
  { value: 'vertical', label: 'Вертикаль',      icon: '📊' },
  { value: 'spend',    label: 'Бюджет',         icon: '💰' },
] as const;

type Category = typeof CATEGORIES[number]['value'];

function catInfo(c: string) { return CATEGORIES.find(x => x.value === c) ?? CATEGORIES[0]; }

// ─── Метрики ──────────────────────────────────────────────────────────────────

interface MetricOption {
  field: string;
  label: string;
  unit?: string;
  type: 'number' | 'tags' | 'boolean';
  defaultValue: string;
  directions?: { operator: string; label: string }[];
  describe: (op: string, val: string) => string;
  suggest: (op: string, val: string) => { name: string; message: string };
}

const METRICS: Record<string, MetricOption[]> = {
  bin: [
    {
      field: 'binBanRate',
      label: 'Ban rate по BIN',
      unit: '%',
      type: 'number',
      defaultValue: '50',
      directions: [{ operator: '>', label: 'больше' }],
      describe: (_op, val) => `Ban rate по BIN больше ${val}%`,
      suggest: (_op, val) => ({
        name: `BIN ban rate > ${val}%`,
        message: `BIN {bin} имеет повышенный ban rate {binBanRate}% — рассмотрите альтернативу`,
      }),
    },
    {
      field: 'bin',
      label: 'BIN входит в список рискованных',
      type: 'tags',
      defaultValue: '404038, 431274',
      directions: [{ operator: 'starts_with_any', label: 'входит в список' }],
      describe: (_op, val) => `BIN начинается с одного из: ${val}`,
      suggest: (_op, _val) => ({
        name: `Рискованные BIN префиксы`,
        message: `BIN {bin} входит в список рискованных (виртуальные/предоплаченные карты)`,
      }),
    },
  ],
  domain: [
    {
      field: 'domainAgeDays',
      label: 'Возраст домена',
      unit: 'дней',
      type: 'number',
      defaultValue: '14',
      directions: [{ operator: '<', label: 'меньше' }],
      describe: (_op, val) => `Возраст домена меньше ${val} дней`,
      suggest: (_op, val) => ({
        name: `Домен моложе ${val} дней`,
        message: `Домен слишком молодой ({domainAgeDays} дн.) — проверьте вертикальный минимум`,
      }),
    },
    {
      field: 'domainSafePageScore',
      label: 'Safe Page Score',
      unit: '/100',
      type: 'number',
      defaultValue: '40',
      directions: [{ operator: '<', label: 'меньше' }],
      describe: (_op, val) => `Safe Page Score меньше ${val}`,
      suggest: (_op, val) => ({
        name: `Safe Page Score < ${val}`,
        message: `Низкий Safe Page Score домена ({domainSafePageScore}/100) — высокий риск бана`,
      }),
    },
  ],
  account: [
    {
      field: 'accountAgeDays',
      label: 'Возраст аккаунта',
      unit: 'дней',
      type: 'number',
      defaultValue: '7',
      directions: [{ operator: '<', label: 'меньше' }],
      describe: (_op, val) => `Возраст аккаунта меньше ${val} дней`,
      suggest: (_op, val) => ({
        name: `Аккаунт моложе ${val} дней`,
        message: `Аккаунт очень молодой ({accountAgeDays} дн.) — высокий риск мгновенного бана`,
      }),
    },
    {
      field: 'accountHasActiveViolations',
      label: 'Активные нарушения политики',
      type: 'boolean',
      defaultValue: 'true',
      directions: [{ operator: '==', label: 'есть' }],
      describe: (_op, val) => val === 'true' ? 'На аккаунте есть активные нарушения' : 'На аккаунте нет нарушений',
      suggest: (_op, _val) => ({
        name: 'Активные нарушения политики',
        message: 'Аккаунт имеет активные нарушения политики — запуск заблокирован',
      }),
    },
  ],
  geo: [
    {
      field: 'geoBanRate',
      label: 'Ban rate по ГЕО',
      unit: '%',
      type: 'number',
      defaultValue: '40',
      directions: [{ operator: '>', label: 'больше' }],
      describe: (_op, val) => `Ban rate по ГЕО больше ${val}%`,
      suggest: (_op, val) => ({
        name: `ГЕО ban rate > ${val}%`,
        message: `Гео {geo} имеет повышенный процент банов {geoBanRate}%`,
      }),
    },
  ],
  vertical: [
    {
      field: 'verticalBanRate',
      label: 'Ban rate по вертикали',
      unit: '%',
      type: 'number',
      defaultValue: '50',
      directions: [{ operator: '>', label: 'больше' }],
      describe: (_op, val) => `Ban rate по вертикали больше ${val}%`,
      suggest: (_op, val) => ({
        name: `Вертикаль ban rate > ${val}%`,
        message: `Вертикаль {vertical} имеет процент банов {verticalBanRate}% — будьте осторожны`,
      }),
    },
  ],
  spend: [
    {
      field: 'accountAgeDays',
      label: 'Возраст аккаунта',
      unit: 'дней',
      type: 'number',
      defaultValue: '7',
      directions: [{ operator: '<', label: 'меньше' }],
      describe: (_op, val) => `Возраст аккаунта меньше ${val} дней`,
      suggest: (_op, val) => ({
        name: `Рекомендация бюджета (аккаунт < ${val} дней)`,
        message: `Рекомендуемый бюджет: не более $30/день (аккаунт моложе ${val} дней)`,
      }),
    },
  ],
};

// ─── Friendly condition description ──────────────────────────────────────────

function friendlyDescribeCondition(condition: unknown): string {
  try {
    const c = condition as Record<string, unknown>;
    if (c.logic) {
      const parts = (c.conditions as unknown[]).map(sub => friendlyDescribeCondition(sub));
      const sep = c.logic === 'AND' ? ' и ' : ' или ';
      return parts.join(sep);
    }
    const field = String(c.field ?? '');
    const op = String(c.operator ?? '');
    const val = c.value;

    // Find metric config for friendly description
    for (const metrics of Object.values(METRICS)) {
      const m = metrics.find(x => x.field === field);
      if (m) {
        const v = Array.isArray(val) ? (val as string[]).join(', ') : String(val ?? '');
        return m.describe(op, v);
      }
    }

    // Fallback
    const v = Array.isArray(val) ? `[${(val as unknown[]).join(', ')}]` : String(val ?? '');
    const opLabel = { '>': 'больше', '<': 'меньше', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠' }[op] ?? op;
    return `${field} ${opLabel} ${v}`;
  } catch {
    return 'условие не задано';
  }
}

// ─── Form state ───────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  category: Category;
  metricField: string;
  operator: string;
  value: string;         // For number / boolean
  tags: string[];        // For tags type
  messageTemplate: string;
  priority: number;
}

function getDefaultMetric(cat: Category): MetricOption {
  return METRICS[cat]?.[0] ?? METRICS.bin[0];
}

function makeDefaultState(cat: Category = 'bin'): FormState {
  const m = getDefaultMetric(cat);
  return {
    name: '',
    category: cat,
    metricField: m.field,
    operator: m.directions?.[0]?.operator ?? '>',
    value: m.defaultValue,
    tags: m.type === 'tags' ? m.defaultValue.split(',').map(s => s.trim()) : [],
    messageTemplate: '',
    priority: 0,
  };
}

function stateToApiCondition(s: FormState): unknown {
  const m = METRICS[s.category]?.find(x => x.field === s.metricField);
  if (!m) return { field: s.metricField, operator: s.operator, value: s.value };

  if (m.type === 'tags') {
    return { field: m.field, operator: 'starts_with_any', value: s.tags };
  }
  if (m.type === 'boolean') {
    return { field: m.field, operator: '==', value: s.value === 'true' };
  }
  return { field: m.field, operator: s.operator, value: Number(s.value) || 0 };
}

function ruleToFormState(rule: ExpertRule): FormState {
  const cat = rule.category as Category;
  const cond = rule.condition as Record<string, unknown>;
  const field = String(cond.field ?? '');
  const op = String(cond.operator ?? '>');
  const val = cond.value;

  const m = METRICS[cat]?.find(x => x.field === field) ?? getDefaultMetric(cat);

  let value = m.defaultValue;
  let tags: string[] = [];

  if (m.type === 'tags') {
    tags = Array.isArray(val) ? (val as string[]) : [];
    value = tags.join(', ');
  } else if (m.type === 'boolean') {
    value = val === true ? 'true' : 'false';
  } else {
    value = val != null ? String(val) : m.defaultValue;
  }

  return {
    name: rule.name,
    category: cat,
    metricField: field || m.field,
    operator: op,
    value,
    tags,
    messageTemplate: rule.message_template,
    priority: rule.priority,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const IS = { background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' };

// ─── RulesEditorPage ──────────────────────────────────────────────────────────

export function RulesEditorPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<ExpertRule[] | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [reordering, setReordering] = useState(false);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(makeDefaultState());
  const [tagInput, setTagInput] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchRules();
      setRules(data.rules);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
      setPageError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = (rules ?? []).filter(r => !filterCat || r.category === filterCat);

  // ── helpers ──

  function pf(patch: Partial<FormState>) { setForm(prev => ({ ...prev, ...patch })); }

  function setCategory(cat: Category) {
    const m = getDefaultMetric(cat);
    pf({ category: cat, metricField: m.field, operator: m.directions?.[0]?.operator ?? '>', value: m.defaultValue, tags: m.type === 'tags' ? m.defaultValue.split(',').map(s => s.trim()) : [] });
  }

  function setMetric(field: string) {
    const m = METRICS[form.category]?.find(x => x.field === field);
    if (!m) return;
    pf({ metricField: field, operator: m.directions?.[0]?.operator ?? '>', value: m.defaultValue, tags: [] });
  }

  function autoSuggest() {
    const m = METRICS[form.category]?.find(x => x.field === form.metricField);
    if (!m) return;
    const val = m.type === 'tags' ? form.tags.join(', ') : form.value;
    const { name, message } = m.suggest(form.operator, val);
    pf({ name: form.name || name, messageTemplate: message });
  }

  // Tags helpers
  function addTag(tag: string) {
    const t = tag.trim().replace(/\s/g, '');
    if (t && !form.tags.includes(t)) pf({ tags: [...form.tags, t] });
    setTagInput('');
  }
  function removeTag(t: string) { pf({ tags: form.tags.filter(x => x !== t) }); }

  // ── modal open/close ──

  function openCreate() {
    setEditingId(null);
    setForm(makeDefaultState());
    setTagInput('');
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(rule: ExpertRule) {
    setEditingId(rule.id);
    setForm(ruleToFormState(rule));
    setTagInput('');
    setFormError(null);
    setShowModal(true);
  }

  // ── submit ──

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      const payload: CreateRuleRequest = {
        name: form.name,
        category: form.category,
        condition: stateToApiCondition(form),
        message_template: form.messageTemplate,
        priority: form.priority,
      };
      if (editingId) {
        await updateRule(editingId, payload);
        setSuccess('Правило обновлено');
      } else {
        await createRule(payload);
        setSuccess('Правило создано');
      }
      setShowModal(false);
      await load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDelete(rule: ExpertRule) {
    if (!confirm(`Удалить правило "${rule.name}"?`)) return;
    try {
      await deleteRule(rule.id);
      setSuccess('Правило удалено');
      await load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) { setPageError(err instanceof Error ? err.message : 'Ошибка'); }
  }

  async function handleToggle(rule: ExpertRule) {
    try { await toggleRule(rule.id, !rule.is_active); await load(); }
    catch (err) { setPageError(err instanceof Error ? err.message : 'Ошибка'); }
  }

  async function handleMove(rule: ExpertRule, dir: 'up' | 'down') {
    if (!rules) return;
    const idx = rules.findIndex(r => r.id === rule.id);
    const ti = dir === 'up' ? idx - 1 : idx + 1;
    if (ti < 0 || ti >= rules.length) return;
    const next = [...rules];
    [next[idx], next[ti]] = [next[ti], next[idx]];
    setRules(next);
    setReordering(true);
    try {
      await reorderRules(next.map((r, i) => ({ id: r.id, priority: next.length - i })));
      await load();
    } catch { await load(); } finally { setReordering(false); }
  }

  // ── derived ──

  const currentMetrics = METRICS[form.category] ?? [];
  const currentMetric = currentMetrics.find(m => m.field === form.metricField) ?? currentMetrics[0];
  const currentDirections = currentMetric?.directions ?? [];

  // Live preview sentence
  function previewSentence(): string {
    if (!currentMetric) return '';
    const val = currentMetric.type === 'tags' ? form.tags.join(', ') : form.value;
    return currentMetric.describe(form.operator, val || '...');
  }

  // ── render ──

  return (
    <div className="py-5 px-6 space-y-4">
      <BlurFade>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Shield className="w-5 h-5" strokeWidth={1.5} />
              Правила оценки рисков
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Настройте, когда система должна предупреждать аналитика
            </p>
          </div>
          <button onClick={openCreate} className="btn-ghost-green px-3 py-1.5 text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Новое правило
          </button>
        </div>
      </BlurFade>

      {/* Toast messages */}
      {success && (
        <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg" style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}>
          <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {success}
        </div>
      )}
      {pageError && (
        <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {pageError}
        </div>
      )}

      {/* Category filter pills */}
      <div className="flex gap-2 flex-wrap">
        {['', ...CATEGORIES.map(c => c.value)].map(val => {
          const cat = CATEGORIES.find(c => c.value === val);
          const active = filterCat === val;
          return (
            <button
              key={val}
              onClick={() => setFilterCat(val)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: active ? 'var(--bg-hover)' : 'transparent',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                border: `1px solid ${active ? 'var(--border-medium)' : 'var(--border-subtle)'}`,
              }}
            >
              {cat ? `${cat.icon} ${cat.label}` : 'Все правила'}
            </button>
          );
        })}
      </div>

      {/* Stats */}
      {rules && (
        <div className="flex gap-5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Всего: <strong style={{ color: 'var(--text-primary)' }}>{rules.length}</strong></span>
          <span>Активных: <strong style={{ color: '#4ade80' }}>{rules.filter(r => r.is_active).length}</strong></span>
        </div>
      )}

      {/* Rule list */}
      {rules === null ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : (
        <StaggerContainer className="space-y-2" staggerDelay={0.03}>
          {filtered.map((rule, idx) => {
            const cat = catInfo(rule.category);
            return (
              <StaggerItem key={rule.id}>
                <div
                  className="rounded-xl transition-all"
                  style={{
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border-subtle)',
                    opacity: rule.is_active ? 1 : 0.45,
                  }}
                >
                  <div className="flex items-center gap-3 p-3">
                    {/* Priority arrows */}
                    <div className="flex flex-col items-center gap-0 shrink-0">
                      <button onClick={() => handleMove(rule, 'up')} disabled={reordering || idx === 0}
                        className="p-0.5 rounded hover:bg-white/5 disabled:opacity-20" style={{ color: 'var(--text-ghost)' }}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleMove(rule, 'down')} disabled={reordering || idx === filtered.length - 1}
                        className="p-0.5 rounded hover:bg-white/5 disabled:opacity-20" style={{ color: 'var(--text-ghost)' }}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Category icon */}
                    <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-lg"
                      style={{ background: 'var(--bg-hover)' }}>
                      {cat.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{rule.name}</span>
                      </div>
                      {/* Friendly condition */}
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                        Когда: {friendlyDescribeCondition(rule.condition)}
                      </p>
                      {/* Message preview */}
                      <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        "{rule.message_template}"
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleToggle(rule)} title={rule.is_active ? 'Выключить' : 'Включить'}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: rule.is_active ? '#4ade80' : 'var(--text-ghost)' }}>
                        {rule.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button onClick={() => openEdit(rule)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: 'var(--text-muted)' }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(rule)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: '#f87171' }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
              {filterCat ? 'В этой категории нет правил' : 'Правил пока нет — нажмите «Новое правило»'}
            </div>
          )}
        </StaggerContainer>
      )}

      {/* ── Modal ─────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }}
            onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4"
              style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingId ? 'Редактировать правило' : 'Создать правило'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-white/5"
                style={{ color: 'var(--text-muted)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-5">

              {/* ── Шаг 1: Категория ── */}
              <div>
                <div className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                    style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>1</span>
                  Что мониторим?
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setCategory(cat.value as Category)}
                      className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium transition-all"
                      style={{
                        background: form.category === cat.value ? 'rgba(96,165,250,0.12)' : 'var(--bg-hover)',
                        border: `1.5px solid ${form.category === cat.value ? 'rgba(96,165,250,0.4)' : 'var(--border-subtle)'}`,
                        color: form.category === cat.value ? '#60a5fa' : 'var(--text-secondary)',
                      }}
                    >
                      <span className="text-xl">{cat.icon}</span>
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Шаг 2: Условие ── */}
              <div>
                <div className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                    style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>2</span>
                  Условие
                </div>

                <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>

                  {/* Metric selector (if multiple options) */}
                  {currentMetrics.length > 1 && (
                    <div className="flex gap-2 flex-wrap">
                      {currentMetrics.map(m => (
                        <button
                          key={m.field}
                          type="button"
                          onClick={() => setMetric(m.field)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={{
                            background: form.metricField === m.field ? 'rgba(96,165,250,0.15)' : 'var(--bg-base)',
                            border: `1px solid ${form.metricField === m.field ? 'rgba(96,165,250,0.35)' : 'var(--border-subtle)'}`,
                            color: form.metricField === m.field ? '#60a5fa' : 'var(--text-secondary)',
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Boolean type */}
                  {currentMetric?.type === 'boolean' && (
                    <div className="flex gap-2">
                      {[{ val: 'true', label: '✅ Есть нарушения' }, { val: 'false', label: '❌ Нет нарушений' }].map(opt => (
                        <button key={opt.val} type="button"
                          onClick={() => pf({ value: opt.val })}
                          className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
                          style={{
                            background: form.value === opt.val ? 'rgba(96,165,250,0.12)' : 'var(--bg-base)',
                            border: `1.5px solid ${form.value === opt.val ? 'rgba(96,165,250,0.4)' : 'var(--border-subtle)'}`,
                            color: form.value === opt.val ? '#60a5fa' : 'var(--text-secondary)',
                          }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Tags type */}
                  {currentMetric?.type === 'tags' && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {form.tags.map(tag => (
                          <span key={tag} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-medium"
                            style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>
                            {tag}
                            <button type="button" onClick={() => removeTag(tag)} className="ml-0.5 opacity-60 hover:opacity-100">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={tagInput}
                          onChange={e => setTagInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
                          className="flex-1 px-3 py-2 rounded-lg text-sm font-mono"
                          style={IS}
                          placeholder="Введите BIN префикс (напр. 404038)"
                        />
                        <button type="button" onClick={() => addTag(tagInput)}
                          className="px-3 py-2 rounded-lg text-sm"
                          style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
                          + Добавить
                        </button>
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--text-ghost)' }}>
                        Нажмите Enter или кнопку «Добавить» после каждого префикса
                      </p>
                    </div>
                  )}

                  {/* Number type — direction pills + value input */}
                  {currentMetric?.type === 'number' && (
                    <div className="space-y-3">
                      {/* Direction buttons */}
                      {currentDirections.length > 1 && (
                        <div className="flex gap-2">
                          {currentDirections.map(d => (
                            <button key={d.operator} type="button"
                              onClick={() => pf({ operator: d.operator })}
                              className="flex-1 py-2 rounded-xl text-sm font-medium transition-all"
                              style={{
                                background: form.operator === d.operator ? 'rgba(96,165,250,0.12)' : 'var(--bg-base)',
                                border: `1.5px solid ${form.operator === d.operator ? 'rgba(96,165,250,0.4)' : 'var(--border-subtle)'}`,
                                color: form.operator === d.operator ? '#60a5fa' : 'var(--text-secondary)',
                              }}>
                              {form.operator === d.operator ? '● ' : ''}{d.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Value + unit */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {currentMetric.label}
                        </span>
                        <span className="text-sm font-medium" style={{ color: '#60a5fa' }}>
                          {currentDirections.find(d => d.operator === form.operator)?.label ?? form.operator}
                        </span>
                        <input
                          type="number"
                          value={form.value}
                          onChange={e => pf({ value: e.target.value })}
                          className="w-24 px-3 py-1.5 rounded-lg text-sm text-center font-semibold"
                          style={{ ...IS, fontSize: '1rem' }}
                        />
                        {currentMetric.unit && (
                          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{currentMetric.unit}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Preview sentence */}
                  <div className="pt-1">
                    <p className="text-xs px-3 py-2 rounded-lg italic"
                      style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                      <span style={{ color: 'var(--text-ghost)' }}>Условие: </span>
                      {previewSentence()}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Шаг 3: Сообщение ── */}
              <div>
                <div className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span className="w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                    style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>3</span>
                  Сообщение пользователю
                </div>
                <div className="space-y-2">
                  <textarea
                    required
                    value={form.messageTemplate}
                    onChange={e => pf({ messageTemplate: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-sm resize-none"
                    style={IS}
                    placeholder="Текст, который увидит аналитик при срабатывании правила..."
                  />
                  <button type="button" onClick={autoSuggest}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>
                    <Lightbulb className="w-3.5 h-3.5" />
                    Предложить сообщение автоматически
                  </button>
                </div>
              </div>

              {/* ── Название ── */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Название правила
                </label>
                <input
                  required
                  value={form.name}
                  onChange={e => pf({ name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl text-sm"
                  style={IS}
                  placeholder="Напр. «BIN ban rate > 80%»"
                />
              </div>

              {/* Error */}
              {formError && (
                <div className="flex items-center gap-2 text-xs p-2.5 rounded-lg"
                  style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={formLoading}
                  className="btn-ghost-green flex-1 py-2.5 flex items-center justify-center gap-2 text-sm font-medium rounded-xl">
                  {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingId ? 'Сохранить изменения' : 'Создать правило'}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm"
                  style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}>
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
