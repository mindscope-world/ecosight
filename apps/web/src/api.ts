import { encodeFilters, type Filterable, type FilterableEvent, type Filters } from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import { API_URL, DATA_URL } from './config';

export type OrgType =
  | 'startup'
  | 'fund'
  | 'angel_network'
  | 'ngo'
  | 'accelerator'
  | 'corporate'
  | 'incubator'
  | 'development_funder'
  | 'innovation_hub'
  | 'university'
  | 'government_program';

export interface OfficeProperties extends Filterable {
  office_id: string;
  org_id: string;
  name: string;
  primary_type: OrgType;
  sector: string | null;
  is_hq: boolean;
  precision: 'address' | 'area' | 'city';
  valid_from: string | null;
}

export type OfficeCollection = FeatureCollection<Point, OfficeProperties>;

export interface OrgLink {
  id: string;
  name: string;
  types: OrgType[];
}

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  types: OrgType[];
  sectors: string[];
  stage: string | null;
  website_domain: string | null;
  description: string | null;
  founded_year: number | null;
  is_active: boolean;
  raised_usd: number;
  funding_note: string | null;
  offices: {
    id: string;
    is_hq: boolean;
    address: string | null;
    city: string;
    country: string;
    precision: 'address' | 'area' | 'city';
    lon: number;
    lat: number;
  }[];
  rounds: {
    id: string;
    stage: string | null;
    amount_usd: number | null;
    amount_original: number | null;
    currency: string | null;
    announced_on: string | null;
    announced_precision: 'day' | 'month' | 'year' | null;
  }[];
  connections: {
    investors: OrgLink[];
    portfolio: OrgLink[];
    programs: { name: string; organisation: OrgLink }[];
    events: { id: string; name: string }[];
    people: { name: string; role: string }[];
  };
  sources: {
    field: string;
    source_url: string | null;
    method: 'manual' | 'partner' | 'ai';
    quote?: string | null;
    verified_at: string | null;
  }[];
  last_verified_at: string | null;
}

export interface EventProperties extends FilterableEvent {
  event_id: string;
  name: string;
  venue: string | null;
}

export type EventCollection = FeatureCollection<Point, EventProperties>;

export interface EventDetail {
  id: string;
  name: string;
  organiser: { id: string; name: string } | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  starts_at: string;
  ends_at: string | null;
  url: string | null;
  lon: number | null;
  lat: number | null;
}

export interface OrgResult {
  id: string;
  name: string;
  types: OrgType[];
  sector: string | null;
  city: string | null;
  lon: number | null;
  lat: number | null;
}

export interface SearchResponse {
  understood: { type: OrgType | null; sector: string | null; city: string | null };
  organisations: OrgResult[];
  events: { id: string; name: string; venue: string | null; starts_at: string; lon: number; lat: number }[];
  people: { name: string; role: string; organisation: OrgResult }[];
  locations: { city: string; country: string; organisations: number; lon: number; lat: number }[];
  sectors: { sector: string; organisations: number }[];
}

export interface Trend {
  current: number;
  previous: number;
}

export interface CityStat {
  city: string;
  country: string;
  organisations: number;
  rounds_12m: number;
  upcoming_events: number;
  score: number;
  lon: number;
  lat: number;
}

export interface Stats {
  organisations: number;
  offices: number;
  countries: number;
  last_updated: string | null;
  upcoming_events: number;
  rounds: number;
  raised_usd: number;
  activity: {
    startups_added: Trend;
    rounds_announced: Trend;
    active_investors: Trend;
    programs_added: Trend;
    events_next_30_days: number;
  };
  cities: CityStat[];
  funding_by_month: { month: string; amount_usd: number; rounds: number }[];
  recent: { kind: 'organisation' | 'round' | 'event'; id: string; label: string; at: string }[];
  by_type: { type: OrgType; count: number }[];
  top_sectors: { sector: string; count: number }[];
  recent_rounds: {
    id: string;
    organisation_id: string;
    name: string;
    stage: string | null;
    amount_usd: number | null;
    announced_on: string | null;
  }[];
}

const ACCESS_KEY_STORE = 'ecosight-access-key';

/** Raised when the API wants an access key and has not been given a valid one. */
export class AccessError extends Error {}

export function storedAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

export function storeAccessKey(key: string): void {
  try {
    if (key) localStorage.setItem(ACCESS_KEY_STORE, key);
    else localStorage.removeItem(ACCESS_KEY_STORE);
  } catch {}
}

async function getJson<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const key = storedAccessKey();
  const headers: Record<string, string> = {};
  if (key) headers['x-access-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API_URL + path, {
    signal,
    headers,
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) throw new AccessError('An access key is required');
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json() as Promise<T>;
}

/** The map's own data: from the static build when one is configured, the API otherwise. */
async function getData<T>(file: string, apiPath: string, signal?: AbortSignal): Promise<T> {
  if (!DATA_URL) return getJson<T>(apiPath, signal);
  const res = await fetch(`${DATA_URL}/${file}`, { signal });
  if (!res.ok) throw new Error(`${file} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchOffices = (signal?: AbortSignal) =>
  getData<OfficeCollection>('offices.geojson', '/layers/offices.geojson', signal);

export const fetchEvents = (signal?: AbortSignal) =>
  getData<EventCollection>('events.geojson', '/layers/events.geojson', signal);

export const fetchOrg = (id: string, signal?: AbortSignal) =>
  getJson<OrgDetail>(`/orgs/${encodeURIComponent(id)}`, signal);

export const fetchEvent = (id: string, signal?: AbortSignal) =>
  getJson<EventDetail>(`/events/${encodeURIComponent(id)}`, signal);

export const search = (query: string, signal?: AbortSignal) =>
  getJson<SearchResponse>(`/search?q=${encodeURIComponent(query)}&limit=12`, signal);

export const fetchStats = (signal?: AbortSignal) => getData<Stats>('stats.json', '/stats', signal);

/** Totals and activity for the records passing the filters. Always from the API. */
export const fetchFilteredStats = (filters: Filters, signal?: AbortSignal) =>
  getJson<Stats>(`/stats?${encodeFilters(filters).join('&')}`, signal);

/** One row of the data tables. */
export interface OrgRow {
  id: string;
  name: string;
  types: OrgType[];
  sectors: string[];
  stage: string | null;
  city: string | null;
  country: string | null;
  precision: 'address' | 'area' | 'city' | null;
  founded_year: number | null;
  is_active: boolean;
  website_domain: string | null;
  raised_usd: number;
  rounds: number;
  investors: number;
  portfolio: number;
  last_invested_on: string | null;
  participants: number;
  people: number;
  last_verified_at: string | null;
}

/** Every published organisation, fetched a page at a time. */
export async function fetchOrgRows(signal?: AbortSignal): Promise<OrgRow[]> {
  const rows: OrgRow[] = [];
  for (;;) {
    const page = await getJson<{ total: number; organisations: OrgRow[] }>(`/orgs?limit=500&offset=${rows.length}`, signal);
    rows.push(...page.organisations);
    if (rows.length >= page.total || page.organisations.length === 0) return rows;
  }
}

export const EDGE_KINDS = ['invested_in', 'accelerated_at', 'organised', 'has_role', 'located_in', 'in_sector'] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface GraphNode {
  /** Kind and key together: org:<id>, event:<id>, person:<id>, place:<country>/<city>, sector:<name>. */
  id: string;
  kind: 'organisation' | 'event' | 'person' | 'place' | 'sector';
  ref: string | null;
  name: string;
  types: OrgType[];
  sectors: string[];
  city: string | null;
  country: string | null;
  detail: string | null;
  degree: number;
  /** Neighbours the answer did not include. */
  hidden: number;
}

export interface GraphRound {
  id: string;
  stage: string | null;
  amount_usd: number | null;
  announced_on: string | null;
  announced_precision: 'day' | 'month' | 'year' | null;
  is_lead: boolean;
  source_url: string | null;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  label: string | null;
  rounds: GraphRound[];
}

export interface GraphAnswer {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated?: boolean;
}

export interface GraphPath extends GraphAnswer {
  found: boolean;
  length: number | null;
  searched_all: boolean;
}

interface GraphTie {
  organisation: Omit<GraphNode, 'degree' | 'hidden'>;
  shared: { id: string; name: string }[];
}

export interface CoInvestment {
  co_investors: GraphTie[];
  shared_investors: GraphTie[];
}

const kindsQuery = (kinds: readonly EdgeKind[]) => `kinds=${kinds.join(',')}`;

export const fetchGraphOverview = (kinds: readonly EdgeKind[], signal?: AbortSignal) =>
  getJson<GraphAnswer & { total_nodes: number }>(`/graph/overview?limit=300&${kindsQuery(kinds)}`, signal);

export const fetchNeighbourhood = (id: string, kinds: readonly EdgeKind[], signal?: AbortSignal) =>
  getJson<GraphAnswer>(`/graph/neighbourhood?id=${encodeURIComponent(id)}&limit=150&${kindsQuery(kinds)}`, signal);

export const expandNode = (id: string, known: string[], kinds: readonly EdgeKind[], signal?: AbortSignal) =>
  getJson<GraphAnswer & { remaining: number }>(`/graph/expand?${kindsQuery(kinds)}`, signal, {
    id,
    known: known.slice(0, 500),
    limit: 40,
  });

export const fetchPath = (from: string, to: string, kinds: readonly EdgeKind[], signal?: AbortSignal) =>
  getJson<GraphPath>(
    `/graph/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&${kindsQuery(kinds)}`,
    signal,
  );

export const fetchCoInvestment = (orgId: string, signal?: AbortSignal) =>
  getJson<CoInvestment>(`/graph/co-investment?id=${encodeURIComponent(orgId)}`, signal);

export const fetchMostConnected = (signal?: AbortSignal) =>
  getJson<{ organisations: GraphNode[] }>('/graph/top?limit=8', signal);
