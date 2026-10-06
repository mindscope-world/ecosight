/**
 * Filters over the map's records, shared by the web app, the API and share links.
 * `matches` here and the API's SQL must agree; an API test compares them.
 */
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
    Number(filters.eventFrom !== null || filters.eventTo !== null)
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
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const date = (value: string | undefined) => (value && DATE.test(value) ? value : null);

/**
 * URL parts for the filters that are set. The same parts are the query string
 * the API accepts: fs sectors, fg stages, fc city, fk country, fa status,
 * fy founded years, fr least raised, fd funded years, fi investor, fe event dates.
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
  };
}
