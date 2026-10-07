import { Building2, CalendarDays, CircleDollarSign, GraduationCap, Rocket, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { LandingData } from '../data';
import type { PreviewKind } from '../demo';
import { Eyebrow, Reveal, Section } from '../ui';
import { pointsNote, SectionMap } from './SectionMap';

const LAYERS: { title: string; text: string; icon: LucideIcon; kinds: PreviewKind[] }[] = [
  { title: 'Startups', text: 'Discover companies by location, sector, stage, and activity.', icon: Rocket, kinds: ['startup'] },
  { title: 'Capital', text: 'See investors, VC firms, angels, funding activity, and portfolio footprints.', icon: CircleDollarSign, kinds: ['investor'] },
  { title: 'Programs', text: 'Find accelerators, incubators, grants, and support programs.', icon: GraduationCap, kinds: ['program'] },
  { title: 'Events', text: 'Discover pitch events, conferences, demo days, and ecosystem gatherings.', icon: CalendarDays, kinds: ['event'] },
  { title: 'Organizations', text: 'Map NGOs, development organizations, universities, hubs, and government programs.', icon: Building2, kinds: ['program', 'investor'] },
];

// Africa whole, where the product's records are.
const VIEW = { center: [20, 2] as [number, number], zoom: 2.3 };

export function EcosystemLayers({ data }: { data: LandingData }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <Section tone="white">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end">
        <Reveal>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">One ecosystem. Every layer.</h2>
          <p className="mt-4 max-w-md text-lg text-bg/70">
            Each kind of organisation is its own layer. Turn them on together to see how they sit beside each other.
          </p>
        </Reveal>
        <Reveal delay={0.1}>
          <SectionMap
            label="Map of every layer across Africa"
            view={VIEW}
            points={data.points}
            kinds={active === null ? null : LAYERS[active]!.kinds}
          />
          <p className="mt-2 text-xs text-slate">Point at a layer to see it on its own. {pointsNote(data)}</p>
        </Reveal>
      </div>

      {/* A row that scrolls sideways on small screens and becomes a grid on wide ones. */}
      <ul className="-mx-5 mt-10 flex snap-x gap-4 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0">
        {LAYERS.map((layer, index) => (
          <li key={layer.title} className="w-64 shrink-0 snap-start lg:w-auto">
            <Reveal delay={index * 0.05} className="h-full">
              <div
                tabIndex={0}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                className={`h-full rounded-xl border bg-white p-5 transition-all duration-200 ${
                  active === index ? '-translate-y-1 border-link shadow-lg shadow-slate/20' : 'border-slate/25'
                }`}
              >
                <layer.icon size={22} strokeWidth={1.6} className="text-link" aria-hidden="true" />
                <Eyebrow className="mt-4 block text-bg">{layer.title}</Eyebrow>
                <p className="mt-2 text-sm leading-relaxed text-bg/65">{layer.text}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  );
}
