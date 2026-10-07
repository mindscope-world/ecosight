import { useEffect, useId, useState } from 'react';
import { search, type OrgResult } from '../api';
import { layerForTypes } from '../entities';
import { ShapeIcon } from '../components/ui';

export interface Picked {
  id: string;
  name: string;
}

/** A search box that finds one organisation and hands back its node id. */
export function NodePicker({
  label,
  value,
  onPick,
  placeholder = 'Search organisations…',
}: {
  label: string;
  value: Picked | null;
  onPick: (picked: Picked | null) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrgResult[] | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(text, controller.signal)
        .then((found) => setResults(found.organisations))
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (value)
    return (
      <div className="flex h-8 items-center justify-between gap-2 rounded border border-line bg-bg px-2">
        <span className="truncate">
          <span className="mr-1.5 text-[11px] text-mute">{label}</span>
          {value.name}
        </span>
        <button type="button" className="text-[11px] text-accent2 hover:underline" aria-label={`Change ${label}`} onClick={() => onPick(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        value={query}
        placeholder={`${label}: ${placeholder}`}
        onChange={(event) => setQuery(event.target.value)}
        className="h-8 w-full rounded border border-line bg-bg px-2 text-xs placeholder:text-mute"
      />
      {results && (
        <ul className="absolute inset-x-0 top-9 z-20 max-h-56 overflow-y-auto rounded border border-line bg-raised shadow-xl shadow-black/60">
          {results.length === 0 && <li className="px-2 py-1.5 text-mute">Nothing found</li>}
          {results.map((org) => {
            const layer = layerForTypes(org.types);
            return (
              <li key={org.id}>
                <button
                  type="button"
                  className="flex h-7 w-full items-center gap-2 px-2 text-left hover:bg-panel hover:text-accent"
                  onClick={() => {
                    setQuery('');
                    setResults(null);
                    onPick({ id: `org:${org.id}`, name: org.name });
                  }}
                >
                  {layer && <ShapeIcon shape={layer.shape} color={layer.color} size={11} />}
                  <span className="truncate">{org.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
