import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Collapsible section with lazy rendering.
 * Children only render when section is open (saves initial render cost).
 */
export function CollapsibleSection({ title, count, defaultOpen = false, icon, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card-static">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
        style={{ borderRadius: open ? '10px 10px 0 0' : '10px' }}
      >
        {open
          ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
          : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />}
        {icon && <span style={{ color: 'var(--text-muted)' }}>{icon}</span>}
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</span>
        {count != null && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
            {count}
          </span>
        )}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
