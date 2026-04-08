import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Plus, Pencil, Trash2, Loader2, AlertCircle, CheckCircle, ToggleLeft, ToggleRight, ChevronUp, ChevronDown } from 'lucide-react';
import {
  fetchRules,
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  reorderRules,
  ApiError,
  type ExpertRule,
  type CreateRuleRequest,
} from '../api.js';
import { BlurFade, StaggerContainer, StaggerItem } from '../components/ui/animations.js';

// ─── Стили ────────────────────────────────────────────────────────────────────

const inputStyle = {
  background: 'var(--bg-base)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-medium)',
};

// ─── Константы ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'bin', label: 'BIN карты' },
  { value: 'domain', label: 'Домен' },
  { value: 'account', label: 'Аккаунт' },
  { value: 'geo', label: 'ГЕО' },
  { value: 'vertical', label: 'Вертикаль' },
  { value: 'spend', label: 'Бюджет/Spend' },
];

const SEVERITIES = [
  { value: 'block', label: 'Блок', color: '#f87171', bg: 'rgba(239,68,68,0.1)' },
  { value: 'warning', label: 'Предупреждение', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  { value: 'info', label: 'Информация', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
];

const OPERATORS = [
  { value: '>', label: '> (больше)' },
  { value: '<', label: '< (меньше)' },
  { value: '>=', label: '>= (больше или равно)' },
  { value: '<=', label: '<= (меньше или равно)' },
  { value: '==', label: '== (равно)' },
  { value: '!=', label: '!= (не равно)' },
  { value: 'in', label: 'in (входит в список)' },
  { value: 'not_in', label: 'not_in (не входит в список)' },
  { value: 'contains', label: 'contains (содержит строку)' },
  { value: 'regex', label: 'regex (регулярное выражение)' },
  { value: 'starts_with_any', label: 'starts_with_any (начинается с одного из)' },
];

const FIELDS_BY_CATEGORY: Record<string, { value: string; label: string }[]> = {
  bin: [
    { value: 'bin', label: 'BIN (строка)' },
    { value: 'binBanRate', label: 'BIN ban rate (%)' },
  ],
  domain: [
    { value: 'domain', label: 'Домен (строка)' },
    { value: 'domainAgeDays', label: 'Возраст домена (дни)' },
    { value: 'domainSafePageScore', label: 'Safe Page Score (0-100)' },
  ],
  account: [
    { value: 'accountAgeDays', label: 'Возраст аккаунта (дни)' },
    { value: 'accountHasActiveViolations', label: 'Активные нарушения (true/false)' },
  ],
  geo: [
    { value: 'geo', label: 'ГЕО (код страны)' },
    { value: 'geoBanRate', label: 'Ban rate по ГЕО (%)' },
  ],
  vertical: [
    { value: 'vertical', label: 'Вертикаль (строка)' },
    { value: 'verticalBanRate', label: 'Ban rate по вертикали (%)' },
  ],
  spend: [
    { value: 'accountAgeDays', label: 'Возраст аккаунта (дни)' },
  ],
};

// ─── Вспомогательные функции ──────────────────────────────────────────────────

function severityInfo(s: string) {
  return SEVERITIES.find(x => x.value === s) ?? SEVERITIES[1];
}

function categoryLabel(c: string) {
  return CATEGORIES.find(x => x.value === c)?.label ?? c;
}

function previewCondition(condition: unknown, template: string): string {
  try {
    const c = condition as Record<string, unknown>;
    if (c.logic) {
      const logic = c.logic as string;
      const subs = (c.conditions as unknown[]).map(sub => previewCondition(sub, ''));
      return `(${subs.join(` ${logic} `)})`;
    }
    const field = String(c.field ?? '');
    const op = String(c.operator ?? '');
    const val = Array.isArray(c.value) ? `[${(c.value as unknown[]).join(', ')}]` : String(c.value ?? '');
    return `${field} ${op} ${val}`;
  } catch {
    return '(ошибка в условии)';
  }
}

function parseConditionValue(operator: string, raw: string): unknown {
  if (operator === 'starts_with_any' || operator === 'in' || operator === 'not_in') {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}

function conditionValueToString(operator: string, val: unknown): string {
  if (Array.isArray(val)) return val.join(', ');
  return String(val ?? '');
}

// ─── Дефолтные значения формы ─────────────────────────────────────────────────

interface SimpleFormCondition {
  type: 'simple';
  field: string;
  operator: string;
  value: string;
}

interface CompoundFormCondition {
  type: 'compound';
  logic: 'AND' | 'OR';
  conditions: SimpleFormCondition[];
}

type FormCondition = SimpleFormCondition | CompoundFormCondition;

const defaultSimple = (category: string): SimpleFormCondition => ({
  type: 'simple',
  field: FIELDS_BY_CATEGORY[category]?.[0]?.value ?? 'binBanRate',
  operator: '>',
  value: '50',
});

function conditionToForm(cond: unknown): FormCondition {
  try {
    const c = cond as Record<string, unknown>;
    if (c.logic) {
      return {
        type: 'compound',
        logic: c.logic as 'AND' | 'OR',
        conditions: (c.conditions as unknown[]).map(sub => {
          const s = sub as Record<string, unknown>;
          return {
            type: 'simple',
            field: String(s.field ?? ''),
            operator: String(s.operator ?? '>'),
            value: conditionValueToString(String(s.operator ?? '>'), s.value),
          };
        }),
      };
    }
    return {
      type: 'simple',
      field: String(c.field ?? ''),
      operator: String(c.operator ?? '>'),
      value: conditionValueToString(String(c.operator ?? '>'), c.value),
    };
  } catch {
    return defaultSimple('bin');
  }
}

function formConditionToApi(fc: FormCondition): unknown {
  if (fc.type === 'compound') {
    return {
      logic: fc.logic,
      conditions: fc.conditions.map(sub => ({
        field: sub.field,
        operator: sub.operator,
        value: parseConditionValue(sub.operator, sub.value),
      })),
    };
  }
  return {
    field: fc.field,
    operator: fc.operator,
    value: parseConditionValue(fc.operator, fc.value),
  };
}

// ─── Компонент конструктора условий ──────────────────────────────────────────

function ConditionBuilder({
  condition,
  category,
  onChange,
}: {
  condition: FormCondition;
  category: string;
  onChange: (c: FormCondition) => void;
}) {
  const fields = FIELDS_BY_CATEGORY[category] ?? [];

  function SimpleRow({
    cond,
    onRowChange,
    onRemove,
  }: {
    cond: SimpleFormCondition;
    onRowChange: (c: SimpleFormCondition) => void;
    onRemove?: () => void;
  }) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={cond.field}
          onChange={e => onRowChange({ ...cond, field: e.target.value })}
          className="flex-1 min-w-[140px] px-3 py-1.5 rounded-lg text-sm"
          style={inputStyle}
        >
          {fields.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select
          value={cond.operator}
          onChange={e => onRowChange({ ...cond, operator: e.target.value })}
          className="flex-1 min-w-[140px] px-3 py-1.5 rounded-lg text-sm"
          style={inputStyle}
        >
          {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          value={cond.value}
          onChange={e => onRowChange({ ...cond, value: e.target.value })}
          className="flex-1 min-w-[100px] px-3 py-1.5 rounded-lg text-sm"
          style={inputStyle}
          placeholder="значение"
        />
        {onRemove && (
          <button type="button" onClick={onRemove} className="p-1.5 rounded hover:bg-white/5" style={{ color: '#f87171' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  if (condition.type === 'simple') {
    return (
      <div className="space-y-2">
        <SimpleRow
          cond={condition}
          onRowChange={c => onChange(c)}
        />
        <button
          type="button"
          className="text-xs underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => onChange({
            type: 'compound',
            logic: 'AND',
            conditions: [condition, defaultSimple(category)],
          })}
        >
          + добавить составное условие (AND/OR)
        </button>
      </div>
    );
  }

  // Compound
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Логика:</span>
        <select
          value={condition.logic}
          onChange={e => onChange({ ...condition, logic: e.target.value as 'AND' | 'OR' })}
          className="px-2 py-1 rounded text-xs"
          style={inputStyle}
        >
          <option value="AND">AND (все условия)</option>
          <option value="OR">OR (любое условие)</option>
        </select>
        <button
          type="button"
          className="text-xs underline ml-auto"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => {
            if (condition.conditions.length === 1) {
              onChange(condition.conditions[0]);
            } else {
              onChange({ ...condition, conditions: condition.conditions.slice(0, -1) });
            }
          }}
        >
          упростить
        </button>
      </div>
      {condition.conditions.map((sub, i) => (
        <SimpleRow
          key={i}
          cond={sub}
          onRowChange={c => {
            const next = [...condition.conditions];
            next[i] = c;
            onChange({ ...condition, conditions: next });
          }}
          onRemove={condition.conditions.length > 1
            ? () => onChange({ ...condition, conditions: condition.conditions.filter((_, idx) => idx !== i) })
            : undefined}
        />
      ))}
      <button
        type="button"
        className="text-xs underline"
        style={{ color: 'var(--text-muted)' }}
        onClick={() => onChange({ ...condition, conditions: [...condition.conditions, defaultSimple(category)] })}
      >
        + ещё условие
      </button>
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export function RulesEditorPage() {
  const navigate = useNavigate();
  const [rules, setRules] = useState<ExpertRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ExpertRule | null>(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<ExpertRule['category']>('bin');
  const [formSeverity, setFormSeverity] = useState<ExpertRule['severity']>('warning');
  const [formTemplate, setFormTemplate] = useState('');
  const [formPriority, setFormPriority] = useState(0);
  const [formCondition, setFormCondition] = useState<FormCondition>(defaultSimple('bin'));
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  async function load() {
    try {
      const data = await fetchRules();
      setRules(data.rules);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { navigate('/settings'); return; }
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = rules?.filter(r => !filterCategory || r.category === filterCategory) ?? [];

  function openCreate() {
    setEditing(null);
    setFormName('');
    setFormDesc('');
    setFormCategory('bin');
    setFormSeverity('warning');
    setFormTemplate('');
    setFormPriority(0);
    setFormCondition(defaultSimple('bin'));
    setFormError(null);
    setShowModal(true);
  }

  function openEdit(rule: ExpertRule) {
    setEditing(rule);
    setFormName(rule.name);
    setFormDesc(rule.description ?? '');
    setFormCategory(rule.category);
    setFormSeverity(rule.severity);
    setFormTemplate(rule.message_template);
    setFormPriority(rule.priority);
    setFormCondition(conditionToForm(rule.condition));
    setFormError(null);
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormLoading(true);
    setFormError(null);
    try {
      const data: CreateRuleRequest = {
        name: formName,
        description: formDesc || null,
        category: formCategory,
        condition: formConditionToApi(formCondition),
        severity: formSeverity,
        message_template: formTemplate,
        priority: formPriority,
      };
      if (editing) {
        await updateRule(editing.id, data);
        setSuccess('Правило обновлено');
      } else {
        await createRule(data);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  }

  async function handleToggle(rule: ExpertRule) {
    try {
      await toggleRule(rule.id, !rule.is_active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  }

  async function handleMove(rule: ExpertRule, direction: 'up' | 'down') {
    if (!rules) return;
    const idx = rules.findIndex(r => r.id === rule.id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= rules.length) return;

    const next = [...rules];
    const tempPriority = next[idx].priority;
    next[idx] = { ...next[idx], priority: next[targetIdx].priority };
    next[targetIdx] = { ...next[targetIdx], priority: tempPriority };
    // Swap positions in the array too
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    setRules(next);

    setReordering(true);
    try {
      await reorderRules(next.map((r, i) => ({ id: r.id, priority: next.length - i })));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сортировки');
      await load();
    } finally {
      setReordering(false);
    }
  }

  const condPreview = previewCondition(formConditionToApi(formCondition), formTemplate);

  return (
    <div className="py-5 px-6 space-y-4">
      <BlurFade>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              <Shield className="w-5 h-5 inline-block mr-2" strokeWidth={1.5} />
              Редактор правил
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Настройка правил оценки рисков — редактируются без перезапуска сервера
            </p>
          </div>
          <button onClick={openCreate} className="btn-ghost-green px-3 py-1.5 text-sm flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Создать правило
          </button>
        </div>
      </BlurFade>

      {success && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-lg" style={{ background: 'rgba(74,222,128,0.08)', color: '#4ade80' }}>
          <CheckCircle className="w-3.5 h-3.5" /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-xs p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}>
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {/* Фильтр по категории */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCategory('')}
          className="px-3 py-1 rounded-lg text-xs"
          style={{ background: !filterCategory ? 'var(--bg-hover)' : 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          Все
        </button>
        {CATEGORIES.map(c => (
          <button
            key={c.value}
            onClick={() => setFilterCategory(filterCategory === c.value ? '' : c.value)}
            className="px-3 py-1 rounded-lg text-xs"
            style={{
              background: filterCategory === c.value ? 'var(--bg-hover)' : 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Статистика */}
      {rules && (
        <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Всего: <strong style={{ color: 'var(--text-primary)' }}>{rules.length}</strong></span>
          <span>Активных: <strong style={{ color: '#4ade80' }}>{rules.filter(r => r.is_active).length}</strong></span>
          <span>Неактивных: <strong style={{ color: 'var(--text-muted)' }}>{rules.filter(r => !r.is_active).length}</strong></span>
          <span>Блокировок: <strong style={{ color: '#f87171' }}>{rules.filter(r => r.severity === 'block' && r.is_active).length}</strong></span>
        </div>
      )}

      {/* Список правил */}
      {rules === null ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : (
        <StaggerContainer className="space-y-2" staggerDelay={0.03}>
          {filtered.map((rule, idx) => {
            const sev = severityInfo(rule.severity);
            return (
              <StaggerItem key={rule.id}>
                <div
                  className="p-3 rounded-xl flex items-start gap-3"
                  style={{
                    background: 'var(--bg-base)',
                    border: `1px solid ${rule.is_active ? 'var(--border-subtle)' : 'var(--border-subtle)'}`,
                    opacity: rule.is_active ? 1 : 0.5,
                  }}
                >
                  {/* Priority controls */}
                  <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                    <button
                      type="button"
                      onClick={() => handleMove(rule, 'up')}
                      disabled={reordering || idx === 0}
                      className="p-0.5 rounded hover:bg-white/5 disabled:opacity-30"
                      style={{ color: 'var(--text-ghost)' }}
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px]" style={{ color: 'var(--text-ghost)' }}>{rule.priority}</span>
                    <button
                      type="button"
                      onClick={() => handleMove(rule, 'down')}
                      disabled={reordering || idx === filtered.length - 1}
                      className="p-0.5 rounded hover:bg-white/5 disabled:opacity-30"
                      style={{ color: 'var(--text-ghost)' }}
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Main content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{rule.name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: sev.bg, color: sev.color }}>
                        {sev.label}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa' }}>
                        {categoryLabel(rule.category)}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{rule.description}</p>
                    )}
                    <div className="text-xs font-mono p-2 rounded-lg mt-1" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--text-ghost)' }}>если </span>
                      {previewCondition(rule.condition, rule.message_template)}
                      <span style={{ color: 'var(--text-ghost)' }}> → </span>
                      {sev.label.toUpperCase()}: {rule.message_template}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(rule)}
                      className="p-1.5 rounded hover:bg-white/5"
                      title={rule.is_active ? 'Отключить' : 'Включить'}
                      style={{ color: rule.is_active ? '#4ade80' : 'var(--text-muted)' }}
                    >
                      {rule.is_active
                        ? <ToggleRight className="w-4 h-4" />
                        : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(rule)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(rule)} className="p-1.5 rounded hover:bg-white/5" style={{ color: '#f87171' }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
              {filterCategory ? 'Нет правил в этой категории' : 'Нет правил. Нажмите "Создать правило".'}
            </div>
          )}
        </StaggerContainer>
      )}

      {/* Модальное окно создания/редактирования */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl p-5 space-y-4"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {editing ? 'Редактировать правило' : 'Создать правило'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-3">
              {/* Название + описание */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block label-xs mb-1">Название *</label>
                  <input
                    required
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={inputStyle}
                    placeholder="Напр. BIN with high ban rate"
                  />
                </div>
                <div>
                  <label className="block label-xs mb-1">Описание</label>
                  <input
                    value={formDesc}
                    onChange={e => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={inputStyle}
                    placeholder="Краткое пояснение"
                  />
                </div>
              </div>

              {/* Категория + severity + приоритет */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block label-xs mb-1">Категория *</label>
                  <select
                    value={formCategory}
                    onChange={e => {
                      const cat = e.target.value as ExpertRule['category'];
                      setFormCategory(cat);
                      setFormCondition(defaultSimple(cat));
                    }}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={inputStyle}
                  >
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block label-xs mb-1">Severity *</label>
                  <select
                    value={formSeverity}
                    onChange={e => setFormSeverity(e.target.value as ExpertRule['severity'])}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={inputStyle}
                  >
                    {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block label-xs mb-1">Приоритет</label>
                  <input
                    type="number"
                    value={formPriority}
                    onChange={e => setFormPriority(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Условие */}
              <div>
                <label className="block label-xs mb-2">Условие *</label>
                <div className="p-3 rounded-lg space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
                  <ConditionBuilder
                    condition={formCondition}
                    category={formCategory}
                    onChange={setFormCondition}
                  />
                </div>
              </div>

              {/* Шаблон сообщения */}
              <div>
                <label className="block label-xs mb-1">
                  Шаблон сообщения *
                  <span className="ml-1 font-normal" style={{ color: 'var(--text-ghost)' }}>
                    — используйте &#123;имяПоля&#125; для подстановки
                  </span>
                </label>
                <input
                  required
                  value={formTemplate}
                  onChange={e => setFormTemplate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={inputStyle}
                  placeholder="BIN {bin} имеет {binBanRate}% бан рейт — НЕ ИСПОЛЬЗОВАТЬ"
                />
              </div>

              {/* Preview */}
              {(formTemplate || formCondition) && (
                <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.15)' }}>
                  <div className="text-[11px] mb-1" style={{ color: 'var(--text-ghost)' }}>Preview:</div>
                  <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-ghost)' }}>Если </span>
                    <span style={{ color: '#60a5fa' }}>{condPreview}</span>
                    <span style={{ color: 'var(--text-ghost)' }}> → </span>
                    <span style={{ color: severityInfo(formSeverity).color }}>{formSeverity.toUpperCase()}</span>
                    <span style={{ color: 'var(--text-ghost)' }}>: </span>
                    {formTemplate || '(введите шаблон)'}
                  </div>
                </div>
              )}

              {formError && (
                <div className="flex items-center gap-2 text-xs" style={{ color: '#f87171' }}>
                  <AlertCircle className="w-3.5 h-3.5" /> {formError}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={formLoading}
                  className="btn-ghost-green flex-1 py-2 flex items-center justify-center gap-2 text-sm"
                >
                  {formLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editing ? 'Сохранить' : 'Создать'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-sm"
                  style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-medium)' }}
                >
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
