export function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-semibold font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

export function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{value ?? '-'}</dd>
    </div>
  );
}

export function BanSourceBadge({ source }: { source?: string }) {
  const isAuto = source === 'auto';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background: isAuto ? 'rgba(59,130,246,0.1)' : 'rgba(156,163,175,0.1)',
        color: isAuto ? '#3b82f6' : 'var(--text-muted)',
        border: `1px solid ${isAuto ? 'rgba(59,130,246,0.2)' : 'var(--border-subtle)'}`,
      }}
    >
      {isAuto ? 'Авто' : 'Ручной'}
    </span>
  );
}

export function QualityScoreDot({ score }: { score: number | null }) {
  if (score == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
  const c = score >= 7 ? '#22c55e' : score >= 4 ? '#eab308' : '#ef4444';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-2 h-2 rounded-full" style={{ background: c }} />
      <span style={{ color: c }} className="font-mono text-xs font-semibold">{score}/10</span>
    </span>
  );
}
