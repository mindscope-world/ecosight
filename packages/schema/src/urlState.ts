import { countActive, decodeFilters, encodeFilters, type Filters } from './filters';

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
}

export interface Selection {
  kind: 'org' | 'event';
  id: string;
}

/**
 * Share-link state in the URL hash: camera, enabled layers, selected record.
 * Format: #v=1&c=<lat>,<lon>,<zoom>&l=<layer>,<layer>&s=<organisation id>
 * with e=<event id> in place of s when an event is selected, p=<view> for a
 * lens other than the plain map, m=<map style> when it is not dark, and the
 * filter parts described in filters.ts.
 * Unknown or malformed parts are dropped, never guessed at.
 */
/** What the map and panels are focused on. These are lenses on one map, not pages. */
export const VIEWS = ['map', 'discover', 'ecosystems', 'investors', 'startups', 'events'] as const;
export type View = (typeof VIEWS)[number];

export const MAP_STYLES = ['dark', 'light', 'terrain'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export interface UrlState {
  /** The open lens. The plain map is the default and is left out of the link. */
  view?: View;
  mapStyle?: MapStyle;
  filters?: Filters;
  camera?: Camera;
  layers?: string[];
  selected?: Selection;
}

/** Raised when a part changes meaning; decode must then migrate older links. */
export const URL_STATE_VERSION = 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYER_ID = /^[a-z][a-z0-9-]*$/;

export function encodeUrlState(state: UrlState): string {
  const parts: string[] = [`v=${URL_STATE_VERSION}`];
  if (state.view && state.view !== 'map') parts.push(`p=${state.view}`);
  if (state.mapStyle && state.mapStyle !== 'dark') parts.push(`m=${state.mapStyle}`);
  if (state.camera) {
    const { lat, lon, zoom } = state.camera;
    parts.push(`c=${lat.toFixed(5)},${lon.toFixed(5)},${zoom.toFixed(2)}`);
  }
  if (state.layers) parts.push(`l=${state.layers.join(',')}`);
  if (state.selected)
    parts.push(`${state.selected.kind === 'event' ? 'e' : 's'}=${state.selected.id}`);
  if (state.filters) parts.push(...encodeFilters(state.filters));
  return parts.join('&');
}

export function decodeUrlState(hash: string): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state: UrlState = {};

  // Links made before versioning carry no v and are read as version 1. A link from
  // a newer version is not interpreted with today's rules.
  const version = params.get('v');
  if (version !== null && version !== String(URL_STATE_VERSION)) return state;

  const view = params.get('p');
  if (view !== 'map' && (VIEWS as readonly string[]).includes(view ?? '')) state.view = view as View;

  const mapStyle = params.get('m');
  if (mapStyle !== 'dark' && (MAP_STYLES as readonly string[]).includes(mapStyle ?? ''))
    state.mapStyle = mapStyle as MapStyle;

  const filters = decodeFilters(params);
  if (countActive(filters)) state.filters = filters;

  const camera = params.get('c')?.split(',').map(Number);
  if (camera?.length === 3) {
    const [lat, lon, zoom] = camera as [number, number, number];
    if (
      [lat, lon, zoom].every(Number.isFinite) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180 &&
      zoom >= 0 &&
      zoom <= 24
    )
      state.camera = { lat, lon, zoom };
  }

  const layers = params.get('l');
  if (layers !== null) state.layers = layers.split(',').filter((id) => LAYER_ID.test(id));

  const org = params.get('s');
  const event = params.get('e');
  if (org && UUID.test(org)) state.selected = { kind: 'org', id: org };
  else if (event && UUID.test(event)) state.selected = { kind: 'event', id: event };

  return state;
}
