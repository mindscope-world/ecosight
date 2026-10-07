import {
  countActive,
  decodeUrlState,
  encodeUrlState,
  matches,
  matchesEvent,
  NO_FILTERS,
  type Filters,
  type MapStyle,
  type Selection,
  type View,
} from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessError,
  fetchEvent,
  fetchEvents,
  fetchFilteredStats,
  fetchOffices,
  fetchOrg,
  fetchStats,
  storedAccessKey,
  type CityStat,
  type EventCollection,
  type OfficeCollection,
  type Stats,
} from './api';
import { AccessGate } from './components/AccessGate';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { ActionLink, EntityDetails, type Detail, type LineControl } from './components/EntityDetails';
import { FilterPanel } from './components/FilterPanel';
import { LayerControl, MapLegend } from './components/LayerControl';
import { ActivityPanel, CityList, EcosystemOverview, TopSectors, type SectorShare } from './components/LeftPanel';
import { MapView } from './components/MapView';
import { SearchCommand, type SearchPick } from './components/SearchCommand';
import { StackList, type Stack } from './components/StackList';
import { StatusBar } from './components/StatusBar';
import { TopNavigation } from './components/TopNavigation';
import { Icon, MicroLabel, useMediaQuery, useStored } from './components/ui';
import { BASEMAPS, DEFAULT_CAMERA } from './config';
import { HEAT_LAYERS, POINT_LAYERS, VIEW_LAYERS } from './entities';
import { greatCircle } from './lib/geo';
import { buildSignals } from './lib/signals';
import { graphUrlFor } from './pages';
import type { MapAdapter, PickedRecord } from './map/adapter';

const initial = decodeUrlState(location.hash);
const CITY_ZOOM = 11;
const RECORD_ZOOM = 14;

type Sheet = 'overview' | 'layers' | 'insights' | null;

/** A side column on desktop: full height, scrollable, collapsible to a rail. */
function SidePanel({
  side,
  open,
  onToggle,
  label,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}) {
  const border = side === 'left' ? 'border-r' : 'border-l';
  const collapseIcon = (side === 'left') === open ? 'chevronLeft' : 'chevronRight';
  if (!open)
    return (
      <aside className={`flex w-7 shrink-0 flex-col items-center bg-panel ${border} border-line`}>
        <button
          type="button"
          className="grid h-8 w-full place-items-center text-mute hover:bg-raised hover:text-ink"
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
          onClick={onToggle}
        >
          <Icon name={collapseIcon} size={14} />
        </button>
        <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mute [writing-mode:vertical-rl]">
          {label}
        </span>
      </aside>
    );
  return (
    <aside className={`flex shrink-0 flex-col bg-panel ${border} border-line ${side === 'left' ? 'w-64' : 'w-80'}`}>
      <div className={`flex h-7 shrink-0 items-center border-b border-line px-1 ${side === 'left' ? 'justify-end' : 'justify-start'}`}>
        <button
          type="button"
          className="grid h-6 w-6 place-items-center rounded text-mute hover:bg-raised hover:text-ink"
          aria-label={`Collapse ${label}`}
          title={`Collapse ${label}`}
          onClick={onToggle}
        >
          <Icon name={collapseIcon} size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

/** A panel that slides up from the bottom on small screens. */
function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[62%] flex-col rounded-t-lg border-t border-line bg-panel shadow-2xl shadow-black">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <MicroLabel>{title}</MicroLabel>
        <button type="button" aria-label={`Close ${title}`} className="text-mute hover:text-ink" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function distinctOrgs(features: OfficeCollection['features']) {
  const seen = new Map<string, OfficeCollection['features'][number]['properties']>();
  for (const feature of features)
    if (!seen.has(feature.properties.org_id)) seen.set(feature.properties.org_id, feature.properties);
  return [...seen.values()];
}

export function App() {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const map = useRef<MapAdapter | null>(null);

  const [offices, setOffices] = useState<OfficeCollection | null>(null);
  const [events, setEvents] = useState<EventCollection | null>(null);
  // Figures for everything on record, and for what passes the filters when any are set.
  const [allStats, setStats] = useState<Stats | null>(null);
  const [filteredStats, setFilteredStats] = useState<Stats | null>(null);
  const [statsBehind, setStatsBehind] = useState(false);
  const [failed, setFailed] = useState(false);
  // True when the API refused us for want of an access key.
  const [locked, setLocked] = useState(false);

  const [view, setView] = useState<View>(initial.view ?? 'map');
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(
    () => new Set(initial.layers ?? VIEW_LAYERS[initial.view ?? 'map']),
  );
  const [filters, setFilters] = useState<Filters>(initial.filters ?? NO_FILTERS);
  const [mapStyle, setMapStyle] = useState<MapStyle>(initial.mapStyle ?? 'dark');
  const [selected, setSelected] = useState<Selection | undefined>(initial.selected);
  const [detail, setDetail] = useState<Detail>({ status: 'loading' });
  const [camera, setCamera] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  // The list a marker opened when it stood for several records on one spot.
  const [stack, setStack] = useState<Stack | null>(null);

  const [leftOpen, setLeftOpen] = useStored('ecosight-left', true);
  const [rightOpen, setRightOpen] = useStored('ecosight-right', true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetchOffices(controller.signal).then(setOffices),
      fetchEvents(controller.signal).then(setEvents),
      fetchStats(controller.signal).then(setStats),
    ]).catch((error) => {
      if (controller.signal.aborted) return;
      if (error instanceof AccessError) setLocked(true);
      else setFailed(true);
    });
    return () => controller.abort();
  }, []);

  // Everything on screen that counts or draws organisations starts from this list.
  const visible = useMemo(
    () => (offices?.features ?? []).filter((feature) => matches(feature.properties, filters)),
    [offices, filters],
  );

  const visibleEvents = useMemo<EventCollection>(
    () => ({
      type: 'FeatureCollection',
      features: (events?.features ?? []).filter((feature) => matchesEvent(feature.properties, filters)),
    }),
    [events, filters],
  );

  const layerData = useMemo(() => {
    const data: Record<string, FeatureCollection<Point>> = {};
    for (const layer of POINT_LAYERS)
      data[layer.id] =
        layer.id === 'events'
          ? visibleEvents
          : {
              type: 'FeatureCollection',
              features: visible.filter((feature) =>
                layer.types.some((type) => feature.properties.types.includes(type)),
              ),
            };
    return data;
  }, [visible, visibleEvents]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const layer of POINT_LAYERS)
      result[layer.id] =
        layer.id === 'events'
          ? visibleEvents.features.length
          : new Set(layerData[layer.id]!.features.map((feature) => feature.properties!.org_id)).size;
    return result;
  }, [layerData, visibleEvents]);

  const orgs = useMemo(() => distinctOrgs(visible), [visible]);

  // The panels' figures follow the filters. They come from the API, which applies
  // the same rules as the map; if it cannot be reached the panels keep the figures
  // for everything and say so, and the map carries on filtering by itself.
  const filtered = countActive(filters) > 0;
  useEffect(() => {
    if (!filtered) {
      setFilteredStats(null);
      setStatsBehind(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchFilteredStats(filters, controller.signal)
        .then((result) => {
          setFilteredStats(result);
          setStatsBehind(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFilteredStats(null);
          setStatsBehind(true);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filters, filtered]);
  const stats = filteredStats ?? allStats;

  const sectors = useMemo<SectorShare[]>(() => {
    const tally = new Map<string, number>();
    for (const org of orgs) for (const sector of org.sectors) tally.set(sector, (tally.get(sector) ?? 0) + 1);
    return [...tally]
      .map(([sector, count]) => ({ sector, count, share: count / orgs.length }))
      .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));
  }, [orgs]);

  // Filter choices come from the whole dataset, so picking one never hides the others.
  const options = useMemo(() => {
    const all = distinctOrgs(offices?.features ?? []);
    const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b));
    return {
      sectors: sorted(all.flatMap((org) => org.sectors)),
      stages: sorted(all.flatMap((org) => (org.stage ? [org.stage] : []))),
      cities: sorted((offices?.features ?? []).map((feature) => feature.properties.city)),
      countries: sorted((offices?.features ?? []).map((feature) => feature.properties.country)),
    };
  }, [offices]);

  const signals = useMemo(() => (stats ? buildSignals(stats, sectors) : []), [stats, sectors]);
  const emerging = useMemo(
    () =>
      // Only cities with something recent to show: a city that merely hosts an investor is not emerging.
      (stats?.cities ?? [])
        .filter((city) => city.rounds_12m + city.upcoming_events > 0)
        .sort(
        (a, b) =>
          (b.rounds_12m + b.upcoming_events) / b.organisations -
          (a.rounds_12m + a.upcoming_events) / a.organisations,
      ),
    [stats],
  );

  // Share link: the address always describes what is on screen.
  useEffect(() => {
    const hash = encodeUrlState({
      view,
      mapStyle,
      filters,
      camera: map.current?.getCamera() ?? initial.camera,
      layers: [...POINT_LAYERS, ...HEAT_LAYERS].map((layer) => layer.id).filter((id) => enabled.has(id)),
      selected,
    });
    history.replaceState(null, '', '#' + hash);
  }, [view, mapStyle, filters, enabled, selected, camera]);

  // Load the selected record. A newer selection cancels an older request.
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setDetail({ status: 'loading' });
    const request =
      selected.kind === 'event'
        ? fetchEvent(selected.id, controller.signal).then((event): Detail => ({ status: 'event', event }))
        : fetchOrg(selected.id, controller.signal).then((org): Detail => ({ status: 'org', org }));
    request.then(setDetail).catch(() => {
      if (!controller.signal.aborted) setDetail({ status: 'error' });
    });
    return () => controller.abort();
  }, [selected]);

  // Lines from the selected organisation to those it is tied to by money: its
  // investors and the companies it has backed, and to its own branches.
  const links = useMemo<{ to: string | null; line: [number, number][] }[]>(() => {
    if (!selected || detail.status !== 'org') return [];
    const { org } = detail;
    const home = org.offices[0];
    if (!home) return [];
    const headquarters = new Map<string, [number, number]>();
    for (const feature of offices?.features ?? [])
      if (feature.properties.is_hq || !headquarters.has(feature.properties.org_id))
        headquarters.set(feature.properties.org_id, feature.geometry.coordinates as [number, number]);
    // Each line knows which record it leads to, so one can be hidden without the others. A branch has no such record.
    const ends: { to: string | null; end: [number, number] }[] = [
      ...[
        ...org.connections.investors,
        ...org.connections.portfolio,
        ...org.connections.programs.map((item) => item.organisation),
        ...org.connections.affiliations.map((item) => item.organisation),
      ].flatMap((other) => {
        const place = headquarters.get(other.id);
        return place ? [{ to: other.id, end: place }] : [];
      }),
      ...org.offices.slice(1).map((office) => ({ to: null, end: [office.lon, office.lat] as [number, number] })),
    ];
    return ends.map(({ to, end }) => ({ to, line: greatCircle([home.lon, home.lat], end) }));
  }, [selected, detail, offices]);

  // Lines the reader has hidden, each named by the two records it joins. Kept for the visit.
  const [hiddenLines, setHiddenLines] = useState<ReadonlySet<string>>(new Set());
  const pairKey = (other: string) => `${selected?.id}|${other}`;
  const lineControl: LineControl = {
    state: (other) => (!links.some((link) => link.to === other) ? 'none' : hiddenLines.has(pairKey(other)) ? 'off' : 'on'),
    toggle: (other) =>
      setHiddenLines((now) => {
        const next = new Set(now);
        if (!next.delete(pairKey(other))) next.add(pairKey(other));
        return next;
      }),
  };
  const drawnLinks = useMemo(
    () => links.filter((link) => !link.to || !hiddenLines.has(`${selected?.id}|${link.to}`)).map((link) => link.line),
    [links, hiddenLines, selected],
  );

  // Whether the lines from the selected record are drawn. The reader can switch them off.
  const [linesOn, setLinesOn] = useStored('ecosight-lines', true);
  useEffect(() => {
    if (mapReady) map.current?.setLinks(linesOn ? drawnLinks : []);
  }, [drawnLinks, linesOn, mapReady]);

  // Where the selected record is drawn, so the map can ring it: every office of an organisation in view.
  const selectedPlaces = useMemo<[number, number][]>(() => {
    if (!selected) return [];
    const places =
      selected.kind === 'event'
        ? visibleEvents.features.filter((feature) => feature.properties.event_id === selected.id)
        : visible.filter((feature) => feature.properties.org_id === selected.id);
    return places.map((feature) => feature.geometry.coordinates as [number, number]);
  }, [selected, visible, visibleEvents]);

  const flyTo = useCallback((lon: number, lat: number, zoom: number) => {
    const current = map.current?.getCamera().zoom ?? 0;
    map.current?.flyTo({ lon, lat, zoom: Math.max(current, zoom) });
  }, []);

  const select = useCallback(
    (selection: Selection) => {
      setSelected(selection);
      setRightOpen(true);
      setSheet(null);
      setFiltersOpen(false);
    },
    [setRightOpen],
  );

  // Following a connection: open the record and move the map to it once it is known.
  const follow = useCallback(
    (selection: Selection) => {
      setStack(null);
      select(selection);
      const lookup =
        selection.kind === 'event'
          ? fetchEvent(selection.id).then((event) => ({ lon: event.lon, lat: event.lat }))
          : fetchOrg(selection.id).then((org) => ({ lon: org.offices[0]?.lon ?? null, lat: org.offices[0]?.lat ?? null }));
      lookup
        .then(({ lon, lat }) => {
          if (lon != null && lat != null) flyTo(lon, lat, RECORD_ZOOM);
        })
        .catch(() => {});
    },
    [select, flyTo],
  );

  /** Markers were clicked. One record opens; several that share the spot are listed, whatever their kinds. */
  function pickOnMap(records: PickedRecord[]) {
    const items = new Map<string, Stack['items'][number]>();
    for (const { layer: layerId, properties: record } of records) {
      const layer = POINT_LAYERS.find((entry) => entry.id === layerId);
      const kind = layerId === 'events' ? 'event' : 'org';
      const id = record[kind === 'event' ? 'event_id' : 'org_id'];
      if (!layer || typeof id !== 'string' || items.has(id)) continue;
      const meta = kind === 'event' ? record.venue : [record.sector, record.stage].filter(Boolean).join(' · ');
      items.set(id, { layer, selection: { kind, id }, name: String(record.name ?? ''), meta: String(meta ?? '') });
    }
    if (items.size === 0) return;
    if (items.size === 1) {
      setStack(null);
      select([...items.values()][0]!.selection);
      return;
    }
    const order = (item: Stack['items'][number]) => POINT_LAYERS.indexOf(item.layer);
    setStack({
      items: [...items.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)),
      cityLevel: records.every((record) => record.properties.precision === 'city'),
    });
    setSelected(undefined);
    setRightOpen(true);
    setSheet(null);
    setFiltersOpen(false);
  }

  const toggleLayer = useCallback((id: string, on: boolean) => {
    setEnabled((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function changeView(next: View) {
    setView(next);
    setEnabled(new Set(VIEW_LAYERS[next]));
    if (next === 'discover') setFiltersOpen(true);
    if (next === 'ecosystems' && offices?.features.length) {
      // Pull back to show every place that has records.
      const lons = offices.features.map((feature) => feature.geometry.coordinates[0]!);
      const lats = offices.features.map((feature) => feature.geometry.coordinates[1]!);
      map.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
    }
  }

  function pickSearch(pick: SearchPick) {
    setSearchOpen(false);
    setStack(null);
    if (pick.kind === 'sector') {
      setFilters((current) =>
        current.sectors.includes(pick.sector) ? current : { ...current, sectors: [...current.sectors, pick.sector] },
      );
      return;
    }
    if (pick.kind === 'location') {
      flyTo(pick.lon, pick.lat, CITY_ZOOM);
      return;
    }
    // Make sure the layer the result sits on is showing.
    if (pick.kind === 'event') toggleLayer('events', true);
    select({ kind: pick.kind, id: pick.id });
    if (pick.lon != null && pick.lat != null) flyTo(pick.lon, pick.lat, RECORD_ZOOM);
  }

  const goToCity = (city: CityStat) => flyTo(city.lon, city.lat, CITY_ZOOM);

  // Ctrl or Cmd + K, or a bare slash outside a text field, opens search.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName);
      if ((event.key === 'k' && (event.ctrlKey || event.metaKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const overview = (
    <EcosystemOverview
      counts={{
        startups: counts.startups ?? 0,
        investors: counts.investors ?? 0,
        accelerators: counts.accelerators ?? 0,
        events: counts.events ?? 0,
      }}
      filtered={filtered}
      onEvents={() => changeView('events')}
    />
  );
  const leftContent = stats ? (
    <>
      {statsBehind && (
        <p className="m-0 border-b border-line px-3 py-2 text-[11px] text-warn">
          The figures below cover all records: filtered figures could not be loaded.
        </p>
      )}
      {overview}
      <ActivityPanel stats={stats} onEvents={() => changeView('events')} />
      <TopSectors sectors={sectors} onPick={(sector) => setFilters({ ...filters, sectors: [sector] })} />
      <CityList
        id="markets"
        title="Market activity"
        cities={stats.cities}
        value={(city) => String(city.score)}
        hint="Activity score: organisations, plus 3 per funding round announced in the last 12 months, plus 2 per upcoming event, scaled so the busiest city is 100."
        onPick={goToCity}
      />
    </>
  ) : (
    <p className="p-3 text-mute">{failed ? 'The data could not be loaded.' : 'Loading…'}</p>
  );
  const insights = stats ? (
    <>
      {statsBehind && (
        <p className="m-0 border-b border-line px-3 py-2 text-[11px] text-warn">
          The figures below cover all records: filtered figures could not be loaded.
        </p>
      )}
      <AnalyticsPanel
      stats={stats}
      signals={signals}
      emerging={emerging}
      onCity={goToCity}
      onRecent={(item) => follow({ kind: item.kind === 'event' ? 'event' : 'org', id: item.id })}
    />
    </>
  ) : (
    <p className="p-3 text-mute">{failed ? 'The data could not be loaded.' : 'Loading…'}</p>
  );
  const details = selected ? (
    <EntityDetails
      detail={detail}
      onSelect={follow}
      onClose={() => {
        setSelected(undefined);
        setStack(null);
      }}
      back={stack ? { label: `${stack.items.length} at this location`, onBack: () => setSelected(undefined) } : undefined}
      lines={linesOn ? lineControl : undefined}
      actions={(org) => (
        <>
          <ActionLink href={graphUrlFor(org.id)}>View connections</ActionLink>
          {links.length > 0 && (
            <button
              type="button"
              aria-pressed={linesOn}
              title="The lines from this record to those it is connected to"
              className={`flex h-7 items-center rounded border px-2 text-xs hover:border-accent hover:text-accent ${linesOn ? 'border-accent text-accent' : 'border-line'}`}
              onClick={() => setLinesOn(!linesOn)}
            >
              {linesOn ? `Hide all ${links.length} lines` : `Show all ${links.length} lines`}
            </button>
          )}
        </>
      )}
    />
  ) : (
    stack && <StackList stack={stack} onSelect={select} onClose={() => setStack(null)} />
  );
  const layerControl = (floating: boolean) => (
    <LayerControl
      floating={floating}
      enabled={enabled}
      counts={counts}
      onToggle={toggleLayer}
      mapStyle={mapStyle}
      onMapStyle={setMapStyle}
    />
  );
  const filterPanel = (
    <FilterPanel
      filters={filters}
      onChange={setFilters}
      options={options}
      enabled={enabled}
      onToggleLayer={toggleLayer}
      matching={orgs.length}
      onClose={() => setFiltersOpen(false)}
    />
  );

  if (locked) return <AccessGate rejected={storedAccessKey() !== ''} />;

  return (
    <div className="flex h-full flex-col">
      <TopNavigation
        view={view}
        onView={changeView}
        onSearch={() => setSearchOpen(true)}
        onFilters={() => {
          setFiltersOpen(!filtersOpen);
          setSheet(null);
        }}
        activeFilters={countActive(filters)}
      />
      <div className="relative flex min-h-0 flex-1">
        {desktop && (
          <SidePanel side="left" open={leftOpen} onToggle={() => setLeftOpen(!leftOpen)} label="Ecosystem">
            {leftContent}
          </SidePanel>
        )}
        <main className="relative min-w-0 flex-1">
          <MapView
            adapter={map}
            basemap={BASEMAPS[mapStyle]}
            initialCamera={initial.camera ?? DEFAULT_CAMERA}
            data={layerData}
            enabled={enabled}
            selectedPlaces={selectedPlaces}
            onPick={pickOnMap}
            onCamera={() => setCamera((tick) => tick + 1)}
            onReady={() => setMapReady(true)}
          />
          {desktop && layerControl(true)}
          {desktop && <MapLegend heat={HEAT_LAYERS.filter((layer) => enabled.has(layer.id))} />}
          {!desktop && (
            <>
              <button
                type="button"
                aria-label="Search"
                className="absolute right-3 top-3 z-10 grid h-11 w-11 place-items-center rounded-full border border-line bg-panel text-accent shadow-lg shadow-black/50"
                onClick={() => setSearchOpen(true)}
              >
                <Icon name="search" size={18} />
              </button>
              <div className="absolute bottom-9 left-1/2 z-10 flex -translate-x-1/2 overflow-hidden rounded-full border border-line bg-panel shadow-lg shadow-black/50">
                {(
                  [
                    ['overview', 'grid', 'Overview'],
                    ['layers', 'layers', 'Layers'],
                    ['insights', 'chart', 'Insights'],
                  ] as const
                ).map(([id, icon, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`flex h-10 items-center gap-1.5 px-3.5 text-xs ${sheet === id ? 'text-accent' : 'text-ink'}`}
                    aria-pressed={sheet === id}
                    onClick={() => {
                      setSheet(sheet === id ? null : id);
                      setFiltersOpen(false);
                      setSelected(undefined);
                      setStack(null);
                    }}
                  >
                    <Icon name={icon} size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </main>
        {desktop && (
          <SidePanel side="right" open={rightOpen} onToggle={() => setRightOpen(!rightOpen)} label={selected ? 'Selected' : stack ? 'At this location' : 'Intelligence'}>
            {details || insights}
          </SidePanel>
        )}
        {desktop && filtersOpen && (
          <div className="absolute inset-y-0 right-0 z-20 w-80 border-l border-line bg-panel shadow-2xl shadow-black">
            {filterPanel}
          </div>
        )}
        {!desktop && filtersOpen && (
          <div className="absolute inset-x-0 bottom-0 z-30 h-[70%] rounded-t-lg border-t border-line bg-panel shadow-2xl shadow-black">
            {filterPanel}
          </div>
        )}
        {!desktop && !filtersOpen && (selected || stack) && (
          <div className="absolute inset-x-0 bottom-0 z-30 max-h-[62%] overflow-y-auto rounded-t-lg border-t border-line bg-panel shadow-2xl shadow-black">
            {details}
          </div>
        )}
        {!desktop && !filtersOpen && !selected && !stack && sheet === 'overview' && (
          <BottomSheet title="Ecosystem" onClose={() => setSheet(null)}>{leftContent}</BottomSheet>
        )}
        {!desktop && !filtersOpen && !selected && !stack && sheet === 'layers' && (
          <BottomSheet title="Map layers" onClose={() => setSheet(null)}>{layerControl(false)}</BottomSheet>
        )}
        {!desktop && !filtersOpen && !selected && !stack && sheet === 'insights' && (
          <BottomSheet title="Intelligence" onClose={() => setSheet(null)}>{insights}</BottomSheet>
        )}
      </div>
      <StatusBar stats={stats} failed={failed} inView={orgs.length + visibleEvents.features.length} filtered={filtered} />
      {searchOpen && <SearchCommand onPick={pickSearch} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
