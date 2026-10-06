import type { View } from '@atlas/schema';
import type { OrgType } from './api';

export type Shape =
  | 'circle'
  | 'diamond'
  | 'square'
  | 'pin'
  | 'cross'
  | 'hub'
  | 'building'
  | 'triangle';

/** Outlines on a 24 by 24 grid, used for map markers and for the legend alike. */
export const SHAPE_PATHS: Record<Shape, string> = {
  circle: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z',
  diamond: 'M12 2.5 21.5 12 12 21.5 2.5 12z',
  square: 'M5 5h14v14H5z',
  pin: 'M12 2.5a7 7 0 0 0-7 7c0 5 7 12 7 12s7-7 7-12a7 7 0 0 0-7-7z',
  cross: 'M9 3.5h6V9h5.5v6H15v5.5H9V15H3.5V9H9z',
  hub: 'M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5z',
  building: 'M12 2.5 21 8v2.5h-2V19h2v2.5H3V19h2v-8.5H3V8z',
  triangle: 'M12 3.5 21.5 20h-19z',
};

export interface PointLayerDef {
  kind: 'points';
  id: string;
  label: string;
  /** Singular, for a selected record. */
  noun: string;
  /** Organisation types shown on this layer; empty for the events layer. */
  types: OrgType[];
  color: string;
  shape: Shape;
  defaultOn: boolean;
}

export interface HeatLayerDef {
  kind: 'heat';
  id: string;
  label: string;
  /** Which point layer's records feed the heatmap. */
  source: string;
  /** Property that sets a point's weight; every point counts the same without it. */
  weight?: { property: string; max: number };
  defaultOn: false;
}

export type LayerDef = PointLayerDef | HeatLayerDef;

// Six hues in the order checked for colour-blind separation on the dark surface.
// Kinds that share a hue differ by shape, so colour is never the only signal.
const BLUE = '#3987e5';
const ORANGE = '#d95926';
const AQUA = '#199e70';
const YELLOW = '#c98500';
const MAGENTA = '#d55181';
const VIOLET = '#9085e9';

export const LAYERS: LayerDef[] = [
  { kind: 'points', id: 'startups', label: 'Startups', noun: 'Startup', types: ['startup'], color: BLUE, shape: 'circle', defaultOn: true },
  { kind: 'points', id: 'investors', label: 'Investors', noun: 'Investor', types: ['fund', 'angel_network'], color: ORANGE, shape: 'diamond', defaultOn: true },
  { kind: 'points', id: 'accelerators', label: 'Accelerators', noun: 'Accelerator', types: ['accelerator', 'incubator'], color: AQUA, shape: 'square', defaultOn: true },
  { kind: 'points', id: 'events', label: 'Events', noun: 'Event', types: [], color: MAGENTA, shape: 'pin', defaultOn: true },
  { kind: 'points', id: 'ngos', label: 'NGOs', noun: 'NGO', types: ['ngo', 'development_funder'], color: YELLOW, shape: 'cross', defaultOn: true },
  { kind: 'points', id: 'hubs', label: 'Innovation hubs', noun: 'Innovation hub', types: ['innovation_hub'], color: VIOLET, shape: 'hub', defaultOn: true },
  { kind: 'points', id: 'universities', label: 'Universities', noun: 'University', types: ['university'], color: VIOLET, shape: 'building', defaultOn: false },
  { kind: 'points', id: 'government', label: 'Government', noun: 'Government program', types: ['government_program'], color: VIOLET, shape: 'triangle', defaultOn: false },
  { kind: 'heat', id: 'funding-heat', label: 'Funding heatmap', source: 'startups', weight: { property: 'raised_usd', max: 5_000_000 }, defaultOn: false },
  { kind: 'heat', id: 'density', label: 'Startup density', source: 'startups', defaultOn: false },
];

export const POINT_LAYERS = LAYERS.filter((layer): layer is PointLayerDef => layer.kind === 'points');
export const HEAT_LAYERS = LAYERS.filter((layer): layer is HeatLayerDef => layer.kind === 'heat');
export const DEFAULT_LAYER_IDS = LAYERS.filter((layer) => layer.defaultOn).map((layer) => layer.id);

/** The layer an organisation is drawn on, from its first matching type. */
export function layerForTypes(types: readonly string[]): PointLayerDef | undefined {
  return POINT_LAYERS.find((layer) => layer.types.some((type) => types.includes(type)));
}

export const TYPE_LABELS: Record<string, string> = {
  startup: 'Startup',
  fund: 'Investor',
  angel_network: 'Angel network',
  ngo: 'NGO',
  accelerator: 'Accelerator',
  corporate: 'Corporate',
  incubator: 'Incubator',
  development_funder: 'Development funder',
  innovation_hub: 'Innovation hub',
  university: 'University',
  government_program: 'Government program',
};

/** Top-navigation lenses: which layers each one turns on. */
export const VIEW_LABELS: Record<View, string> = {
  map: 'Map',
  discover: 'Discover',
  ecosystems: 'Ecosystems',
  investors: 'Investors',
  startups: 'Startups',
  events: 'Events',
};

export const VIEW_LAYERS: Record<View, string[]> = {
  map: DEFAULT_LAYER_IDS,
  discover: POINT_LAYERS.map((layer) => layer.id),
  ecosystems: ['startups', 'density'],
  investors: ['investors'],
  startups: ['startups'],
  events: ['events'],
};
