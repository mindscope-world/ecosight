import { KINDS, schematicDots, type PreviewKind } from '../demo';

const COLOR = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color])) as Record<PreviewKind, string>;

/**
 * A small abstract map: dots gathered into clusters on a dark panel. It shows
 * the idea of a layer or a pattern; it is a drawing, not a view of real places.
 */
export function Schematic({
  seed,
  clusters,
  count = 90,
  highlight,
  heat,
  className = '',
}: {
  seed: number;
  /** Cluster centres and spreads, each from 0 to 1. */
  clusters: [number, number, number][];
  count?: number;
  /** Kinds drawn at full strength; the rest are dimmed. All when not given. */
  highlight?: PreviewKind[];
  /** Soft areas of colour behind the dots: x, y, radius and colour. */
  heat?: [number, number, number, string][];
  className?: string;
}) {
  const dots = schematicDots(count, seed, clusters);
  return (
    <svg viewBox="0 0 100 62" className={`block w-full rounded-lg bg-bg ${className}`} aria-hidden="true">
      <defs>
        <pattern id={`grid-${seed}`} width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="#1a2a35" strokeWidth="0.25" />
        </pattern>
      </defs>
      <rect width="100" height="62" fill={`url(#grid-${seed})`} />
      {heat?.map(([x, y, r, color], index) => (
        <circle key={index} cx={x * 100} cy={y * 62} r={r * 100} fill={color} opacity="0.22" style={{ filter: 'blur(6px)' }} />
      ))}
      {dots.map((dot, index) => {
        const on = !highlight || highlight.includes(dot.kind);
        return (
          <circle
            key={index}
            cx={dot.x * 100}
            cy={dot.y * 62}
            r={on ? 0.9 : 0.6}
            fill={COLOR[dot.kind]}
            opacity={on ? 0.95 : 0.14}
            style={{ transition: 'opacity 300ms, r 300ms' }}
          />
        );
      })}
    </svg>
  );
}
