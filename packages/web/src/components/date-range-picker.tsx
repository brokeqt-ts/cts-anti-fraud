import { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';

export interface DateRange {
  from: string | null; // ISO date YYYY-MM-DD
  to: string | null;
}

interface Preset {
  label: string;
  from: () => string;
  to: () => string;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const PRESETS: Preset[] = [
  { label: 'Сегодня', from: () => today(), to: () => today() },
  { label: '7 дней', from: () => daysAgo(7), to: () => today() },
  { label: '30 дней', from: () => daysAgo(30), to: () => today() },
  { label: '90 дней', from: () => daysAgo(90), to: () => today() },
];

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const hasFilter = value.from || value.to;

  function getLabel(): string {
    if (!value.from && !value.to) return 'Все время';
    if (value.from && value.to && value.from === value.to) {
      return formatShort(value.from);
    }
    const parts: string[] = [];
    if (value.from) parts.push(formatShort(value.from));
    parts.push('—');
    if (value.to) parts.push(formatShort(value.to));
    return parts.join(' ');
  }

  function handlePreset(preset: Preset) {
    onChange({ from: preset.from(), to: preset.to() });
    setOpen(false);
  }

  function handleClear() {
    onChange({ from: null, to: null });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: hasFilter ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${hasFilter ? 'rgba(99,102,241,0.3)' : 'var(--border-subtle)'}`,
          color: hasFilter ? '#818cf8' : 'var(--text-secondary)',
        }}
      >
        <Calendar className="w-3.5 h-3.5" />
        {getLabel()}
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 right-0 z-[100] rounded-xl p-3 shadow-2xl min-w-[240px]"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)', boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}
        >
          {/* Presets */}
          <div className="space-y-0.5 mb-3">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => handlePreset(p)}
                className="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/5"
                style={{ color: 'var(--text-secondary)' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom range */}
          <div className="pt-2 space-y-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Произвольный период
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={value.from ?? ''}
                onChange={e => onChange({ ...value, from: e.target.value || null })}
                className="flex-1 px-2 py-1 rounded text-xs bg-transparent"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
              <input
                type="date"
                value={value.to ?? ''}
                onChange={e => onChange({ ...value, to: e.target.value || null })}
                className="flex-1 px-2 py-1 rounded text-xs bg-transparent"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Clear */}
          {hasFilter && (
            <button
              onClick={handleClear}
              className="w-full mt-2 px-3 py-1.5 rounded-lg text-xs text-center transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-muted)' }}
            >
              Сбросить
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatShort(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}
