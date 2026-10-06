import { useEffect, useMemo, useRef, useState } from 'react';
import { search, type SearchResponse } from '../api';
import { layerForTypes, POINT_LAYERS, TYPE_LABELS } from '../entities';
import { formatDateTime } from '../lib/format';
import { Icon, MicroLabel, ShapeIcon } from './ui';

export type SearchPick =
  | { kind: 'org'; id: string; lon: number | null; lat: number | null }
  | { kind: 'event'; id: string; lon: number; lat: number }
  | { kind: 'location'; city: string; lon: number; lat: number }
  | { kind: 'sector'; sector: string };

interface Row {
  key: string;
  pick: SearchPick;
  title: string;
  meta: string;
  icon: React.ReactNode;
}

const EXAMPLES = ['fintech investors in Nairobi', 'accelerators in Nairobi', 'agritech startups'];

function groupRows(results: SearchResponse): { title: string; rows: Row[] }[] {
  const byLayer = new Map<string, Row[]>();
  for (const org of results.organisations) {
    const layer = layerForTypes(org.types);
    const group = layer?.label ?? 'Other organisations';
    const rows = byLayer.get(group) ?? [];
    rows.push({
      key: `org-${org.id}`,
      pick: { kind: 'org', id: org.id, lon: org.lon, lat: org.lat },
      title: org.name,
      meta: [org.types.map((type) => TYPE_LABELS[type] ?? type).join(', '), org.sector, org.city].filter(Boolean).join(' · '),
      icon: layer ? <ShapeIcon shape={layer.shape} color={layer.color} /> : null,
    });
    byLayer.set(group, rows);
  }
  const pin = POINT_LAYERS.find((layer) => layer.id === 'events')!;
  const groups = [...byLayer].map(([title, rows]) => ({ title, rows }));
  groups.push({
    title: 'Events',
    rows: results.events.map((event) => ({
      key: `event-${event.id}`,
      pick: { kind: 'event' as const, id: event.id, lon: event.lon, lat: event.lat },
      title: event.name,
      meta: [formatDateTime(event.starts_at), event.venue].filter(Boolean).join(' · '),
      icon: <ShapeIcon shape={pin.shape} color={pin.color} />,
    })),
  });
  groups.push({
    title: 'Locations',
    rows: results.locations.map((place) => ({
      key: `city-${place.city}-${place.country}`,
      pick: { kind: 'location' as const, city: place.city, lon: place.lon, lat: place.lat },
      title: `${place.city}, ${place.country}`,
      meta: `${place.organisations} organisations · go to city`,
      icon: null,
    })),
  });
  groups.push({
    title: 'Sectors',
    rows: results.sectors.map((item) => ({
      key: `sector-${item.sector}`,
      pick: { kind: 'sector' as const, sector: item.sector },
      title: item.sector,
      meta: `${item.organisations} organisations · filter the map`,
      icon: null,
    })),
  });
  return groups.filter((group) => group.rows.length > 0);
}

/** Command palette: type, move with the arrow keys, Enter to go there. */
export function SearchCommand({ onPick, onClose }: { onPick: (pick: SearchPick) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(text, controller.signal)
        .then((response) => {
          setResults(response);
          setFailed(false);
          setActive(0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const groups = useMemo(() => (results ? groupRows(results) : []), [results]);
  const rows = groups.flatMap((group) => group.rows);
  const understood = results
    ? [results.understood.type && TYPE_LABELS[results.understood.type], results.understood.sector, results.understood.city].filter(Boolean)
    : [];

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && rows[active]) onPick(rows[active].pick);
  }

  let index = -1;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-3 pt-[12vh]"
      onPointerDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-md border border-line bg-panel shadow-2xl shadow-black"
        onKeyDown={onKeyDown}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-mute">
          <Icon name="search" />
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search startups, investors, cities, sectors..."
            aria-label="Search startups, investors, cities, sectors"
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-mute"
          />
          <kbd className="rounded border border-line px-1 text-[10px]">Esc</kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Results">
          {!results && !failed && (
            <div className="p-3">
              <MicroLabel>Try</MicroLabel>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="rounded border border-line px-2 py-1 text-xs hover:bg-raised"
                    onClick={() => setQuery(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {failed && <p className="m-0 p-3 text-mute">Search is not available right now.</p>}
          {understood.length > 0 && (
            <p className="m-0 border-b border-line px-3 py-1.5 text-[11px] text-mute">
              Reading this as: <span className="text-accent">{understood.join(' · ')}</span>
            </p>
          )}
          {results && rows.length === 0 && <p className="m-0 p-3 text-mute">No matches.</p>}
          {groups.map((group) => (
            <div key={group.title} className="border-b border-line py-1 last:border-b-0">
              <div className="flex items-baseline justify-between px-3 py-1">
                <MicroLabel>{group.title}</MicroLabel>
                <span className="text-[10px] text-mute">
                  {group.rows.length} result{group.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              {group.rows.map((row) => {
                index += 1;
                const at = index;
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={at === active}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${at === active ? 'bg-raised' : ''}`}
                    onPointerMove={() => setActive(at)}
                    onClick={() => onPick(row.pick)}
                  >
                    <span className="grid w-3 place-items-center">{row.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{row.title}</span>
                      <span className="block truncate text-[11px] text-mute">{row.meta}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
