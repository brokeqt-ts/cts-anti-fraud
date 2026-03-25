import type { ReactNode } from 'react';
import { GlowDot, NumberTicker } from './ui/animations.js';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  accent?: 'default' | 'green' | 'red' | 'amber';
}

const dotColor: Record<string, string> = {
  default: '#3b82f6',
  green: 'var(--accent-green)',
  red: 'var(--accent-red)',
  amber: 'var(--accent-amber)',
};

export function StatCard({ label, value, icon, accent = 'default' }: StatCardProps) {
  const isNumeric = typeof value === 'number';

  return (
    <div className="card-static p-[12px_16px]">
      <div className="flex items-center justify-between mb-2">
        <span className="label-xs" style={{ fontSize: 9 }}>{label}</span>
        {icon ?? <GlowDot color={dotColor[accent]} size={8} />}
      </div>
      <p className="text-[26px] font-light tracking-tight" style={{ color: 'var(--text-primary)' }}>
        {isNumeric ? <NumberTicker value={value} delay={0.1} /> : value}
      </p>
    </div>
  );
}
