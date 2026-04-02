import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'left' | 'right';
}

/**
 * Reusable portal-based dropdown.
 * Renders content into document.body with fixed positioning,
 * bypassing all stacking context issues (BlurFade, overflow, etc.).
 */
export function Dropdown({ trigger, children, align = 'left' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropRef.current && !dropRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const dropW = 220;
      const fitsBelow = rect.bottom + 300 < window.innerHeight;
      setPos({
        top: fitsBelow ? rect.bottom + 4 : rect.top - 300,
        left: align === 'right'
          ? Math.max(8, rect.right - dropW)
          : Math.min(rect.left, window.innerWidth - dropW - 8),
      });
    }
    setOpen(!open);
  };

  const dropdown = open ? createPortal(
    <div
      ref={dropRef}
      className="rounded-xl p-2 space-y-1 min-w-[180px]"
      style={{
        position: 'fixed',
        zIndex: 99999,
        top: pos.top,
        left: pos.left,
        background: 'var(--bg-dropdown)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
      }}
      onClick={() => setOpen(false)}
    >
      {children}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div ref={triggerRef} onClick={handleOpen} style={{ cursor: 'pointer' }}>
        {trigger}
      </div>
      {dropdown}
    </>
  );
}

interface DropdownItemProps {
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
}

export function DropdownItem({ onClick, children, danger }: DropdownItemProps) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-left transition-colors hover:bg-white/5"
      style={{ color: danger ? 'var(--accent-red)' : 'var(--text-secondary)' }}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div className="my-1" style={{ borderTop: '1px solid var(--border-subtle)' }} />;
}
