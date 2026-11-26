/**
 * Filters over the map's records, shared by the web app, the API and share links.
 * `matches` here and the API's SQL must agree; an API test compares them.
 */
/** A place drawn on the map: a circle round a point, or a polygon. Longitude and latitude in degrees. */
export type Area =
  | { type: 'circle'; lon: number; lat: number; km: number }
  | { type: 'polygon'; ring: [number, number][] };

export const AREA_MAX_KM = 2000;
export const AREA_MAX_VERTICES = 40;

const EARTH_KM = 6371.0088;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two places, in kilometres. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const [dLon, dLat] = [rad(b[0] - a[0]), rad(b[1] - a[1])];
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The outline of a circle on the globe, as a closed ring of points for drawing. */
export function circleRing(lon: number, lat: number, km: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  const angular = km / EARTH_KM;
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(Math.sin(rad(lat)) * Math.cos(angular) + Math.cos(rad(lat)) * Math.sin(angular) * Math.cos(bearing));
    const lon2 =
      rad(lon) +
      Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(rad(lat)), Math.cos(angular) - Math.sin(rad(lat)) * Math.sin(lat2));
    ring.push([((((lon2 * 180) / Math.PI + 540) % 360) - 180), (lat2 * 180) / Math.PI]);
  }
  return ring;
}

/** True when a place lies inside the area. A polygon is read on the flat longitude and latitude plane. */
export function inArea(lon: number, lat: number, area: Area | null): boolean {
  if (area === null) return true;
  if (area.type === 'circle') return distanceKm([area.lon, area.lat], [lon, lat]) <= area.km;
  let inside = false;
  const ring = area.ring;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Filters {
  sectors: string[];
  stages: string[];
  city: string | null;
  /** ISO 3166 two-letter code. */
  country: string | null;
  status: 'all' | 'active' | 'inactive';
  foundedFrom: number | null;
  foundedTo: number | null;
  /** Least total raised, in US dollars. */
  raisedMin: number | null;
  /** Years in which the organisation raised or took part in a round. */
  fundedFrom: number | null;
  fundedTo: number | null;
  /** Narrows investors only; other kinds of organisation are unaffected. */
  investor: InvestorFilter;
  /** Events starting within these dates (YYYY-MM-DD). Organisations are unaffected. */
  eventFrom: string | null;
  eventTo: string | null;
  /** Only what lies inside a circle or polygon drawn on the map. */
  area: Area | null;
}

export const INVESTOR_FILTERS = ['any', 'active', 'lead', 'portfolio'] as const;
export type InvestorFilter = (typeof INVESTOR_FILTERS)[number];

/** Organisation types that the investor filter applies to. */
export const INVESTOR_TYPES = ['fund', 'angel_network', 'development_funder'] as const;
/** An investor is active if it took part in a round within this many days. */
export const ACTIVE_INVESTOR_DAYS = 365;

export const NO_FILTERS: Filters = {
  sectors: [],
  stages: [],
  city: null,
  country: null,
  status: 'all',
  foundedFrom: null,
  foundedTo: null,
  raisedMin: null,
  fundedFrom: null,
  fundedTo: null,
  investor: 'any',
  eventFrom: null,
  eventTo: null,
  area: null,
};

/** The facts about an organisation, at one of its offices, that filters look at. */
export interface Filterable {
  types: string[];
  sectors: string[];
  stage: string | null;
  city: string;
  country: string;
  is_active: boolean;
  founded_year: number | null;
  raised_usd: number;
  funding_years: number[];
  led_rounds: number;
  portfolio: number;
  /** Date of the latest round it invested in (YYYY-MM-DD). */
  last_invested_on: string | null;
}

export interface FilterableEvent {
  city: string | null;
  country: string | null;
  starts_at: string;
}

export function countActive(filters: Filters): number {
  return (
    filters.sectors.length +
    filters.stages.length +
    Number(filters.city !== null) +
    Number(filters.country !== null) +
    Number(filters.status !== 'all') +
    Number(filters.foundedFrom !== null || filters.foundedTo !== null) +
    Number(filters.raisedMin !== null) +
    Number(filters.fundedFrom !== null || filters.fundedTo !== null) +
    Number(filters.investor !== 'any') +
    Number(filters.eventFrom !== null || filters.eventTo !== null) +
    Number(Boolean(filters.area))
  );
}

/** True when a filter that narrows organisations is set (the event dates do not). */
export function narrowsOrganisations(filters: Filters): boolean {
  return countActive({ ...filters, eventFrom: null, eventTo: null }) > 0;
}

const DAY_MS = 86_400_000;

/** An organisation with no value for a filtered fact does not match that filter. */
export function matches(item: Filterable, filters: Filters, now: number = Date.now()): boolean {
  if (filters.sectors.length && !filters.sectors.some((sector) => item.sectors.includes(sector)))
    return false;
  if (filters.stages.length && (item.stage === null || !filters.stages.includes(item.stage)))
    return false;
  if (filters.city !== null && item.city !== filters.city) return false;
  if (filters.country !== null && item.country !== filters.country) return false;
  if (filters.status !== 'all' && item.is_active !== (filters.status === 'active')) return false;
  if (filters.foundedFrom !== null || filters.foundedTo !== null) {
    if (item.founded_year === null) return false;
    if (filters.foundedFrom !== null && item.founded_year < filters.foundedFrom) return false;
    if (filters.foundedTo !== null && item.founded_year > filters.foundedTo) return false;
  }
  if (filters.raisedMin !== null && item.raised_usd < filters.raisedMin) return false;
  if (filters.fundedFrom !== null || filters.fundedTo !== null) {
    const from = filters.fundedFrom ?? -Infinity;
    const to = filters.fundedTo ?? Infinity;
    if (!item.funding_years.some((year) => year >= from && year <= to)) return false;
  }
  if (
    filters.investor !== 'any' &&
    item.types.some((type) => (INVESTOR_TYPES as readonly string[]).includes(type))
  ) {
    if (filters.investor === 'lead' && item.led_rounds === 0) return false;
    if (filters.investor === 'portfolio' && item.portfolio === 0) return false;
    if (filters.investor === 'active') {
      // Compared as whole days, the way the database compares dates.
      const today = Math.floor(now / DAY_MS);
      const last = item.last_invested_on ? Math.floor(Date.parse(item.last_invested_on) / DAY_MS) : null;
      if (last === null || last < today - ACTIVE_INVESTOR_DAYS) return false;
    }
  }
  return true;
}

/** Events follow the place and event-date filters only. */
export function matchesEvent(event: FilterableEvent, filters: Filters): boolean {
  if (filters.city !== null && event.city !== filters.city) return false;
  if (filters.country !== null && event.country !== filters.country) return false;
  const day = event.starts_at.slice(0, 10);
  if (filters.eventFrom !== null && day < filters.eventFrom) return false;
  if (filters.eventTo !== null && day > filters.eventTo) return false;
  return true;
}

// Values are encoded twice: the URL parser undoes one layer before the list is
// split, so a comma inside a value survives as %2C until each item is decoded.
const list = (values: string[]) =>
  values.map((value) => encodeURIComponent(encodeURIComponent(value))).join(',');
const unlist = (value: string | null) =>
  value ? value.split(',').map(decodeURIComponent).filter(Boolean) : [];
const year = (value: string | undefined) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= 1800 && n <= 2100 ? n : null;
};
const COORD = (lon: number, lat: number) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;
const round = (value: number, places: number) => Number(value.toFixed(places));

/** An area as a URL part: `c:lon,lat,km` for a circle, `p:lon,lat_lon,lat_...` for a polygon. */
function encodeArea(area: Area): string {
  if (area.type === 'circle') return `c:${round(area.lon, 5)},${round(area.lat, 5)},${round(area.km, 2)}`;
  return `p:${area.ring.map(([lon, lat]) => `${round(lon, 5)},${round(lat, 5)}`).join('_')}`;
}

function decodeArea(value: string | null): Area | null {
  if (!value) return null;
  const [kind, body = ''] = [value.slice(0, 1), value.slice(2)];
  if (value[1] !== ':') return null;
  if (kind === 'c') {
    const [lon, lat, km] = body.split(',').map(Number) as [number, number, number];
    return COORD(lon, lat) && km > 0 && km <= AREA_MAX_KM ? { type: 'circle', lon, lat, km } : null;
  }
  if (kind === 'p') {
    const ring = body.split('_').map((pair) => pair.split(',').map(Number) as [number, number]);
    if (ring.length < 3 || ring.length > AREA_MAX_VERTICES) return null;
    return ring.every(([lon, lat]) => COORD(lon!, lat!)) ? { type: 'polygon', ring } : null;
  }
  return null;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const date = (value: string | undefined) => (value && DATE.test(value) ? value : null);

/**
 * URL parts for the filters that are set. The same parts are the query string
 * the API accepts: fs sectors, fg stages, fc city, fk country, fa status,
 * fy founded years, fr least raised, fd funded years, fi investor, fe event dates,
 * fz area (a circle or polygon drawn on the map).
 */
export function encodeFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.sectors.length) parts.push(`fs=${list(filters.sectors)}`);
  if (filters.stages.length) parts.push(`fg=${list(filters.stages)}`);
  if (filters.city !== null) parts.push(`fc=${encodeURIComponent(filters.city)}`);
  if (filters.country !== null) parts.push(`fk=${encodeURIComponent(filters.country)}`);
  if (filters.status !== 'all') parts.push(`fa=${filters.status}`);
  if (filters.foundedFrom !== null || filters.foundedTo !== null)
    parts.push(`fy=${filters.foundedFrom ?? ''}-${filters.foundedTo ?? ''}`);
  if (filters.raisedMin !== null) parts.push(`fr=${filters.raisedMin}`);
  if (filters.fundedFrom !== null || filters.fundedTo !== null)
    parts.push(`fd=${filters.fundedFrom ?? ''}-${filters.fundedTo ?? ''}`);
  if (filters.investor !== 'any') parts.push(`fi=${filters.investor}`);
  if (filters.eventFrom !== null || filters.eventTo !== null)
    parts.push(`fe=${filters.eventFrom ?? ''}_${filters.eventTo ?? ''}`);
  if (filters.area) parts.push(`fz=${encodeArea(filters.area)}`);
  return parts;
}

export function decodeFilters(params: URLSearchParams): Filters {
  const status = params.get('fa');
  const investor = params.get('fi');
  const [foundedFrom, foundedTo] = (params.get('fy') ?? '').split('-');
  const [fundedFrom, fundedTo] = (params.get('fd') ?? '').split('-');
  const [eventFrom, eventTo] = (params.get('fe') ?? '').split('_');
  const raised = Number(params.get('fr'));
  const country = params.get('fk');
  return {
    sectors: unlist(params.get('fs')),
    stages: unlist(params.get('fg')),
    city: params.get('fc') || null,
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    status: status === 'active' || status === 'inactive' ? status : 'all',
    foundedFrom: year(foundedFrom),
    foundedTo: year(foundedTo),
    raisedMin: params.has('fr') && Number.isFinite(raised) && raised > 0 ? raised : null,
    fundedFrom: year(fundedFrom),
    fundedTo: year(fundedTo),
    investor: (INVESTOR_FILTERS as readonly string[]).includes(investor ?? '')
      ? (investor as InvestorFilter)
      : 'any',
    eventFrom: date(eventFrom),
    eventTo: date(eventTo),
    area: decodeArea(params.get('fz')),
  };
}
