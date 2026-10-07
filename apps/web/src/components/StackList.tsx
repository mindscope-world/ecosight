import type { Selection } from '@atlas/schema';
import type { PointLayerDef } from '../entities';
import { Icon, MicroLabel, ShapeIcon } from './ui';

export interface StackItem {
  /** The layer the record is drawn on, which gives its shape and colour. */
  layer: PointLayerDef;
  selection: Selection;
  name: string;
  meta: string;
}

export interface Stack {
  /** Ordered by kind, then by name. */
  items: StackItem[];
  /** True when every record is here only because its exact address is not public. */
  cityLevel: boolean;
}

/** "2 startups · 1 investor": how many of each kind, in the order the layers are listed. */
export function summarise(items: StackItem[]): string {
  const counts = new Map<PointLayerDef, number>();
  for (const item of items) counts.set(item.layer, (counts.get(item.layer) ?? 0) + 1);
  return [...counts]
    .map(([layer, count]) => `${count} ${(count === 1 ? layer.noun : layer.label).toLowerCase()}`)
    .join(' · ');
}

/**
 * The records behind one spot on the map that zooming cannot separate. They can
 * be of different kinds: a startup and its investor in the same building are
 * drawn on top of one another, and both are listed here.
 */
export function StackList({
  stack,
  onSelect,
  onClose,
}: {
  stack: Stack;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}) {
  const kinds = new Set(stack.items.map((item) => item.layer)).size;
  return (
    <div aria-live="polite">
      <div className="flex h-8 items-center justify-between px-3">
        <MicroLabel>At this location</MicroLabel>
        <button type="button" aria-label="Close list" className="text-mute hover:text-ink" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="px-3 pb-2">
        <div className="text-lg font-semibold leading-tight tabular-nums">
          {kinds === 1 ? summarise(stack.items) : `${stack.items.length} records`}
        </div>
        {kinds > 1 && <div className="tabular-nums text-accent">{summarise(stack.items)}</div>}
        <p className="m-0 mt-1 text-mute">
          {stack.cityLevel
            ? 'Placed at the centre of the city: no exact address is public for these.'
            : 'These share one address or are placed on the same street.'}
        </p>
      </div>
      <ul className="border-t border-line">
        {stack.items.map((item) => (
          <li key={item.selection.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-raised"
              onClick={() => onSelect(item.selection)}
            >
              <ShapeIcon shape={item.layer.shape} color={item.layer.color} size={11} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.name}</span>
                <span className="block truncate text-[11px] text-mute">{[item.layer.noun, item.meta].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
