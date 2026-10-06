import type { FeatureCollection, Point } from 'geojson';
import { useEffect, useMemo, useState } from 'react';
import { fetchEvents, fetchOffices, fetchStats, type OfficeCollection, type Stats } from '../api';
import { layerForTypes } from '../entities';
import { illustrativePoints, type PreviewKind } from './demo';

/** Real records a city needs before its illustrative cluster is dropped. */
const COVERED_FROM = 10;

const LAYER_KIND: Record<string, PreviewKind> = {
  startups: 'startup',
  investors: 'investor',
  accelerators: 'program',
  hubs: 'program',
};

export interface LandingData {
  /** Real records where they exist, illustrative points everywhere else. */
  points: FeatureCollection<Point, { kind: PreviewKind }>;
  /** Real records only. */
  real: FeatureCollection<Point, { kind: PreviewKind }>;
  offices: OfficeCollection | null;
  stats: Stats | null;
  /** True once real records are in `points`. */
  live: boolean;
  /** The city with the most real records, which is the one the page talks about by name. */
  city: { name: string; offices: OfficeCollection['features']; organisations: number } | null;
}

/**
 * The landing page shows the product's own records wherever it has them. If they
 * cannot be loaded the page still works, on illustrative points alone, and every
 * place that would have shown a real figure says it is showing an example.
 */
export function useLandingData(): LandingData {
  const [offices, setOffices] = useState<OfficeCollection | null>(null);
  const [events, setEvents] = useState<FeatureCollection<Point> | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Each is optional on this page, so one failing does not hold back the others.
    fetchOffices(controller.signal).then(setOffices, () => {});
    fetchEvents(controller.signal).then(setEvents, () => {});
    fetchStats(controller.signal).then(setStats, () => {});
    return () => controller.abort();
  }, []);

  return useMemo(() => {
    const real: LandingData['real'] = { type: 'FeatureCollection', features: [] };
    for (const feature of offices?.features ?? []) {
      const kind = LAYER_KIND[layerForTypes(feature.properties.types)?.id ?? ''];
      if (kind) real.features.push({ type: 'Feature', geometry: feature.geometry, properties: { kind } });
    }
    for (const feature of events?.features ?? [])
      real.features.push({ type: 'Feature', geometry: feature.geometry, properties: { kind: 'event' } });

    const live = real.features.length > 0;
    const byCity = new Map<string, OfficeCollection['features']>();
    for (const feature of offices?.features ?? [])
      byCity.set(feature.properties.city, [...(byCity.get(feature.properties.city) ?? []), feature]);
    const [name, inCity] = [...byCity].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    // A city's illustrative cluster gives way once it has real coverage. One or two
    // real records there do not: those are drawn on top of the illustration.
    const covered = [...byCity].filter(([, features]) => features.length >= COVERED_FROM).map(([city]) => city);
    const illustrative = illustrativePoints(covered);
    return {
      points: { type: 'FeatureCollection', features: [...illustrative.features, ...real.features] },
      real,
      offices,
      stats,
      live,
      city:
        name && inCity
          ? { name, offices: inCity, organisations: new Set(inCity.map((f) => f.properties.org_id)).size }
          : null,
    };
  }, [offices, events, stats]);
}
