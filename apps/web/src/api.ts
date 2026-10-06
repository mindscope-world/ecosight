import type { Filterable } from '@atlas/schema';
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
  types: OrgType[];
  sector: string | null;
  is_hq: boolean;
  precision: 'address' | 'area' | 'city';
  country: string;
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
    verified_at: string | null;
  }[];
  last_verified_at: string | null;
}

export interface EventProperties {
  event_id: string;
  name: string;
  venue: string | null;
  starts_at: string;
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
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API_URL + path, { signal });
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
