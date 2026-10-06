import type { MapStyle } from '@atlas/schema';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api';

/** Shown in the status bar until the real dataset replaces the synthetic sample. */
export const DEMO_DATA: boolean = (import.meta.env.VITE_DEMO_DATA ?? 'true') !== 'false';

export interface Basemap {
  url: string;
  /** Recolour a grey style into the app's navy palette. */
  tint: boolean;
  /** Draw relief shading from open elevation tiles over the style. */
  hillshade: boolean;
}

const DARK: string =
  import.meta.env.VITE_BASEMAP_STYLE_DARK ?? 'https://tiles.openfreemap.org/styles/dark';
const LIGHT: string =
  import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron';

export const BASEMAPS: Record<MapStyle, Basemap> = {
  dark: { url: DARK, tint: true, hillshade: false },
  light: { url: LIGHT, tint: false, hillshade: false },
  terrain: { url: DARK, tint: true, hillshade: true },
};

/** Mapzen terrain tiles on AWS Open Data: free to use with attribution. */
export const ELEVATION_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Must be a font every basemap style's glyph endpoint serves. */
export const LABEL_FONT = 'Noto Sans Regular';

/** Nairobi, the first city covered. */
export const DEFAULT_CAMERA = { lon: 36.8, lat: -1.286, zoom: 11 } as const;
