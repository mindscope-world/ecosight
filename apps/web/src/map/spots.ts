import type { FeatureCollection, Point } from 'geojson';

/** One record as a layer draws it: which layer, where, and what it is. */
export interface Placed {
  layer: string;
  lon: number;
  lat: number;
  properties: Record<string, unknown>;
}

/** The same spot to within about ten centimetres, which is how records at one address are stored. */
export const spotKey = (lon: number, lat: number) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

/** What a record is, whichever of its offices or layers it is seen through. */
export const recordId = (properties: Record<string, unknown>) => String(properties.org_id ?? properties.event_id ?? '');

/** The marker a record is drawn as: one per office, or per event. */
export const markerId = (properties: Record<string, unknown>) => String(properties.office_id ?? properties.event_id ?? '');

export interface SpotIndex {
  /** Every record drawn at each spot, across layers. */
  bySpot: Map<string, Placed[]>;
  /** Each marker, by layer and marker id. */
  byMarker: Map<string, Placed>;
}

export function indexSpots(layers: Iterable<[layer: string, data: FeatureCollection<Point>]>): SpotIndex {
  const bySpot = new Map<string, Placed[]>();
  const byMarker = new Map<string, Placed>();
  for (const [layer, data] of layers)
    for (const feature of data.features) {
      const [lon, lat] = feature.geometry.coordinates as [number, number];
      const placed: Placed = { layer, lon, lat, properties: feature.properties ?? {} };
      const key = spotKey(lon, lat);
      (bySpot.get(key) ?? bySpot.set(key, []).get(key)!).push(placed);
      byMarker.set(`${layer}|${markerId(placed.properties)}`, placed);
    }
  return { bySpot, byMarker };
}

/** Without repeats: an organisation of two kinds is on two layers, and is still one record. */
export function distinctRecords(records: Placed[]): Placed[] {
  const seen = new Map<string, Placed>();
  for (const record of records) {
    const id = recordId(record.properties);
    if (id && !seen.has(id)) seen.set(id, record);
  }
  return [...seen.values()];
}

/**
 * Spots where markers of different layers sit exactly on top of one another,
 * each with how many records are there. Records of one layer on one spot are
 * not listed: that layer already shows them as a counted cluster.
 */
export function sharedSpots(index: SpotIndex): FeatureCollection<Point> {
  const features: FeatureCollection<Point>['features'] = [];
  for (const records of index.bySpot.values()) {
    if (new Set(records.map((record) => record.layer)).size < 2) continue;
    const count = distinctRecords(records).length;
    if (count < 2) continue;
    const { lon, lat } = records[0]!;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { count } });
  }
  return { type: 'FeatureCollection', features };
}
