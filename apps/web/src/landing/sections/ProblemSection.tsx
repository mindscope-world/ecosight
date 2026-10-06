import { ArrowRight } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import type { LandingData } from '../data';
import { KINDS } from '../demo';
import { DemoTag, Eyebrow, Reveal, Section } from '../ui';

const COLOR = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color]));
const STEPS = ['Lists', 'Places', 'Connections', 'Opportunity'];

const EXAMPLE_ROWS = [
  { name: 'Company A', country: 'KE', raised: '$4.0M', sector: 'fintech' },
  { name: 'Company B', country: 'KE', raised: '$1.2M', sector: 'logistics' },
  { name: 'Company C', country: 'KE', raised: '—', sector: 'healthtech' },
  { name: 'Company D', country: 'KE', raised: '$20M', sector: 'agritech' },
  { name: 'Company E', country: 'KE', raised: '$250K', sector: 'edtech' },
];

/** The same records twice: once as rows, once where they are. */
export function ProblemSection({ data }: { data: LandingData }) {
  const offices = data.offices?.features ?? [];
  const funded = [...new Map(offices.map((feature) => [feature.properties.org_id, feature.properties])).values()]
    .filter((org) => org.raised_usd > 0)
    .sort((a, b) => b.raised_usd - a.raised_usd)
    .slice(0, 5);
  const rows = funded.length
    ? funded.map((org) => ({
        name: org.name,
        country: org.country,
        raised: formatUsd(org.raised_usd),
        sector: org.sector ?? '—',
      }))
    : EXAMPLE_ROWS;

  // The real records, drawn by longitude and latitude alone.
  const lons = offices.map((feature) => feature.geometry.coordinates[0]!);
  const lats = offices.map((feature) => feature.geometry.coordinates[1]!);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const place = (lon: number, lat: number) => ({
    x: 8 + ((lon - west) / (east - west || 1)) * 84,
    y: 6 + (1 - (lat - south) / (north - south || 1)) * 50,
  });

  return (
    <Section id="how" tone="light">
      <Reveal className="max-w-2xl">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          The ecosystem is everywhere.
          <br />
          <span className="text-slate">The data isn&rsquo;t.</span>
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-bg/70">
          Startup intelligence is usually trapped in lists, spreadsheets, databases, and disconnected platforms.
          ecoSight puts companies, capital, programs, and activity back into their geographic context.
        </p>
      </Reveal>

      <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <Reveal className="rounded-xl border border-slate/25 bg-white p-5">
          <div className="flex items-center justify-between">
            <Eyebrow className="text-slate">Traditional startup databases</Eyebrow>
            {!funded.length && <DemoTag>Example</DemoTag>}
          </div>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate/25 text-xs text-slate">
                <th className="py-2 font-medium">Company</th>
                <th className="py-2 font-medium">Country</th>
                <th className="py-2 font-medium">Funding</th>
                <th className="py-2 font-medium">Sector</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-b border-slate/15 last:border-0">
                  <td className="py-2.5 font-medium">{row.name}</td>
                  <td className="py-2.5 text-bg/60">{row.country}</td>
                  <td className="py-2.5 tabular-nums text-bg/60">{row.raised}</td>
                  <td className="py-2.5 text-bg/60">{row.sector}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate">Where are they? Who is near them? Who backed them?</p>
        </Reveal>

        <div className="hidden items-center text-slate lg:flex" aria-hidden="true">
          <ArrowRight size={28} />
        </div>

        <Reveal delay={0.1} className="rounded-xl border border-line bg-bg p-5 text-ink">
          <div className="flex items-center justify-between">
            <Eyebrow className="text-accent">ecoSight</Eyebrow>
            <span className="text-xs text-slate">
              {offices.length ? `${new Set(offices.map((f) => f.properties.org_id)).size} organisations, where they are` : 'The same records, where they are'}
            </span>
          </div>
          <svg viewBox="0 0 100 62" className="mt-4 block w-full" aria-hidden="true">
            {offices.map((feature) => {
              const { x, y } = place(feature.geometry.coordinates[0]!, feature.geometry.coordinates[1]!);
              const big = funded.some((org) => org.org_id === feature.properties.org_id);
              return (
                <g key={feature.properties.office_id}>
                  {big && <circle cx={x} cy={y} r="3.2" fill={COLOR.startup} opacity="0.18" />}
                  <circle cx={x} cy={y} r={big ? 1.3 : 0.8} fill={COLOR.startup} opacity={big ? 1 : 0.7} />
                </g>
              );
            })}
            {!offices.length && <text x="50" y="32" textAnchor="middle" fontSize="3.5" fill="#94a3b8">The map appears once records load.</text>}
          </svg>
          <p className="mt-3 text-xs text-slate">
            {offices.length
              ? 'Every dot is a record on the live map. The five from the table are ringed.'
              : ' '}
          </p>
        </Reveal>
      </div>

      <Reveal className="mt-12 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-lg font-semibold">
        {STEPS.map((step, index) => (
          <span key={step} className="flex items-center gap-4">
            <span className={index === STEPS.length - 1 ? 'text-link' : ''}>{step}</span>
            {index < STEPS.length - 1 && <ArrowRight size={18} className="text-slate" aria-hidden="true" />}
          </span>
        ))}
      </Reveal>
    </Section>
  );
}
