import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessError, fetchOrg, fetchOrgRows, storedAccessKey, type OrgRow } from '../api';
import { AccessGate } from '../components/AccessGate';
import { ActionLink, EntityDetails, type Detail } from '../components/EntityDetails';
import { SiteNav } from '../components/SiteNav';
import { Icon, MicroLabel, ShapeIcon, useMediaQuery } from '../components/ui';
import { DEMO_DATA } from '../config';
import { POINT_LAYERS, TYPE_LABELS, type PointLayerDef } from '../entities';
import { countryName, formatCount, formatPartialDate, formatUsd } from '../lib/format';
import { graphUrlFor, mapUrlFor, pageUrl } from '../pages';
import { summariseCountries } from './countries';

/** One tab per kind of organisation the map draws. Events have no table yet: there are none on record. */
const TABS = POINT_LAYERS.filter((layer) => layer.id !== 'events');
const PAGE_SIZE = 25;
/** The tab that is not a kind of organisation: every kind, by country. */
const COUNTRIES = 'countries';

interface Column {
  key: string;
  label: string;
  /** What the column sorts by. */
  value: (row: OrgRow) => string | number | null;
  /** What the cell shows, when that is not the sort value as it stands. */
  show?: (row: OrgRow) => ReactNode;
  numeric?: boolean;
}

const NAME: Column = { key: 'name', label: 'Name', value: (row) => row.name.toLowerCase(), show: (row) => row.name };
const KIND: Column = {
  key: 'kind',
  label: 'Kind',
  value: (row) => row.types.map((type) => TYPE_LABELS[type] ?? type).join(', '),
};
const SECTORS: Column = { key: 'sectors', label: 'Sectors', value: (row) => row.sectors.join(', ') || null };
const CITY: Column = { key: 'city', label: 'City', value: (row) => row.city };
const COUNTRY: Column = { key: 'country', label: 'Country', value: (row) => (row.country ? countryName(row.country) : null) };
const FOUNDED: Column = { key: 'founded', label: 'Founded', value: (row) => row.founded_year, numeric: true };
const WEBSITE: Column = {
  key: 'website',
  label: 'Website',
  value: (row) => row.website_domain,
  show: (row) =>
    row.website_domain && (
      <a
        href={`https://${row.website_domain}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent2 underline"
        onClick={(event) => event.stopPropagation()}
      >
        {row.website_domain}
      </a>
    ),
};
// A count of nothing on record is shown as a dash, not as a zero that reads like a finding.
const count = (key: string, label: string, pick: (row: OrgRow) => number): Column => ({
  key,
  label,
  value: (row) => pick(row) || null,
  numeric: true,
});
const RAISED: Column = {
  key: 'raised',
  label: 'Raised',
  value: (row) => row.raised_usd || null,
  show: (row) => (row.raised_usd > 0 ? formatUsd(row.raised_usd) : null),
  numeric: true,
};
const STAGE: Column = { key: 'stage', label: 'Stage', value: (row) => row.stage };
const LAST_INVESTED: Column = {
  key: 'last-invested',
  label: 'Last invested',
  value: (row) => row.last_invested_on,
  show: (row) => row.last_invested_on && formatPartialDate(row.last_invested_on, 'month'),
  numeric: true,
};
const PORTFOLIO = count('portfolio', 'Portfolio', (row) => row.portfolio);

const COLUMNS: Record<string, Column[]> = {
  startups: [NAME, SECTORS, STAGE, RAISED, count('rounds', 'Rounds', (row) => row.rounds), count('investors', 'Investors', (row) => row.investors), CITY, COUNTRY, WEBSITE],
  investors: [NAME, KIND, SECTORS, PORTFOLIO, LAST_INVESTED, CITY, COUNTRY, WEBSITE],
  accelerators: [NAME, KIND, SECTORS, PORTFOLIO, count('participants', 'Programme participants', (row) => row.participants), CITY, COUNTRY, WEBSITE],
};
const OTHER_COLUMNS: Column[] = [NAME, KIND, SECTORS, CITY, COUNTRY, FOUNDED, WEBSITE];

function tally(values: (string | null)[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** The largest few, with the rest folded into one last row so the bars still add up. */
function topWithOther(rows: { label: string; value: number }[], keep = 7) {
  if (rows.length <= keep + 1) return rows;
  const rest = rows.slice(keep);
  return [...rows.slice(0, keep), { label: `${rest.length} others`, value: rest.reduce((sum, row) => sum + row.value, 0) }];
}

/** Horizontal bars for one measure: a label, a thin bar and the figure itself, so nothing is read off an axis. */
function BarList({
  title,
  note,
  rows,
  color,
  format = formatCount,
}: {
  title: string;
  note?: string;
  rows: { label: string; value: number }[];
  color: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <section className="rounded border border-line bg-panel p-3">
      <MicroLabel>{title}</MicroLabel>
      {rows.length === 0 ? (
        <p className="m-0 mt-2 text-mute">Nothing on record.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.label} title={`${row.label}: ${format(row.value)}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate">{row.label}</span>
                <span className="tabular-nums">{format(row.value)}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-r bg-line">
                <div className="h-full rounded-r" style={{ width: `${Math.max(1.5, (row.value / max) * 100)}%`, background: color }} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {note && <p className="m-0 mt-2 text-[11px] leading-snug text-mute">{note}</p>}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-line bg-panel px-3 py-2.5">
      <MicroLabel>{label}</MicroLabel>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums leading-tight">{value}</div>
      {note && <div className="text-[11px] text-mute">{note}</div>}
    </div>
  );
}

/** Every kind of organisation side by side, one row per country, counted where each is based. */
function CountrySummary({ rows }: { rows: OrgRow[] }) {
  const countries = useMemo(() => summariseCountries(rows, TABS), [rows]);
  const placed = countries.filter((row) => row.country !== null);
  const name = (code: string | null) => (code ? countryName(code) : 'No office on record');
  const cell = 'h-8 px-2.5 text-right tabular-nums';
  const figure = (value: number) => (value > 0 ? formatCount(value) : <span className="text-mute">—</span>);
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label="Countries" value={formatCount(placed.length)} note="with an organisation based there" />
        <Tile label="Organisations" value={formatCount(rows.length)} note="published" />
        <Tile label="Rounds on record" value={formatCount(rows.reduce((sum, row) => sum + row.rounds, 0))} />
        <Tile label="Raised on record" value={formatUsd(rows.reduce((sum, row) => sum + row.raised_usd, 0))} note="in US dollars, converted where needed" />
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <BarList title="Organisations by country" color="#22d3ee" rows={topWithOther(placed.map((row) => ({ label: name(row.country), value: row.organisations })), 9)} />
        <BarList
          title="Raised by country"
          color="#22d3ee"
          format={formatUsd}
          rows={placed.filter((row) => row.raised_usd > 0).sort((a, b) => b.raised_usd - a.raised_usd).slice(0, 10).map((row) => ({ label: name(row.country), value: row.raised_usd }))}
          note="Money raised by organisations based in each country, from rounds with an amount on record."
        />
      </div>
      <div className="mt-4 overflow-x-auto rounded border border-line">
        <table className="w-full border-collapse text-left">
          <thead className="bg-panel">
            <tr>
              {['Country', 'Organisations', 'Cities', ...TABS.map((item) => item.label), 'Rounds', 'Raised'].map((heading, index) => (
                <th
                  key={heading}
                  scope="col"
                  className={`h-8 whitespace-nowrap border-b border-line px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute ${index ? 'text-right' : ''}`}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {countries.map((row) => (
              <tr key={row.country ?? 'none'} className="border-b border-line/60 last:border-b-0">
                <th scope="row" className="h-8 whitespace-nowrap px-2.5 text-left font-medium">
                  {row.country ? (
                    <a href={pageUrl('map', `v=1&fk=${row.country}`)} className="hover:text-accent" title="Open the map with only this country's records">
                      {name(row.country)}
                    </a>
                  ) : (
                    <span className="text-mute">{name(null)}</span>
                  )}
                </th>
                <td className={cell}>{formatCount(row.organisations)}</td>
                <td className={cell}>{figure(row.cities)}</td>
                {TABS.map((item) => (
                  <td key={item.id} className={cell}>
                    {figure(row.kinds[item.id] ?? 0)}
                  </td>
                ))}
                <td className={cell}>{figure(row.rounds)}</td>
                <td className={cell}>{row.raised_usd > 0 ? formatUsd(row.raised_usd) : <span className="text-mute">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[11px] leading-snug text-mute">
        An organisation is counted in the country of its headquarters. One of two kinds, such as an incubator that also
        invests, is counted under both, so the kinds can add up to more than the total. A country's name opens the map
        with only its records.
      </p>
    </>
  );
}

function decode(hash: string): { tab: string; selected: string | null } {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const tab = params.get('t');
  return { tab: tab === COUNTRIES || TABS.some((layer) => layer.id === tab) ? tab! : TABS[0]!.id, selected: params.get('s') };
}

const initial = decode(location.hash);

export function DataPage() {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [tab, setTab] = useState(initial.tab);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState<{ key: string; descending: boolean }>({ key: 'name', descending: false });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [detail, setDetail] = useState<Detail>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetchOrgRows(controller.signal)
      .then(setRows)
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof AccessError) setLocked(true);
        else setFailed(true);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    history.replaceState(null, '', `#v=1&t=${tab}${selected ? `&s=${selected}` : ''}`);
  }, [tab, selected]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail({ status: 'loading' });
    fetchOrg(selected, controller.signal)
      .then((org) => setDetail({ status: 'org', org }))
      .catch(() => {
        if (!controller.signal.aborted) setDetail({ status: 'error' });
      });
    return () => controller.abort();
  }, [selected]);

  // The by-country tab has no kind of its own; it borrows the first for the hooks below and shows none of it.
  const layer = TABS.find((item) => item.id === tab) ?? TABS[0]!;
  const inTab = (item: PointLayerDef, row: OrgRow) => item.types.some((type) => row.types.includes(type));
  const all = useMemo(() => (rows ?? []).filter((row) => inTab(layer, row)), [rows, layer]);
  const columns = COLUMNS[tab] ?? OTHER_COLUMNS;

  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    const column = columns.find((item) => item.key === sort.key) ?? NAME;
    return all
      .filter((row) => !country || row.country === country)
      .filter(
        (row) =>
          !text ||
          [row.name, row.city ?? '', ...row.sectors, ...row.types.map((type) => TYPE_LABELS[type] ?? type)].some((part) =>
            part.toLowerCase().includes(text),
          ),
      )
      .sort((a, b) => {
        const x = column.value(a);
        const y = column.value(b);
        // Rows with nothing on record go last whichever way the column is sorted.
        if (x === null || y === null) return x === y ? a.name.localeCompare(b.name) : x === null ? 1 : -1;
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return (sort.descending ? -order : order) || a.name.localeCompare(b.name);
      });
  }, [all, query, country, sort, columns]);

  // A change to what is listed starts again from its first page.
  useEffect(() => setPage(0), [tab, query, country, sort]);

  if (locked) return <AccessGate rejected={storedAccessKey() !== ''} />;

  const countries = tally(all.map((row) => row.country));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const visible = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const located = all.filter((row) => row.precision === 'address' || row.precision === 'area').length;
  const raised = all.reduce((sum, row) => sum + row.raised_usd, 0);
  const cities = new Set(all.filter((row) => row.city).map((row) => `${row.country}/${row.city}`)).size;

  const pickTab = (id: string) => {
    setTab(id);
    setQuery('');
    setCountry('');
    setSort({ key: 'name', descending: false });
  };

  const charts: ReactNode[] = [
    <BarList key="country" title="By country" color={layer.color} rows={topWithOther(countries.map((row) => ({ ...row, label: countryName(row.label) })))} />,
    <BarList
      key="sector"
      title="By sector"
      color={layer.color}
      rows={tally(all.flatMap((row) => row.sectors)).slice(0, 8)}
      note="An organisation can work in several sectors, so these add up to more than the total."
    />,
  ];
  if (tab === 'startups') {
    charts.push(
      <BarList key="stage" title="By stage" color={layer.color} rows={tally(all.map((row) => row.stage)).slice(0, 8)} note={`${all.filter((row) => !row.stage).length} have no stage on record.`} />,
      <BarList
        key="raised"
        title="Most raised"
        color={layer.color}
        format={formatUsd}
        rows={[...all].filter((row) => row.raised_usd > 0).sort((a, b) => b.raised_usd - a.raised_usd).slice(0, 8).map((row) => ({ label: row.name, value: row.raised_usd }))}
        note="Rounds with a stated US dollar amount only."
      />,
    );
  }
  if (tab === 'investors' || tab === 'accelerators') {
    charts.push(
      <BarList
        key="portfolio"
        title="Largest portfolios on record"
        color={layer.color}
        rows={[...all].filter((row) => row.portfolio > 0).sort((a, b) => b.portfolio - a.portfolio || a.name.localeCompare(b.name)).slice(0, 8).map((row) => ({ label: row.name, value: row.portfolio }))}
        note="Companies each is named as backing in a round on record, not its whole portfolio."
      />,
    );
  }

  const details = selected && (
    <EntityDetails
      detail={detail}
      onClose={() => setSelected(null)}
      onSelect={(selection) => selection.kind === 'org' && setSelected(selection.id)}
      actions={(org) => (
        <>
          <ActionLink href={mapUrlFor(org.id)}>Show on map</ActionLink>
          <ActionLink href={graphUrlFor(org.id)}>View connections</ActionLink>
        </>
      )}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <SiteNav current="dashboard" />
      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-4">
            <h1 className="m-0 text-lg font-semibold">Dashboard</h1>
            <p className="m-0 mt-0.5 text-mute">Every published organisation on record, by kind. Pick a row for its details and sources.</p>

            <div role="tablist" aria-label="Kinds of organisation" className="mt-3 flex gap-1 overflow-x-auto border-b border-line">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === tab}
                  onClick={() => pickTab(item.id)}
                  className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-2.5 ${
                    item.id === tab ? 'border-accent text-ink' : 'border-transparent text-mute hover:text-ink'
                  }`}
                >
                  <ShapeIcon shape={item.shape} color={item.color} size={11} />
                  {item.label}
                  <span className="text-[11px] tabular-nums text-mute">{rows ? rows.filter((row) => inTab(item, row)).length : ''}</span>
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={tab === COUNTRIES}
                onClick={() => pickTab(COUNTRIES)}
                className={`flex h-9 shrink-0 items-center gap-2 border-b-2 px-2.5 ${
                  tab === COUNTRIES ? 'border-accent text-ink' : 'border-transparent text-mute hover:text-ink'
                }`}
              >
                By country
                <span className="text-[11px] tabular-nums text-mute">{rows ? new Set(rows.map((row) => row.country).filter(Boolean)).size : ''}</span>
              </button>
            </div>

            {failed && <p role="alert" className="mt-4 text-warn">The records could not be loaded.</p>}
            {!rows && !failed && <p className="mt-4 text-mute">Loading the records…</p>}

            {rows && tab === COUNTRIES && <CountrySummary rows={rows} />}

            {rows && tab !== COUNTRIES && (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Tile label={layer.label} value={formatCount(all.length)} note="published" />
                  <Tile label="Countries" value={formatCount(countries.length)} note={cities === 1 ? "1 city" : `${cities} cities`} />
                  {tab === 'startups' ? (
                    <Tile label="Raised on record" value={raised > 0 ? formatUsd(raised) : '—'} note={`${all.filter((row) => row.rounds > 0).length} with a round on record`} />
                  ) : tab === 'investors' ? (
                    <Tile label="With a portfolio on record" value={formatCount(all.filter((row) => row.portfolio > 0).length)} note="named in at least one round" />
                  ) : (
                    <Tile label="With a website" value={formatCount(all.filter((row) => row.website_domain).length)} />
                  )}
                  <Tile label="Placed on a street or building" value={formatCount(located)} note={`${all.length - located} at city level or not placed`} />
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{charts}</div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="relative">
                    <span className="sr-only">Search this table</span>
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-mute">
                      <Icon name="search" size={13} />
                    </span>
                    <input
                      type="search"
                      value={query}
                      placeholder="Name, sector or city"
                      onChange={(event) => setQuery(event.target.value)}
                      className="h-8 w-64 rounded border border-line bg-bg pl-7 pr-2 text-xs placeholder:text-mute"
                    />
                  </label>
                  <label>
                    <span className="sr-only">Country</span>
                    <select value={country} onChange={(event) => setCountry(event.target.value)} className="h-8 rounded border border-line bg-bg px-2 text-xs">
                      <option value="">All countries</option>
                      {countries.map((row) => (
                        <option key={row.label} value={row.label}>
                          {countryName(row.label)} ({row.value})
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="ml-auto text-[11px] tabular-nums text-mute" aria-live="polite">
                    {shown.length === 0
                      ? 'No rows match'
                      : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + visible.length} of ${shown.length}${shown.length < all.length ? ` (${all.length} in all)` : ''}`}
                  </span>
                </div>

                <div className="mt-2 overflow-x-auto rounded border border-line">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-panel">
                      <tr>
                        {columns.map((column) => {
                          const active = sort.key === column.key;
                          return (
                            <th
                              key={column.key}
                              scope="col"
                              aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
                              className={`whitespace-nowrap border-b border-line p-0 font-normal ${column.numeric ? 'text-right' : ''}`}
                            >
                              <button
                                type="button"
                                className={`h-8 w-full px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] hover:text-ink ${
                                  active ? 'text-accent' : 'text-mute'
                                } ${column.numeric ? 'text-right' : 'text-left'}`}
                                // Figures are most useful largest first; names and places from A.
                                onClick={() => setSort({ key: column.key, descending: active ? !sort.descending : Boolean(column.numeric) })}
                              >
                                {column.label}
                                <span aria-hidden="true" className="ml-1">
                                  {active ? (sort.descending ? '↓' : '↑') : ''}
                                </span>
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => (
                        <tr
                          key={row.id}
                          tabIndex={0}
                          aria-selected={row.id === selected}
                          className={`cursor-pointer border-b border-line/60 last:border-b-0 hover:bg-raised ${row.id === selected ? 'bg-raised' : ''}`}
                          onClick={() => setSelected(row.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelected(row.id);
                            }
                          }}
                        >
                          {columns.map((column) => {
                            const content = column.show ? column.show(row) : column.value(row);
                            return (
                              <td
                                key={column.key}
                                className={`h-8 max-w-[18rem] truncate px-2.5 ${column.numeric ? 'text-right tabular-nums' : ''} ${
                                  column.key === 'name' ? 'font-medium' : ''
                                }`}
                              >
                                {content === null || content === undefined || content === '' ? <span className="text-mute">—</span> : content}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {pages > 1 && (
                  <nav aria-label="Pages" className="mt-2 flex items-center justify-end gap-2 text-xs">
                    <button type="button" disabled={page === 0} className="h-7 rounded border border-line px-2.5 hover:bg-raised disabled:text-mute/50" onClick={() => setPage(page - 1)}>
                      Previous
                    </button>
                    <span className="tabular-nums text-mute">
                      Page {page + 1} of {pages}
                    </span>
                    <button type="button" disabled={page >= pages - 1} className="h-7 rounded border border-line px-2.5 hover:bg-raised disabled:text-mute/50" onClick={() => setPage(page + 1)}>
                      Next
                    </button>
                  </nav>
                )}
                <p className="mt-4 text-[11px] leading-snug text-mute">
                  A dash means nothing is on record, not that the answer is none. An organisation of two kinds, such as an
                  incubator that also invests, is listed under both. {DEMO_DATA && 'This copy is showing demo data.'}
                </p>
              </>
            )}
          </div>
        </main>
        {details &&
          (desktop ? (
            <aside className="w-80 shrink-0 overflow-y-auto border-l border-line bg-panel">{details}</aside>
          ) : (
            <div className="absolute inset-x-0 bottom-0 z-30 max-h-[70%] overflow-y-auto rounded-t-lg border-t border-line bg-panel shadow-2xl shadow-black">
              {details}
            </div>
          ))}
      </div>
    </div>
  );
}
