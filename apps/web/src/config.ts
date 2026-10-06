import type { Theme } from './state/theme';

export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api';

/** One basemap style per theme. */
export const BASEMAP_STYLES: Record<Theme, string> = {
  light: import.meta.env.VITE_BASEMAP_STYLE ?? 'https://tiles.openfreemap.org/styles/positron',
  dark: import.meta.env.VITE_BASEMAP_STYLE_DARK ?? 'https://tiles.openfreemap.org/styles/dark',
};

/** Must be a font every basemap style's glyph endpoint serves. */
export const LABEL_FONT = 'Noto Sans Regular';

/** Nairobi, the MVP city. */
export const DEFAULT_CAMERA = { lon: 36.8, lat: -1.286, zoom: 11 } as const;
