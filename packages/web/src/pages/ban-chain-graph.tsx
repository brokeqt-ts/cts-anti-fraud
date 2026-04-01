import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { fetchBanChainGraph, type BanChainNode, type BanChainEdge, formatCid } from '../api.js';
import { BlurFade } from '../components/ui/animations.js';

const EDGE_COLORS: Record<string, string> = {
  domain: '#4ade80',
  bin: '#f59e0b',
  proxy: '#60a5fa',
};

const EDGE_LABELS: Record<string, string> = {
  domain: 'Домен',
  bin: 'BIN',
  proxy: 'Прокси',
};

const STATUS_COLORS: Record<string, string> = {
  banned: '#ef4444',
  suspended: '#f97316',
  active: '#22c55e',
  under_review: '#eab308',
};

interface GraphData {
  nodes: Array<BanChainNode & { x?: number; y?: number }>;
  links: Array<{ source: string; target: string; type: string; label: string }>;
}

export function BanChainGraphPage() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [edgeFilter, setEdgeFilter] = useState<string>('');
  const [hovered, setHovered] = useState<BanChainNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const navigate = useNavigate();

  useEffect(() => {
    fetchBanChainGraph()
      .then(({ nodes, edges }) => {
        setData({
          nodes,
          links: edges.map(e => ({ source: e.source, target: e.target, type: e.type, label: e.label })),
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: Math.max(500, window.innerHeight - 200),
        });
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const filteredData: GraphData | null = data ? (() => {
    if (!edgeFilter) return data;
    const filtered = data.links.filter(l => l.type === edgeFilter);
    const ids = new Set<string>();
    for (const l of filtered) {
      ids.add(typeof l.source === 'string' ? l.source : (l.source as unknown as BanChainNode).id);
      ids.add(typeof l.target === 'string' ? l.target : (l.target as unknown as BanChainNode).id);
    }
    return { nodes: data.nodes.filter(n => ids.has(n.id)), links: filtered };
  })() : null;

  const nodeCanvasObject = useCallback((node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as unknown as BanChainNode & { x: number; y: number };
    const r = n.ban_count > 0 ? 6 : 4;
    const color = STATUS_COLORS[n.status] ?? '#6b7280';

    // Circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Border for banned
    if (n.ban_count > 0) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Label
    if (globalScale > 0.8) {
      const label = n.display_name || formatCid(n.google_account_id);
      const fontSize = Math.max(10 / globalScale, 2);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, n.y + r + fontSize + 1);
    }
  }, []);

  const linkColor = useCallback((link: Record<string, unknown>) => {
    const l = link as { type: string };
    return (EDGE_COLORS[l.type] ?? '#555') + '60';
  }, []);

  const stats = filteredData ? {
    nodes: filteredData.nodes.length,
    edges: filteredData.links.length,
    banned: filteredData.nodes.filter(n => n.status === 'banned' || n.status === 'suspended').length,
    domains: filteredData.links.filter(l => l.type === 'domain').length,
    bins: filteredData.links.filter(l => l.type === 'bin').length,
    proxies: filteredData.links.filter(l => l.type === 'proxy').length,
  } : null;

  return (
    <div className="py-5 px-6 space-y-3">
      <BlurFade>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Ban Chain</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Связи между аккаунтами по общим доменам, BIN и прокси
            </p>
          </div>
          {stats && (
            <div className="flex gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{stats.nodes} аккаунтов</span>
              <span>{stats.edges} связей</span>
              <span style={{ color: '#ef4444' }}>{stats.banned} забанено</span>
            </div>
          )}
        </div>
      </BlurFade>

      {/* Edge type filters */}
      <BlurFade delay={0.04}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <FilterPill active={!edgeFilter} onClick={() => setEdgeFilter('')}>Все связи</FilterPill>
            {(['domain', 'bin', 'proxy'] as const).map(t => (
              <FilterPill key={t} active={edgeFilter === t} onClick={() => setEdgeFilter(t)}>
                <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ background: EDGE_COLORS[t] }} />
                {EDGE_LABELS[t]}
                {stats && <span className="ml-1 opacity-60">{t === 'domain' ? stats.domains : t === 'bin' ? stats.bins : stats.proxies}</span>}
              </FilterPill>
            ))}
          </div>
          {/* Legend */}
          <div className="flex gap-3 ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: '#22c55e' }} />Active</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: '#f97316' }} />Suspended</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: '#ef4444' }} />Banned</span>
          </div>
        </div>
      </BlurFade>

      {/* Graph */}
      <BlurFade delay={0.08}>
        <div
          ref={containerRef}
          className="card-static overflow-hidden relative"
          style={{ minHeight: 500 }}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
              Загрузка графа...
            </div>
          )}
          {!loading && filteredData && filteredData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Нет связанных аккаунтов
            </div>
          )}
          {!loading && filteredData && filteredData.nodes.length > 0 && (
            <ForceGraph2D
              graphData={filteredData}
              width={dimensions.width}
              height={dimensions.height}
              nodeCanvasObject={nodeCanvasObject}
              nodePointerAreaPaint={(node: Record<string, unknown>, color: string, ctx: CanvasRenderingContext2D) => {
                const n = node as { x: number; y: number };
                ctx.beginPath();
                ctx.arc(n.x, n.y, 8, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={linkColor}
              linkWidth={1.5}
              linkDirectionalParticles={0}
              backgroundColor="transparent"
              onNodeHover={(node: unknown) => setHovered(node as BanChainNode | null)}
              onNodeClick={(node: unknown) => {
                const n = node as BanChainNode;
                navigate(`/accounts/${n.google_account_id}`);
              }}
              cooldownTicks={100}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}

          {/* Hover tooltip */}
          {hovered && (
            <div
              className="absolute top-3 right-3 rounded-lg p-3 text-xs space-y-1"
              style={{ background: 'var(--bg-dropdown)', border: '1px solid var(--border-medium)', minWidth: 180 }}
            >
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {hovered.display_name || formatCid(hovered.google_account_id)}
              </div>
              <div className="font-mono" style={{ color: 'var(--text-muted)' }}>{hovered.google_account_id}</div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[hovered.status] ?? '#6b7280' }} />
                <span style={{ color: 'var(--text-secondary)' }}>{hovered.status}</span>
              </div>
              {hovered.ban_count > 0 && (
                <div style={{ color: '#f87171' }}>{hovered.ban_count} бан(ов)</div>
              )}
            </div>
          )}
        </div>
      </BlurFade>
    </div>
  );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 inline-flex items-center"
      style={{
        background: active ? 'var(--border-medium)' : 'var(--bg-card)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        border: active ? '1px solid var(--border-strong)' : '1px solid var(--border-subtle)',
      }}
    >
      {children}
    </button>
  );
}
