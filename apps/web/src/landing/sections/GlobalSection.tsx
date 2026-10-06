import { connectionLines, hubPoints, KINDS } from '../demo';
import type { LandingData } from '../data';
import { MapCanvas } from '../MapCanvas';
import { Eyebrow, Reveal } from '../ui';

const COLORS = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color]));
const HUBS = hubPoints();
const LINES = connectionLines();

export function GlobalSection({ data }: { data: LandingData }) {
  return (
    <section className="relative isolate overflow-hidden bg-bg text-ink">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
        <Reveal>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Innovation doesn&rsquo;t happen in one place.
          </h2>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-slate">
            From emerging ecosystems to established technology hubs, ecoSight gives you a geographic view of where
            innovation is forming.
          </p>
          <p className="mt-6">
            <Eyebrow className="text-ink/80">Built with emerging ecosystems in mind. Designed for the world.</Eyebrow>
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <MapCanvas
            className="aspect-square w-full"
            label="Globe centred on Africa with lines connecting innovation hubs across continents"
            options={{ center: [22, 6], zoom: 2.1, labels: false, globe: true, colors: COLORS }}
            points={data.points}
            hubs={HUBS}
            lines={LINES}
          />
          <p className="mt-2 text-center text-xs text-slate">Connections between cities are illustrative.</p>
        </Reveal>
      </div>
    </section>
  );
}
