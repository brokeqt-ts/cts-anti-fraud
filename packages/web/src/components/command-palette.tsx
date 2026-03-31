import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Globe, AlertTriangle, X } from 'lucide-react';
import { globalSearch, type SearchResult } from '../api.js';

const TYPE_ICONS: Record<string, typeof User> = {
  account: User,
  domain: Globe,
  ban: AlertTriangle,
};

const TYPE_LABELS: Record<string, string> = {
  account: 'Аккаунт',
  domain: 'Домен',
  ban: 'Бан',
};

const TYPE_COLORS: Record<string, string> = {
  account: '#60a5fa',
  domain: '#4ade80',
  ban: '#f87171',
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Open/close with Ctrl+K / Cmd+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await globalSearch(q);
      setResults(data.results);
      setSelected(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInputChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 250);
  }

  function handleSelect(result: SearchResult) {
    setOpen(false);
    navigate(result.url);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault();
      handleSelect(results[selected]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-medium)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск аккаунтов, доменов, банов..."
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Поиск...
            </div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Ничего не найдено
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-1">
              {results.map((r, i) => {
                const Icon = TYPE_ICONS[r.type] ?? Search;
                const color = TYPE_COLORS[r.type] ?? '#94a3b8';
                return (
                  <button
                    key={`${r.type}-${r.id}`}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                    style={{
                      background: i === selected ? 'rgba(99,102,241,0.1)' : 'transparent',
                    }}
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => handleSelect(r)}
                  >
                    <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {r.title}
                      </div>
                      {r.subtitle && (
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {r.subtitle}
                        </div>
                      )}
                    </div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: `${color}15`, color }}
                    >
                      {TYPE_LABELS[r.type]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && query.length < 2 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Введите минимум 2 символа для поиска
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div
          className="flex items-center justify-between px-4 py-2 text-[10px]"
          style={{ borderTop: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}
        >
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>↑↓</kbd> навигация</span>
            <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>Enter</kbd> открыть</span>
          </div>
          <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>Ctrl+K</kbd> поиск</span>
        </div>
      </div>
    </div>
  );
}
