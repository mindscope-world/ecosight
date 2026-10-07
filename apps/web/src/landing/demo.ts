import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { greatCircle } from '../lib/geo';

// Everything in this file is illustrative. It gives the landing page's maps a
// believable shape of the world's ecosystems; none of it is a record of a real
// organisation. Wherever real records exist (Nairobi today) the page shows those
// instead, and it says which is which.

export type PreviewKind = 'startup' | 'investor' | 'program' | 'event';

export const KINDS: { id: PreviewKind; label: string; color: string }[] = [
  { id: 'startup', label: 'Startups', color: '#22d3ee' },
  { id: 'investor', label: 'Investors', color: '#3b82f6' },
  { id: 'program', label: 'Programs', color: '#a5b4fc' },
  { id: 'event', label: 'Events', color: '#f8fafc' },
];

export interface Hub {
  name: string;
  lon: number;
  lat: number;
  /** Relative size of the cluster drawn there. */
  weight: number;
}

export const HUBS: Hub[] = [
  { name: 'Nairobi', lon: 36.82, lat: -1.29, weight: 9 },
  { name: 'Lagos', lon: 3.38, lat: 6.52, weight: 9 },
  { name: 'Cape Town', lon: 18.42, lat: -33.92, weight: 6 },
  { name: 'Johannesburg', lon: 28.05, lat: -26.2, weight: 6 },
  { name: 'Accra', lon: -0.19, lat: 5.6, weight: 5 },
  { name: 'Kigali', lon: 30.06, lat: -1.95, weight: 4 },
  { name: 'Cairo', lon: 31.24, lat: 30.04, weight: 7 },
  { name: 'London', lon: -0.13, lat: 51.51, weight: 9 },
  { name: 'Berlin', lon: 13.4, lat: 52.52, weight: 6 },
  { name: 'Paris', lon: 2.35, lat: 48.86, weight: 7 },
  { name: 'New York', lon: -74.01, lat: 40.71, weight: 9 },
  { name: 'San Francisco', lon: -122.42, lat: 37.77, weight: 10 },
  { name: 'Toronto', lon: -79.38, lat: 43.65, weight: 5 },
  { name: 'Singapore', lon: 103.82, lat: 1.35, weight: 7 },
  { name: 'Bangalore', lon: 77.59, lat: 12.97, weight: 8 },
  // Smaller clusters, so the map reads as a world and not fifteen dots.
  { name: 'São Paulo', lon: -46.63, lat: -23.55, weight: 5 },
  { name: 'Mexico City', lon: -99.13, lat: 19.43, weight: 3 },
  { name: 'Bogotá', lon: -74.07, lat: 4.71, weight: 2 },
  { name: 'Dubai', lon: 55.27, lat: 25.2, weight: 4 },
  { name: 'Tel Aviv', lon: 34.78, lat: 32.08, weight: 4 },
  { name: 'Addis Ababa', lon: 38.75, lat: 9.03, weight: 2 },
  { name: 'Kampala', lon: 32.58, lat: 0.35, weight: 3 },
  { name: 'Dar es Salaam', lon: 39.28, lat: -6.79, weight: 2 },
  { name: 'Dakar', lon: -17.47, lat: 14.72, weight: 2 },
  { name: 'Tunis', lon: 10.18, lat: 36.81, weight: 2 },
  { name: 'Stockholm', lon: 18.07, lat: 59.33, weight: 3 },
  { name: 'Jakarta', lon: 106.85, lat: -6.21, weight: 4 },
  { name: 'Tokyo', lon: 139.69, lat: 35.69, weight: 4 },
  { name: 'Sydney', lon: 151.21, lat: -33.87, weight: 3 },
];

/** A small seeded generator, so the same points are drawn on every visit. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KIND_SHARES: [PreviewKind, number][] = [
  ['startup', 0.62],
  ['investor', 0.16],
  ['program', 0.12],
  ['event', 0.1],
];

/** Points gathered round each hub: dense at the centre, thinning outward. */
export function illustrativePoints(except: string[] = []): FeatureCollection<Point, { kind: PreviewKind; hub: string }> {
  const random = seeded(20261007);
  const features: Feature<Point, { kind: PreviewKind; hub: string }>[] = [];
  for (const hub of HUBS) {
    const count = hub.weight * 9;
    for (let i = 0; i < count; i++) {
      // Two uniform draws give a bell-shaped spread without a normal generator.
      const distance = (random() + random()) * 0.75 * (0.6 + hub.weight / 12);
      const angle = random() * Math.PI * 2;
      let roll = random();
      const kind = KIND_SHARES.find(([, share]) => (roll -= share) < 0)?.[0] ?? 'startup';
      if (except.includes(hub.name)) continue;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            hub.lon + (Math.cos(angle) * distance) / Math.cos((hub.lat * Math.PI) / 180),
            hub.lat + Math.sin(angle) * distance,
          ],
        },
        properties: { kind, hub: hub.name },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function hubPoints(): FeatureCollection<Point, { name: string; weight: number }> {
  return {
    type: 'FeatureCollection',
    features: HUBS.filter((hub) => hub.weight >= 5).map((hub) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [hub.lon, hub.lat] },
      properties: { name: hub.name, weight: hub.weight },
    })),
  };
}

const LINKS: [string, string][] = [
  ['Nairobi', 'London'],
  ['Nairobi', 'San Francisco'],
  ['Nairobi', 'Lagos'],
  ['Nairobi', 'Kigali'],
  ['Nairobi', 'Singapore'],
  ['Lagos', 'New York'],
  ['Lagos', 'London'],
  ['Cape Town', 'Berlin'],
  ['Johannesburg', 'Paris'],
  ['Cairo', 'Dubai'],
  ['Accra', 'Toronto'],
  ['Bangalore', 'San Francisco'],
  ['Bangalore', 'Singapore'],
  ['São Paulo', 'New York'],
];

export function connectionLines(): FeatureCollection<LineString> {
  const byName = new Map(HUBS.map((hub) => [hub.name, hub]));
  const arc = (from: Hub, to: Hub) => greatCircle([from.lon, from.lat], [to.lon, to.lat]);
  return {
    type: 'FeatureCollection',
    features: LINKS.map(([from, to]) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: arc(byName.get(from)!, byName.get(to)!) },
      properties: {},
    })),
  };
}
