import type { Camera } from '../map/adapter';

/**
 * Share-link state in the URL hash: camera, enabled layers, selected organisation.
 * Format: #c=<lat>,<lon>,<zoom>&l=<layer>,<layer>&s=<organisation id>
 * Unknown or malformed parts are dropped, never guessed at.
 */
export interface UrlState {
  camera?: Camera;
  layers?: string[];
  selected?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYER_ID = /^[a-z][a-z0-9-]*$/;

export function encodeUrlState(state: UrlState): string {
  const parts: string[] = [];
  if (state.camera) {
    const { lat, lon, zoom } = state.camera;
    parts.push(`c=${lat.toFixed(5)},${lon.toFixed(5)},${zoom.toFixed(2)}`);
  }
  if (state.layers) parts.push(`l=${state.layers.join(',')}`);
  if (state.selected) parts.push(`s=${state.selected}`);
  return parts.join('&');
}

export function decodeUrlState(hash: string): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state: UrlState = {};

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

  const selected = params.get('s');
  if (selected && UUID.test(selected)) state.selected = selected;

  return state;
}
