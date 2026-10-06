import { useEffect, useState, type ReactNode } from 'react';
import { SHAPE_PATHS, type Shape } from '../entities';

/** A marker shape, drawn from the same outline the map uses. */
export function ShapeIcon({ shape, color, size = 12 }: { shape: Shape; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d={SHAPE_PATHS[shape]} fill={color} />
    </svg>
  );
}

const ICONS = {
  search: 'M10.5 4a6.5 6.5 0 1 0 4.1 11.5l4.2 4.2 1.4-1.4-4.2-4.2A6.5 6.5 0 0 0 10.5 4zm0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z',
  bell: 'M12 3a6 6 0 0 0-6 6v4l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6zm-2 16a2 2 0 0 0 4 0z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 10c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
  filter: 'M3 5h18l-7 8v6l-4-2v-4z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
  chevronLeft: 'M15 5 8 12l7 7 1.4-1.4L10.8 12l5.6-5.6z',
  chevronRight: 'M9 5 7.6 6.4 13.2 12l-5.6 5.6L9 19l7-7z',
  layers: 'M12 3 2 8.5l10 5.5 10-5.5zm-7.9 9.3L2 13.5 12 19l10-5.5-2.1-1.2L12 16.7z',
  chart: 'M4 20V4h2v14h14v2zm4-4 4-6 3 3 4-7 1.7 1-5.3 9.2-3.1-3.1L9.7 17z',
  grid: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
} as const;

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

/** Small uppercase label used above every block of figures. */
export function MicroLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-mute">{children}</span>
  );
}

/** A titled block inside a panel. Its title bar minimises and restores it. */
export function Section({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useStored(`ecosight-section-${id}`, true);
  return (
    <section className="border-b border-line">
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between px-3 hover:bg-raised"
        aria-expanded={open}
        aria-controls={`section-${id}`}
        title={open ? `Minimise ${title}` : `Restore ${title}`}
        onClick={() => setOpen(!open)}
      >
        <MicroLabel>{title}</MicroLabel>
        <span className="flex items-center gap-2 text-[10px] text-mute">
          {aside}
          <span aria-hidden="true" className="w-2 text-center">
            {open ? '–' : '+'}
          </span>
        </span>
      </button>
      {open && (
        <div id={`section-${id}`} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

/** A boolean remembered in the browser. Storage can be blocked; it then lasts for the visit. */
export function useStored(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : saved === '1';
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {}
  };
  return [value, set];
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** A filter or option that is on or off. */
export function Chip({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`h-7 rounded border px-2 text-xs ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-line text-ink hover:bg-raised disabled:text-mute/50 disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}

const TONES = { up: 'text-good', down: 'text-warn', flat: 'text-mute', none: 'text-mute' } as const;

export function Tone({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={`tabular-nums ${TONES[tone]}`}>{children}</span>;
}
