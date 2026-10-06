/** Filters over organisations, shared by the map, the panels and share links. */
export interface Filters {
  sectors: string[];
  stages: string[];
  city: string | null;
  status: 'all' | 'active' | 'inactive';
  foundedFrom: number | null;
  foundedTo: number | null;
  /** Least total raised, in US dollars. */
  raisedMin: number | null;
}

export const NO_FILTERS: Filters = {
  sectors: [],
  stages: [],
  city: null,
  status: 'all',
  foundedFrom: null,
  foundedTo: null,
  raisedMin: null,
};

/** The facts about an organisation that filters look at. */
export interface Filterable {
  sectors: string[];
  stage: string | null;
  city: string;
  is_active: boolean;
  founded_year: number | null;
  raised_usd: number;
}

export function countActive(filters: Filters): number {
  return (
    filters.sectors.length +
    filters.stages.length +
    Number(filters.city !== null) +
    Number(filters.status !== 'all') +
    Number(filters.foundedFrom !== null || filters.foundedTo !== null) +
    Number(filters.raisedMin !== null)
  );
}

/** An organisation with no value for a filtered fact does not match that filter. */
export function matches(item: Filterable, filters: Filters): boolean {
  if (filters.sectors.length && !filters.sectors.some((sector) => item.sectors.includes(sector)))
    return false;
  if (filters.stages.length && (item.stage === null || !filters.stages.includes(item.stage)))
    return false;
  if (filters.city !== null && item.city !== filters.city) return false;
  if (filters.status !== 'all' && item.is_active !== (filters.status === 'active')) return false;
  if (filters.foundedFrom !== null || filters.foundedTo !== null) {
    if (item.founded_year === null) return false;
    if (filters.foundedFrom !== null && item.founded_year < filters.foundedFrom) return false;
    if (filters.foundedTo !== null && item.founded_year > filters.foundedTo) return false;
  }
  if (filters.raisedMin !== null && item.raised_usd < filters.raisedMin) return false;
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

/** URL parts for the filters that are set: fs, fg, fc, fa, fy, fr. */
export function encodeFilters(filters: Filters): string[] {
  const parts: string[] = [];
  if (filters.sectors.length) parts.push(`fs=${list(filters.sectors)}`);
  if (filters.stages.length) parts.push(`fg=${list(filters.stages)}`);
  if (filters.city !== null) parts.push(`fc=${encodeURIComponent(filters.city)}`);
  if (filters.status !== 'all') parts.push(`fa=${filters.status}`);
  if (filters.foundedFrom !== null || filters.foundedTo !== null)
    parts.push(`fy=${filters.foundedFrom ?? ''}-${filters.foundedTo ?? ''}`);
  if (filters.raisedMin !== null) parts.push(`fr=${filters.raisedMin}`);
  return parts;
}

export function decodeFilters(params: URLSearchParams): Filters {
  const status = params.get('fa');
  const [from, to] = (params.get('fy') ?? '').split('-');
  const raised = Number(params.get('fr'));
  return {
    sectors: unlist(params.get('fs')),
    stages: unlist(params.get('fg')),
    city: params.get('fc') || null,
    status: status === 'active' || status === 'inactive' ? status : 'all',
    foundedFrom: year(from),
    foundedTo: year(to),
    raisedMin: params.has('fr') && Number.isFinite(raised) && raised > 0 ? raised : null,
  };
}
