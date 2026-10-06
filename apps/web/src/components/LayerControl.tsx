import { MAP_STYLES, type MapStyle } from '@atlas/schema';
import { HEAT_LAYERS, POINT_LAYERS } from '../entities';
import { formatCount } from '../lib/format';
import { Chip, MicroLabel, ShapeIcon, useStored } from './ui';

const STYLE_LABELS: Record<MapStyle, string> = { dark: 'Dark', light: 'Light', terrain: 'Terrain' };

function Row({
  checked,
  onChange,
  children,
  count,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <label className="flex h-6 cursor-pointer items-center gap-2 hover:text-accent">
      <input
        type="checkbox"
        className="accent-(--color-accent)"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
      {count !== undefined && <span className="ml-auto text-[11px] text-mute tabular-nums">{formatCount(count)}</span>}
    </label>
  );
}

export function LayerControl({
  enabled,
  counts,
  onToggle,
  mapStyle,
  onMapStyle,
  floating,
}: {
  enabled: ReadonlySet<string>;
  /** Records on each point layer after filters. */
  counts: Record<string, number>;
  onToggle: (id: string, on: boolean) => void;
  mapStyle: MapStyle;
  onMapStyle: (style: MapStyle) => void;
  /** Drawn as a card over the map; otherwise fills its container. */
  floating: boolean;
}) {
  const [open, setOpen] = useStored('ecosight-layer-control', true);
  const body = (
    <div className="px-3 pb-3">
      {POINT_LAYERS.map((layer) => (
        <Row key={layer.id} checked={enabled.has(layer.id)} onChange={(on) => onToggle(layer.id, on)} count={counts[layer.id] ?? 0}>
          <ShapeIcon shape={layer.shape} color={layer.color} />
          {layer.label}
        </Row>
      ))}
      <div className="my-1.5 border-t border-line" />
      {HEAT_LAYERS.map((layer) => (
        <Row key={layer.id} checked={enabled.has(layer.id)} onChange={(on) => onToggle(layer.id, on)}>
          <span className="h-2.5 w-3 shrink-0 rounded-sm bg-linear-to-r from-cyan-900 to-cyan-200" aria-hidden="true" />
          {layer.label}
        </Row>
      ))}
      <div className="mb-1.5 mt-2.5">
        <MicroLabel>Map style</MicroLabel>
      </div>
      <div className="flex flex-wrap gap-1">
        {MAP_STYLES.map((style) => (
          <Chip key={style} active={style === mapStyle} onClick={() => onMapStyle(style)}>
            {STYLE_LABELS[style]}
          </Chip>
        ))}
        <Chip active={false} disabled onClick={() => {}} title="No imagery source with a suitable licence has been chosen yet">
          Satellite
        </Chip>
      </div>
    </div>
  );
  if (!floating) return body;
  return (
    <div className="absolute left-2 top-2 z-10 w-52 rounded border border-line bg-panel/95 shadow-lg shadow-black/40">
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between px-3 hover:bg-raised"
        aria-expanded={open}
        title={open ? 'Minimise map layers' : 'Restore map layers'}
        onClick={() => setOpen(!open)}
      >
        <MicroLabel>Map layers</MicroLabel>
        <span aria-hidden="true" className="text-mute">
          {open ? '–' : '+'}
        </span>
      </button>
      {open && body}
    </div>
  );
}

/** What marker size, clusters and the heat ramp mean. Entity shapes are keyed in the layer list. */
export function MapLegend({ heat }: { heat: boolean }) {
  return (
    <div className="pointer-events-none absolute bottom-9 left-2 z-10 flex items-center gap-3 rounded border border-line bg-panel/95 px-2.5 py-1.5 text-[11px] text-mute">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-mute" aria-hidden="true" /> HQ
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-mute" aria-hidden="true" /> Branch
      </span>
      <span className="flex items-center gap-1.5">
        <span className="grid h-4 w-4 place-items-center rounded-full bg-mute text-[9px] font-semibold text-bg" aria-hidden="true">
          n
        </span>
        Cluster
      </span>
      {heat && (
        <span className="flex items-center gap-1.5">
          Less
          <span className="h-2 w-12 rounded-sm bg-linear-to-r from-cyan-900 via-cyan-500 to-cyan-100" aria-hidden="true" />
          More
        </span>
      )}
    </div>
  );
}
