import type { Selection } from '@atlas/schema';
import type { PointLayerDef } from '../entities';
import { Icon, MicroLabel, ShapeIcon } from './ui';

export interface StackItem {
  selection: Selection;
  name: string;
  meta: string;
}

export interface Stack {
  layer: PointLayerDef;
  items: StackItem[];
  /** True when every record is here only because its exact address is not public. */
  cityLevel: boolean;
}

/** The records behind one marker that zooming cannot separate. */
export function StackList({
  stack,
  onSelect,
  onClose,
}: {
  stack: Stack;
  onSelect: (selection: Selection) => void;
  onClose: () => void;
}) {
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
          {stack.items.length} {stack.layer.label.toLowerCase()}
        </div>
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
              <ShapeIcon shape={stack.layer.shape} color={stack.layer.color} size={11} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.name}</span>
                {item.meta && <span className="block truncate text-[11px] text-mute">{item.meta}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
