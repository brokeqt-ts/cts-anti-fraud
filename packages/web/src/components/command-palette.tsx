import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Globe, AlertTriangle, BookOpen, Bell, Clock } from 'lucide-react';
import { globalSearch, type SearchResult } from '../api.js';

// ── Type config ──────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, typeof User> = {
  account: User,
  domain: Globe,
  ban: AlertTriangle,
  practice: BookOpen,
  notification: Bell,
};

const TYPE_LABELS: Record<string, string> = {
  account: 'Аккаунт',
  domain: 'Домен',
  ban: 'Бан',
  practice: 'Методичка',
  notification: 'Уведомление',
};

const TYPE_COLORS: Record<string, string> = {
  account: '#60a5fa',
  domain: '#4ade80',
  ban: '#f87171',
  practice: '#a78bfa',
  notification: '#fbbf24',
};

const TYPE_ORDER: string[] = ['account', 'domain', 'ban', 'practice', 'notification'];

// ── Operator autocomplete values ────────────────────────────────────────────

interface OperatorDef {
  prefix: string;
  label: string;
  values: Array<{ value: string; label: string }>;
}

const OPERATORS: OperatorDef[] = [
  { prefix: 'vertical:', label: 'Вертикаль', values: [
    { value: 'gambling', label: 'Gambling' },
    { value: 'nutra', label: 'Nutra' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'dating', label: 'Dating' },
    { value: 'sweepstakes', label: 'Sweepstakes' },
    { value: 'finance', label: 'Finance' },
    { value: 'ecom', label: 'E-commerce' },
  ]},
  { prefix: 'status:', label: 'Статус', values: [
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'banned', label: 'Banned' },
    { value: 'under_review', label: 'Under Review' },
  ]},
  { prefix: 'type:', label: 'Тип аккаунта', values: [
    { value: 'farm', label: 'Farm' },
    { value: 'bought', label: 'Bought' },
    { value: 'rent', label: 'Rent' },
    { value: 'agency', label: 'Agency' },
    { value: 'restored', label: 'Restored' },
  ]},
  { prefix: 'country:', label: 'Страна', values: [
    { value: 'US', label: 'US' }, { value: 'UK', label: 'UK' }, { value: 'DE', label: 'DE' },
    { value: 'FR', label: 'FR' }, { value: 'PL', label: 'PL' }, { value: 'UA', label: 'UA' },
    { value: 'RU', label: 'RU' }, { value: 'BR', label: 'BR' }, { value: 'IN', label: 'IN' },
    { value: 'AU', label: 'AU' }, { value: 'CA', label: 'CA' }, { value: 'JP', label: 'JP' },
  ]},
  { prefix: 'bin:', label: 'BIN карты', values: [] },
  { prefix: 'domain:', label: 'Домен', values: [] },
  { prefix: 'reason:', label: 'Причина бана', values: [
    { value: 'policy', label: 'Policy violation' },
    { value: 'circumventing', label: 'Circumventing systems' },
    { value: 'misrepresentation', label: 'Misrepresentation' },
    { value: 'suspicious', label: 'Suspicious activity' },
    { value: 'billing', label: 'Billing issue' },
  ]},
];

function getAutocompleteSuggestions(query: string): Array<{ display: string; fill: string }> | null {
  const lower = query.toLowerCase();

  // Show operator list when user types just a letter or two without ":"
  // e.g. "v" → suggest "vertical:", "s" → suggest "status:"
  if (!lower.includes(':') && lower.length >= 1 && lower.length <= 8) {
    const matching = OPERATORS.filter(op => op.prefix.startsWith(lower) || op.label.toLowerCase().startsWith(lower));
    if (matching.length > 0 && matching.length < OPERATORS.length) {
      return matching.map(op => ({
        display: op.label,
        fill: op.prefix,
      }));
    }
  }

  // Show values when user typed "operator:" or "operator:partial"
  for (const op of OPERATORS) {
    if (!lower.startsWith(op.prefix)) continue;
    const partial = query.slice(op.prefix.length).toLowerCase();
    if (op.values.length === 0) return null; // free-text operators (bin, domain)
    const filtered = partial
      ? op.values.filter(v => v.value.toLowerCase().includes(partial) || v.label.toLowerCase().includes(partial))
      : op.values;
    if (filtered.length === 0) return null;
    return filtered.map(v => ({
      display: v.label,
      fill: `${op.prefix}${v.value}`,
    }));
  }

  return null;
}

// ── Recent searches (localStorage) ──────────────────────────────────────────

const RECENT_KEY = 'cts:recent-searches';
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch { return []; }
}

function saveRecentSearch(q: string) {
  const recent = getRecentSearches().filter(s => s !== q);
  recent.unshift(q);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

// ── Highlight matched text ──────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  // Strip operator prefix for highlighting
  const searchTerm = query.includes(':') ? query.split(':')[1]?.trim() ?? query : query;
  if (!searchTerm) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(searchTerm.toLowerCase());
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#22c55e', fontWeight: 600 }}>{text.slice(idx, idx + searchTerm.length)}</span>
      {text.slice(idx + searchTerm.length)}
    </>
  );
}

// ── Open event ──────────────────────────────────────────────────────────────

const OPEN_EVENT = 'cts:open-search';
export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

// ── Main component ──────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Open via hotkey or custom event (from search button)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    function onOpenEvent() { setOpen(true); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await globalSearch(q);
      setResults(data.results);
      setSelected(0);
    } catch (err) {
      console.error('[search] error:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Autocomplete state ──────────────────────────────────────────────────

  const suggestions = useMemo(() => getAutocompleteSuggestions(query), [query]);
  const [acSelected, setAcSelected] = useState(0);

  // Reset autocomplete selection when suggestions change
  useEffect(() => { setAcSelected(0); }, [suggestions]);

  function handleInputChange(value: string) {
    setQuery(value);
    // Don't search while showing autocomplete suggestions — wait for selection
    if (!getAutocompleteSuggestions(value)) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 250);
    } else {
      setResults([]);
    }
  }

  function handleAcceptSuggestion(fill: string) {
    if (fill.endsWith(':')) {
      // Operator prefix selected — wait for user to type/pick a value
      setQuery(fill);
      inputRef.current?.focus();
    } else {
      // Value selected — append space so user can immediately narrow with free text
      const withSpace = fill + ' ';
      setQuery(withSpace);
      // Place cursor at end after React re-renders
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(withSpace.length, withSpace.length);
        }
      });
      doSearch(fill);
    }
  }

  function handleSelect(result: SearchResult) {
    saveRecentSearch(query);
    setOpen(false);
    navigate(result.url);
  }

  function handleRecentClick(q: string) {
    setQuery(q);
    doSearch(q);
  }

  // ── Group results by type ────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const groups: Array<{ type: string; label: string; items: Array<SearchResult & { globalIdx: number }> }> = [];
    let globalIdx = 0;
    for (const type of TYPE_ORDER) {
      const items = results.filter(r => r.type === type);
      if (items.length > 0) {
        groups.push({
          type,
          label: `${TYPE_LABELS[type] ?? type} (${items.length})`,
          items: items.map(item => ({ ...item, globalIdx: globalIdx++ })),
        });
      }
    }
    return { groups, totalItems: globalIdx };
  }, [results]);

  // ── Flat index for keyboard nav ──────────────────────────────────────────

  const flatResults = useMemo(() => grouped.groups.flatMap(g => g.items), [grouped]);

  function handleKeyDown(e: React.KeyboardEvent) {
    // When autocomplete is showing, navigate/select suggestions
    if (suggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcSelected(prev => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcSelected(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleAcceptSuggestion(suggestions[acSelected].fill);
      }
      return;
    }

    // Normal result navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatResults[selected]) {
      e.preventDefault();
      handleSelect(flatResults[selected]);
    }
  }

  if (!open) return null;

  const recentSearches = getRecentSearches();
  const showRecent = query.length < 2 && recentSearches.length > 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden shadow-2xl"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--border-medium)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-medium)' }}>
          <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Поиск... или vertical:nutra, status:banned, bin:411111"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-medium)' }}>
            ESC
          </kbd>
        </div>

        {/* Results area */}
        <div className="max-h-[400px] overflow-y-auto">
          {/* Autocomplete suggestions (Discord-style) */}
          {suggestions && suggestions.length > 0 && (
            <div className="py-1" style={{ borderBottom: '1px solid var(--border-medium)' }}>
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Выберите значение <span style={{ color: 'var(--text-ghost)', fontWeight: 400 }}>Tab / Enter</span>
              </div>
              {suggestions.map((s, i) => (
                <button
                  key={s.fill}
                  className="w-full flex items-center gap-3 px-4 py-1.5 text-left transition-colors"
                  style={{ background: i === acSelected ? 'rgba(99,102,241,0.12)' : 'transparent' }}
                  onMouseEnter={() => setAcSelected(i)}
                  onClick={() => handleAcceptSuggestion(s.fill)}
                >
                  <code className="text-[11px] px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80' }}>
                    {s.fill}
                  </code>
                  {s.display !== s.fill && (
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{s.display}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {loading && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Поиск...</div>
          )}

          {/* Operator hints — always visible when query is empty */}
          {!loading && query.length < 2 && (
            <div className="px-4 py-4 space-y-1.5" style={{ borderBottom: showRecent ? '1px solid var(--border-medium)' : undefined }}>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                Операторы поиска
              </div>
              {OPERATORS.map(op => (
                <button
                  key={op.prefix}
                  className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-white/5"
                  onClick={() => { setQuery(op.prefix); inputRef.current?.focus(); }}
                >
                  <code className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>{op.prefix}</code>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{op.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* Recent searches */}
          {!loading && showRecent && (
            <div className="py-2">
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Последние запросы
              </div>
              {recentSearches.map(q => (
                <button
                  key={q}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-white/5"
                  onClick={() => handleRecentClick(q)}
                >
                  <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{q}</span>
                </button>
              ))}
            </div>
          )}

          {/* No results */}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Ничего не найдено
            </div>
          )}

          {/* Grouped results */}
          {!loading && grouped.groups.length > 0 && (
            <div className="py-1">
              {grouped.groups.map(group => (
                <div key={group.type}>
                  {/* Section header */}
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: TYPE_COLORS[group.type] ?? 'var(--text-muted)' }}>
                    {group.label}
                  </div>
                  {/* Items */}
                  {group.items.map(r => {
                    const Icon = TYPE_ICONS[r.type] ?? Search;
                    const color = TYPE_COLORS[r.type] ?? '#94a3b8';
                    const isSelected = r.globalIdx === selected;
                    return (
                      <button
                        key={`${r.type}-${r.id}`}
                        className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                        style={{ background: isSelected ? 'rgba(99,102,241,0.1)' : 'transparent' }}
                        onMouseEnter={() => setSelected(r.globalIdx)}
                        onClick={() => handleSelect(r)}
                      >
                        <Icon className="w-4 h-4 shrink-0" style={{ color }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                            <Highlight text={r.title} query={query} />
                          </div>
                          {r.subtitle && (
                            <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                              <Highlight text={r.subtitle} query={query} />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between px-4 py-2 text-[10px]"
          style={{ borderTop: '1px solid var(--border-medium)', color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>↑↓</kbd> навигация</span>
            {suggestions ? (
              <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>Tab</kbd> выбрать</span>
            ) : (
              <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>Enter</kbd> открыть</span>
            )}
          </div>
          <span><kbd className="px-1 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>ESC</kbd> закрыть</span>
        </div>
      </div>
    </div>
  );
}
