import type { CityStat, Stats } from '../api';
import { dashboardHash } from '../dashboard/subsets';
import { formatCount, trend } from '../lib/format';
import { pageUrl } from '../pages';
import { MicroLabel, Section, Tone } from './ui';

export interface SectorShare {
  sector: string;
  count: number;
  share: number;
}

/** A headline figure that leads to the records it counts: a table on the dashboard, or a view of the map. */
function BigNumber({ value, label, href, onClick, title }: { value: number; label: string; title: string; href?: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-[22px] font-semibold leading-tight tabular-nums group-hover:text-accent">{formatCount(value)}</div>
      <MicroLabel>{label}</MicroLabel>
    </>
  );
  return href ? (
    <a href={href} title={title} className="group block">
      {body}
    </a>
  ) : (
    <button type="button" title={title} className="group block text-left" onClick={onClick}>
      {body}
    </button>
  );
}

export function EcosystemOverview({
  counts,
  filtered,
  onEvents,
}: {
  counts: { startups: number; investors: number; accelerators: number; events: number };
  filtered: boolean;
  /** Show the events on the map. */
  onEvents: () => void;
}) {
  return (
    <Section id="overview" title="Ecosystem overview" aside={filtered ? 'filtered' : undefined}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 pt-1">
        <BigNumber value={counts.startups} label="Startups" href={pageUrl('dashboard', dashboardHash('startups'))} title="List the startups on the dashboard" />
        <BigNumber value={counts.investors} label="Investors" href={pageUrl('dashboard', dashboardHash('investors'))} title="List the investors on the dashboard" />
        <BigNumber value={counts.accelerators} label="Accelerators" href={pageUrl('dashboard', dashboardHash('accelerators'))} title="List the accelerators on the dashboard" />
        <BigNumber value={counts.events} label="Upcoming events" onClick={onEvents} title="Show the events on the map" />
      </div>
    </Section>
  );
}

export function ActivityPanel({ stats, onEvents }: { stats: Stats; onEvents: () => void }) {
  const { activity } = stats;
  // Each figure leads to the rows it counts, on the dashboard.
  const rows = [
    { label: 'Startups added', period: '30 days', to: dashboardHash('startups', 'added'), what: 'the startups added', ...activity.startups_added },
    { label: 'Funding rounds', period: '30 days', to: dashboardHash('startups', 'rounds'), what: 'the startups with a round announced', ...activity.rounds_announced },
    { label: 'Active investors', period: '12 months', to: dashboardHash('investors', 'active'), what: 'the investors active', ...activity.active_investors },
    { label: 'Programs added', period: '30 days', to: dashboardHash('accelerators', 'programs'), what: 'the organisations with a programme added', ...activity.programs_added },
  ];
  return (
    <Section id="activity" title="Ecosystem activity">
      <table className="w-full">
        <tbody>
          {rows.map((row) => {
            const change = trend(row.current, row.previous);
            return (
              <tr
                key={row.label}
                className="h-6"
                title={`Last ${row.period}, compared with the ${row.period} before (${row.previous}). A dash means the earlier period was empty.`}
              >
                <td className="text-mute">
                  <a
                    href={pageUrl('dashboard', row.to)}
                    className="hover:text-accent hover:underline"
                    aria-label={`${row.label}, last ${row.period}: list ${row.what} on the dashboard`}
                  >
                    {row.label} <span className="text-[10px]">{row.period.replace(' days', 'd').replace(' months', 'mo')}</span>
                  </a>
                </td>
                <td className="w-10 text-right font-medium tabular-nums">{formatCount(row.current)}</td>
                <td className="w-14 text-right text-[11px]">
                  <Tone tone={change.tone}>{change.text}</Tone>
                </td>
              </tr>
            );
          })}
          <tr className="h-6">
            <td className="text-mute">
              <button type="button" className="hover:text-accent hover:underline" title="Show the events on the map" onClick={onEvents}>
                Upcoming events <span className="text-[10px]">30d</span>
              </button>
            </td>
            <td className="w-10 text-right font-medium tabular-nums">{activity.events_next_30_days}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export function TopSectors({
  sectors,
  onPick,
}: {
  sectors: SectorShare[];
  onPick: (sector: string) => void;
}) {
  const top = sectors.slice(0, 6);
  const max = top[0]?.share ?? 1;
  return (
    <Section id="sectors" title="Top sectors">
      {top.length === 0 && <p className="text-mute">No organisations in view.</p>}
      <ol className="space-y-1.5">
        {top.map((row, index) => (
          <li key={row.sector}>
            <button
              type="button"
              className="group w-full text-left"
              title={`${row.count} organisations. Filter the map to ${row.sector}.`}
              onClick={() => onPick(row.sector)}
            >
              <span className="flex items-baseline justify-between">
                <span className="group-hover:text-accent">
                  <span className="mr-1.5 text-mute tabular-nums">{index + 1}</span>
                  {row.sector}
                </span>
                <span className="tabular-nums">{Math.round(row.share * 100)}%</span>
              </span>
              <span className="mt-0.5 block h-1 rounded-r bg-line">
                <span
                  className="block h-full rounded-r bg-accent2"
                  style={{ width: `${(row.share / max) * 100}%` }}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function CityList({
  id,
  title,
  cities,
  value,
  hint,
  onPick,
}: {
  id: string;
  title: string;
  cities: CityStat[];
  value: (city: CityStat) => string;
  hint: string;
  onPick: (city: CityStat) => void;
}) {
  return (
    <Section id={id} title={title}>
      {cities.length === 0 && <p className="text-mute">No cities yet.</p>}
      <ol title={hint}>
        {cities.map((city, index) => (
          <li key={`${city.city}-${city.country}`}>
            <button
              type="button"
              className="flex h-6 w-full items-center justify-between hover:text-accent"
              onClick={() => onPick(city)}
            >
              <span>
                <span className="mr-1.5 text-mute tabular-nums">{index + 1}</span>
                {city.city}
                <span className="ml-1 text-[10px] text-mute">{city.country}</span>
              </span>
              <span className="font-medium tabular-nums">{value(city)}</span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}
