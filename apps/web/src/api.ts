import { encodeFilters, type Filterable, type FilterableEvent, type Filters } from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import { bearer } from './auth';
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
  /** The organisation's own logo as a data URL, or null when none is held. */
  logo: string | null;
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
    /** `outgoing` is true when this organisation is the one that is part of, hosted by, and so on. */
    affiliations: { kind: string; outgoing: boolean; label: string | null; organisation: OrgLink }[];
    people: { name: string; role: string; linkedin_url: string | null }[];
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

/**
 * Raised when the API will not answer: it wants an access key or a sign-in and
 * has neither, or the address that signed in has not been given access.
 */
export class AccessError extends Error {
  constructor(
    message: string,
    /** True when a sign-in was good but its address is not on the list. */
    readonly denied = false,
  ) {
    super(message);
  }
}

/** Raised for any other refusal, with what the API said about it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string | null,
  ) {
    super(message);
  }
}

/** Whether the last refusal was of a signed-in address that is not on the list. */
export let accessDenied = false;

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
  const token = await bearer();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API_URL + path, {
    signal,
    headers,
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 || res.status === 403) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? null;
    // The review queue answers 401 and 403 too, for its own reasons; those are the page's to explain.
    if (path.startsWith('/review/')) throw new ApiError(`${path} responded ${res.status}`, res.status, detail);
    accessDenied = res.status === 403;
    throw new AccessError(detail ?? 'An access key is required', accessDenied);
  }
  if (!res.ok) {
    const detail = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? null;
    throw new ApiError(`${path} responded ${res.status}`, res.status, detail);
  }
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
  added_on: string;
  last_round_on: string | null;
  last_program_on: string | null;
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

export const LINK_KINDS = ['part_of', 'hosted_by', 'member_of', 'founded_by', 'funded_by', 'partner_of'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const EDGE_KINDS = ['invested_in', 'accelerated_at', 'organised', ...LINK_KINDS, 'has_role', 'located_in', 'in_sector'] as const;
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
  /** What a tie between organisations, or a place on a programme, was read from. */
  evidence: { source_url: string | null; quote: string | null }[];
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

export interface Me {
  /** The address that signed in. Null when the reader came in with the shared access key. */
  email: string | null;
  /** Null when nobody signed in, and when the address that did is not on the list of users. */
  role: 'viewer' | 'reviewer' | 'admin' | null;
}

let me: Promise<Me> | null = null;
/** Who the API takes the reader to be. Asked once a page; several parts of the page share the answer. */
export const fetchMe = () => (me ??= getJson<Me>('/me'));

export interface ReviewItem {
  id: string;
  kind: 'organisation' | 'relationship' | 'other';
  status: 'pending' | 'approved' | 'rejected' | 'archived';
  reason: string | null;
  note: string | null;
  source: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  organisation: {
    id: string;
    name: string;
    types: OrgType[];
    sectors: string[];
    stage: string | null;
    description: string | null;
    website_domain: string | null;
    status: string;
    city: string | null;
    country: string | null;
    sources: number;
  } | null;
  proposal: {
    kind: string | null;
    from: string | null;
    to: string | null;
    label: string | null;
    source_url: string | null;
    quote: string | null;
    from_match: OrgLink | null;
    to_match: OrgLink | null;
  } | null;
}

export interface ReviewList {
  pending: number;
  /** Set aside as incomplete or unverified. */
  archived: number;
  /** Approved or rejected by a reviewer. */
  settled: number;
  items: ReviewItem[];
}

export const fetchReview = (status: 'pending' | 'archived' | 'settled', signal?: AbortSignal) =>
  getJson<ReviewList>(`/review/items?status=${status}`, signal);

export const settleReview = (
  id: string,
  action: 'approve' | 'reject' | 'archive' | 'reopen',
  body: { from_id?: string; to_id?: string; source_url?: string; note?: string } = {},
) => getJson<ReviewItem>(`/review/items/${id}/${action}`, undefined, body);

/** A relationship a reviewer has taken down for everyone. */
export interface WithdrawnEdge {
  kind: string;
  source: { id: string; name: string };
  target: { id: string; name: string };
  reason: string;
  withdrawn_at: string;
  withdrawn_by: string | null;
}
type EdgeRef = { kind: string; source: string; target: string };

export const fetchWithdrawn = (signal?: AbortSignal) =>
  getJson<{ withdrawn: WithdrawnEdge[] }>('/review/withdrawn', signal).then((answer) => answer.withdrawn);
/** Take a published relationship down for everyone. Reviewers only. */
export const withdrawEdge = (edge: EdgeRef & { reason: string }) =>
  getJson<{ withdrawn: WithdrawnEdge[] }>('/review/withdrawn', undefined, edge).then((answer) => answer.withdrawn);
export const restoreEdge = (edge: EdgeRef) =>
  getJson<{ withdrawn: WithdrawnEdge[] }>('/review/withdrawn/restore', undefined, edge).then((answer) => answer.withdrawn);

export interface SavedView {
  id: string;
  name: string;
  page: 'map' | 'graph' | 'dashboard';
  /** The view's share-link state, without the leading #. */
  state: string;
  created_at: string;
}

export const fetchSaved = () => getJson<{ views: SavedView[] }>('/me/saved').then((answer) => answer.views);
export const saveView = (view: Pick<SavedView, 'name' | 'page' | 'state'>) => getJson<SavedView>('/me/saved', undefined, view);
export async function removeSaved(id: string): Promise<void> {
  const token = await bearer();
  const key = storedAccessKey();
  await fetch(`${API_URL}/me/saved/${id}`, {
    method: 'DELETE',
    headers: { ...(key ? { 'x-access-key': key } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

export interface Notifications {
  total: number;
  items: { kind: 'organisation' | 'round'; organisation_id: string; label: string; detail: string | null; at: string }[];
  /** Items waiting in the review queue. Null for anyone who is not a reviewer. */
  waiting_review: number | null;
}

export const fetchNotifications = (since: string | null) =>
  getJson<Notifications>(`/notifications${since ? `?since=${encodeURIComponent(since)}` : ''}`);
