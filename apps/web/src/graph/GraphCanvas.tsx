import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphNode } from '../api';
import { SHAPE_PATHS } from '../entities';
import { bounds, type Point } from './layout';
import { KIND_LABELS, KIND_LINES, nodeMark } from './style';

interface View {
  x: number;
  y: number;
  k: number;
}

const radiusOf = (node: GraphNode) => (node.kind === 'person' ? 6 : 9 + Math.min(7, node.degree));
const short = (name: string) => (name.length > 26 ? `${name.slice(0, 25)}…` : name);

/**
 * The graph itself: nodes drawn with the map's shapes and colours, links styled
 * by kind. Drag the background to pan, scroll to zoom, drag a node to move it,
 * click to select, double-click to bring in a node's neighbours.
 */
export function GraphCanvas({
  nodes,
  edges,
  positions,
  selected,
  highlight,
  off,
  fitKey,
  onSelect,
  onExpand,
  onMove,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: ReadonlyMap<string, Point>;
  /** A node id or an edge id. */
  selected: string | null;
  /** Nodes and edges on a found path. */
  highlight: ReadonlySet<string>;
  /** Links the reader has switched off: drawn faint, and not followed when a node's neighbours are lit. */
  off: ReadonlySet<string>;
  /** Changes when the view should be fitted to the whole graph again. */
  fitKey: number;
  onSelect: (id: string | null) => void;
  onExpand: (id: string) => void;
  onMove: (id: string, point: Point) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  // What a press began on. The canvas captures the pointer, so later events no longer say.
  const drag = useRef<{ id: string | null; edge: string | null; x: number; y: number; moved: boolean } | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const element = frame.current!;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const fit = () => {
    const box = bounds(positions.values());
    // A handful of nodes is not blown up to fill the screen: labels would crowd each other.
    const k = Math.min(1.25, size.width / box.width, size.height / box.height);
    setView({ k, x: size.width / 2 - (box.x + box.width / 2) * k, y: size.height / 2 - (box.y + box.height / 2) * k });
  };
  // Fitted when a new graph arrives or the canvas changes size, not on every added node.
  useEffect(fit, [fitKey, size.width, size.height]);

  const zoom = (factor: number, cx = size.width / 2, cy = size.height / 2) =>
    setView((now) => {
      const k = Math.min(4, Math.max(0.15, now.k * factor));
      return { k, x: cx - ((cx - now.x) / now.k) * k, y: cy - ((cy - now.y) / now.k) * k };
    });

  useEffect(() => {
    const element = frame.current!;
    // Registered by hand: the page must not scroll while the graph zooms.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [size.width, size.height]);

  const near = useMemo(() => {
    const focus = hovered ?? (selected && positions.has(selected) ? selected : null);
    if (!focus) return null;
    const set = new Set([focus]);
    for (const edge of edges) {
      if (off.has(edge.id)) continue;
      if (edge.source === focus) set.add(edge.target);
      if (edge.target === focus) set.add(edge.source);
    }
    return set;
  }, [hovered, selected, edges, positions, off]);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const labelAll = nodes.length <= 80;

  return (
    <div
      ref={frame}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-bg"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as Element;
        const id = target.closest('[data-node]')?.getAttribute('data-node') ?? null;
        const edge = target.closest('[data-edge]')?.getAttribute('data-edge') ?? null;
        drag.current = { id, edge, x: event.clientX, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const now = drag.current;
        if (!now) return;
        const dx = event.clientX - now.x;
        const dy = event.clientY - now.y;
        if (!now.moved && Math.hypot(dx, dy) < 4) return;
        now.moved = true;
        now.x = event.clientX;
        now.y = event.clientY;
        if (now.id) {
          const at = positions.get(now.id);
          if (at) onMove(now.id, { x: at.x + dx / view.k, y: at.y + dy / view.k });
        } else setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerUp={(event) => {
        const now = drag.current;
        drag.current = null;
        if (!now || now.moved) return;
        // A press that did not move is a click: on a node, a link, or the empty canvas.
        const again = lastClick.current;
        if (now.id && again?.id === now.id && event.timeStamp - again.at < 400) {
          lastClick.current = null;
          onExpand(now.id);
          return;
        }
        lastClick.current = now.id ? { id: now.id, at: event.timeStamp } : null;
        onSelect(now.id ?? now.edge ?? null);
      }}
    >
      <svg width={size.width} height={size.height} role="img" aria-label={`Graph of ${nodes.length} nodes and ${edges.length} links. The same records are listed in the side panel.`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill={KIND_LINES.invested_in.color} />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((edge) => {
            const from = positions.get(edge.source);
            const to = positions.get(edge.target);
            const target = byId.get(edge.target);
            if (!from || !to || !target) return null;
            const line = KIND_LINES[edge.kind];
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            // Stopped short of the node, so the arrowhead is not under it.
            const stop = (radiusOf(target) + 3) / length;
            const x2 = to.x - (to.x - from.x) * stop;
            const y2 = to.y - (to.y - from.y) * stop;
            const on = highlight.has(edge.id) || selected === edge.id;
            const muted = off.has(edge.id);
            const dim = near ? !(near.has(edge.source) && near.has(edge.target)) : highlight.size > 0 && !on;
            return (
              <g key={edge.id} data-edge={edge.id} data-off={muted || undefined} className="cursor-pointer" opacity={muted ? (on ? 0.6 : 0.22) : dim ? 0.15 : 1}>
                <title>{`${byId.get(edge.source)?.name} — ${KIND_LABELS[edge.kind].toLowerCase()} — ${target.name}${muted ? ' (switched off)' : ''}`}</title>
                <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={x2}
                  y2={y2}
                  stroke={on ? '#ffffff' : muted ? '#8b9aa7' : line.color}
                  strokeWidth={on ? line.width + 1.2 : line.width}
                  // A switched-off link keeps its place as a faint dotted line, so it can be found and switched back on.
                  strokeDasharray={muted ? '1 5' : line.dash}
                  strokeOpacity={on ? 1 : 0.7}
                  markerEnd={edge.kind === 'invested_in' && !muted ? 'url(#arrow)' : undefined}
                />
              </g>
            );
          })}
          {nodes.map((node) => {
            const at = positions.get(node.id);
            if (!at) return null;
            const mark = nodeMark(node);
            const r = radiusOf(node);
            const chosen = selected === node.id;
            const on = chosen || highlight.has(node.id);
            const dim = near ? !near.has(node.id) : highlight.size > 0 && !on;
            const labelled = labelAll || on || node.degree >= 3 || (near?.has(node.id) ?? false);
            return (
              <g
                key={node.id}
                data-node={node.id}
                transform={`translate(${at.x},${at.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.25 : 1}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() => setHovered(null)}
              >
                <title>{`${node.name} · ${mark.label}${node.detail ? ` · ${node.detail}` : ''} · ${node.degree} connection${node.degree === 1 ? '' : 's'}`}</title>
                {on && <circle r={r + 5} fill="none" stroke="#ffffff" strokeWidth={1.5} />}
                {/* A filled disc under the shape, so links do not show through outlines. */}
                <circle r={r} fill="#071018" />
                <path
                  d={SHAPE_PATHS[mark.shape]}
                  transform={`scale(${(r * 2) / 24}) translate(-12,-12)`}
                  fill={mark.outline ? '#0b151e' : mark.color}
                  stroke={mark.outline ? mark.color : '#071018'}
                  strokeWidth={mark.outline ? 2 : 1}
                />
                {node.hidden > 0 && (
                  <text x={r + 2} y={-r + 2} fontSize={9} fill="#8b9aa7" className="tabular-nums">
                    +{node.hidden}
                  </text>
                )}
                {labelled && (
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    fontSize={10}
                    fill={on ? '#ffffff' : '#e6edf3'}
                    stroke="#071018"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {short(node.name)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded border border-line bg-panel">
        {(
          [
            ['+', 'Zoom in', () => zoom(1.3)],
            ['−', 'Zoom out', () => zoom(1 / 1.3)],
            ['⤢', 'Fit the whole graph', fit],
          ] as const
        ).map(([text, label, run]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            className="grid h-8 w-8 place-items-center border-b border-line text-base last:border-b-0 hover:bg-raised"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={run}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
