const verticalLabels: Record<string, string> = {
  gambling: 'gambling (гемблинг)',
  nutra: 'nutra (нутра)',
  crypto: 'crypto (крипто)',
  dating: 'dating (дейтинг)',
  sweepstakes: 'sweepstakes (свипы)',
  ecom: 'ecom (товарка)',
  finance: 'finance (финансы)',
  other: 'other (другое)',
};

const verticalColors: Record<string, { bg: string; text: string; border: string }> = {
  gambling: { bg: 'rgba(168,85,247,0.08)', text: '#c084fc', border: 'rgba(168,85,247,0.2)' },
  nutra: { bg: 'rgba(34,197,94,0.08)', text: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  crypto: { bg: 'rgba(245,158,11,0.08)', text: '#fbbf24', border: 'rgba(245,158,11,0.2)' },
  dating: { bg: 'rgba(236,72,153,0.08)', text: '#f472b6', border: 'rgba(236,72,153,0.2)' },
  sweepstakes: { bg: 'rgba(6,182,212,0.08)', text: '#22d3ee', border: 'rgba(6,182,212,0.2)' },
  ecom: { bg: 'rgba(59,130,246,0.08)', text: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
  finance: { bg: 'rgba(16,185,129,0.08)', text: '#34d399', border: 'rgba(16,185,129,0.2)' },
  other: { bg: 'var(--bg-hover)', text: 'var(--text-secondary)', border: 'var(--border-medium)' },
};

export function VerticalBadge({ vertical }: { vertical: string | null }) {
  if (!vertical) return <span style={{ color: 'var(--text-ghost)' }}>-</span>;
  const c = verticalColors[vertical] ?? verticalColors['other']!;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
      }}
    >
      {verticalLabels[vertical] ?? vertical}
    </span>
  );
}

export function StatusBadge({ suspended, status }: { suspended?: boolean; status?: string | null }) {
  const isBad = suspended || status === 'suspended' || status === 'banned';
  if (isBad) {
    return (
      <span
        className="status-badge-suspended inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      >
        <span className="glow-dot glow-dot-red" style={{ width: 6, height: 6 }} />
        Заблокирован
      </span>
    );
  }
  return (
    <span
      className="status-badge-active inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
    >
      <span className="glow-dot glow-dot-green" style={{ width: 6, height: 6 }} />
      Активен
    </span>
  );
}

export function TargetBadge({ target }: { target: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: 'var(--bg-hover)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {target}
    </span>
  );
}

const accountTypeLabels: Record<string, string> = {
  farm: 'Farm',
  purchased: 'Purchased',
  bought: 'Bought',
  agency: 'Agency',
  unknown: 'Unknown',
};

const accountTypeColors: Record<string, { bg: string; text: string; border: string }> = {
  farm: { bg: 'rgba(239,68,68,0.08)', text: '#f87171', border: 'rgba(239,68,68,0.2)' },
  purchased: { bg: 'rgba(245,158,11,0.08)', text: '#fbbf24', border: 'rgba(245,158,11,0.2)' },
  bought: { bg: 'rgba(245,158,11,0.08)', text: '#fbbf24', border: 'rgba(245,158,11,0.2)' },
  agency: { bg: 'rgba(59,130,246,0.08)', text: '#60a5fa', border: 'rgba(59,130,246,0.2)' },
  unknown: { bg: 'var(--bg-hover)', text: 'var(--text-secondary)', border: 'var(--border-medium)' },
};

export function AccountTypeBadge({ type, source }: { type: string | null; source?: string | null }) {
  if (!type) return <span style={{ color: 'var(--text-ghost)' }}>-</span>;
  const c = accountTypeColors[type] ?? accountTypeColors['unknown']!;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {accountTypeLabels[type] ?? type}
      {source === 'auto' && (
        <span style={{ fontSize: 8, opacity: 0.7 }} title="Авто-определён">A</span>
      )}
    </span>
  );
}

export function CloakingBadge({ detected, type }: { detected: boolean | null; type?: string | null }) {
  if (detected == null) return <span style={{ color: 'var(--text-ghost)' }}>-</span>;
  if (!detected) {
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.15)', fontSize: 10 }}
      >
        Clean
      </span>
    );
  }
  const typeLabel = type ? ` (${type.replace(/_/g, ' ')})` : '';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)', fontSize: 10 }}
      title={`Клоакинг обнаружен${typeLabel}`}
    >
      Cloaked{typeLabel}
    </span>
  );
}
