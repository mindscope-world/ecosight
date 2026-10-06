import { useMemo, useState } from 'react';
import type { LandingData } from '../data';
import { hubPoints, KINDS, type PreviewKind } from '../demo';
import { MapCanvas } from '../MapCanvas';
import { ButtonLink, Eyebrow, MAP_URL, Reveal } from '../ui';

const COLORS = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color]));
const HUBS = hubPoints();

const SCALES: { label: string; center: [number, number]; zoom: number }[] = [
  { label: 'World', center: [20, 15], zoom: 1.3 },
  { label: 'Africa', center: [20, 2], zoom: 2.6 },
  { label: 'East Africa', center: [36, -1.5], zoom: 4.6 },
  { label: 'Kenya', center: [37.6, 0.2], zoom: 5.6 },
  { label: 'Nairobi', center: [36.81, -1.283], zoom: 10.6 },
];

export function InteractiveMapPreview({ data }: { data: LandingData }) {
  const [scale, setScale] = useState(0);
  const [kinds, setKinds] = useState<PreviewKind[]>(KINDS.map((kind) => kind.id));
  const view = useMemo(() => ({ center: SCALES[scale]!.center, zoom: SCALES[scale]!.zoom }), [scale]);
  const atCity = scale === SCALES.length - 1;

  const toggle = (id: PreviewKind) =>
    setKinds((current) => (current.includes(id) ? current.filter((kind) => kind !== id) : [...current, id]));

  return (
    <section id="explore" className="bg-bg text-ink">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
        <Reveal className="max-w-2xl">
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">Explore ecosystems at every scale.</h2>
          <p className="mt-4 text-xl text-slate">From a city block to an entire continent.</p>
        </Reveal>

        <Reveal delay={0.1} className="mt-10 overflow-hidden rounded-xl border border-line bg-midnight">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div role="group" aria-label="Scale" className="flex flex-wrap gap-1">
              {SCALES.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  aria-pressed={scale === index}
                  onClick={() => setScale(index)}
                  className={`h-8 rounded px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                    scale === index ? 'bg-accent text-bg' : 'text-slate hover:text-ink'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Layers" className="flex flex-wrap gap-x-4 gap-y-1">
              {KINDS.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={kinds.includes(kind.id)}
                  onClick={() => toggle(kind.id)}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-opacity ${
                    kinds.includes(kind.id) ? 'text-ink' : 'text-slate opacity-50'
                  }`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: kind.color }} aria-hidden="true" />
                  {kind.label}
                </button>
              ))}
            </div>
          </div>
          <MapCanvas
            className="h-[26rem] w-full sm:h-[32rem]"
            label={`Map preview at ${SCALES[scale]!.label} scale`}
            options={{ center: SCALES[0]!.center, zoom: SCALES[0]!.zoom, labels: true, colors: COLORS }}
            points={data.points}
            hubs={HUBS}
            kinds={kinds}
            view={view}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <p className="text-xs text-slate">
              <Eyebrow className="mr-2 text-ink/80">{SCALES[scale]!.label}</Eyebrow>
              {atCity && data.live
                ? `${data.real.features.length} records from the live map.`
                : data.live
                  ? 'Nairobi shows live records. Points elsewhere are illustrative.'
                  : 'Points are illustrative.'}
            </p>
            <ButtonLink href={MAP_URL} variant="text">Open the full map</ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
