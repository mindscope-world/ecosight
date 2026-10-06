import type { FeatureCollection, Point } from 'geojson';
import { API_URL } from './config';

export type OrgType = 'startup' | 'fund' | 'angel_network' | 'ngo' | 'accelerator' | 'corporate';

export interface OfficeProperties {
  office_id: string;
  org_id: string;
  name: string;
  primary_type: OrgType;
  sector: string | null;
  stage: string | null;
  is_hq: boolean;
  valid_from: string | null;
}

export type OfficeCollection = FeatureCollection<Point, OfficeProperties>;

export interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  types: OrgType[];
  sectors: string[];
  stage: string | null;
  website_domain: string | null;
  description: string | null;
  offices: {
    id: string;
    is_hq: boolean;
    address: string | null;
    city: string;
    country: string;
    precision: 'address' | 'city';
    lon: number;
    lat: number;
  }[];
  sources: {
    field: string;
    source_url: string | null;
    method: 'manual' | 'partner' | 'ai';
    verified_at: string | null;
  }[];
  last_verified_at: string | null;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API_URL + path, { signal });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchOffices = (type: OrgType, signal?: AbortSignal) =>
  getJson<OfficeCollection>(`/layers/offices.geojson?type=${type}`, signal);

export const fetchOrg = (id: string, signal?: AbortSignal) =>
  getJson<OrgDetail>(`/orgs/${encodeURIComponent(id)}`, signal);
