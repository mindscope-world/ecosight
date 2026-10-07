import type { FeatureCollection, Point } from 'geojson';
import type { LandingData } from '../data';
import { KINDS, type PreviewKind } from '../demo';
import { MapCanvas } from '../MapCanvas';

const COLORS = Object.fromEntries(KINDS.map((kind) => [kind.id, kind.color]));
const NAIROBI: [number, number] = [36.82, -1.29];

export interface MapView {
  center: [number, number];
  zoom: number;
}

/**
 * Where to look to see one city: the city the page has most real records for,
 * close enough to tell streets apart. Without real records, the illustrative
 * cluster round Nairobi, which is spread wide and so is seen from further off.
 */
export function cityView(data: LandingData): MapView {
  const offices = data.city?.offices ?? [];
  if (!offices.length) return { center: NAIROBI, zoom: 6.4 };
  const mean = (at: 0 | 1) => offices.reduce((sum, feature) => sum + feature.geometry.coordinates[at]!, 0) / offices.length;
  return { center: [mean(0), mean(1)], zoom: 10.6 };
}

/**
 * A real map in one of the page's sections: the product's own records where
 * they could be loaded, illustrative points otherwise. It can be dragged and
 * zoomed with its buttons; the page's own scrolling is left alone.
 */
export function SectionMap({
  label,
  view,
  points,
  hubs,
  kinds,
  labels = false,
}: {
  label: string;
  view: MapView;
  points: FeatureCollection<Point>;
  /** Places marked with a pulsing ring. */
  hubs?: FeatureCollection<Point>;
  /** Kinds of record shown; all when not given. */
  kinds?: PreviewKind[] | null;
  /** Place names and roads, for views close enough to need them. Fixed when the map is first drawn. */
  labels?: boolean;
}) {
  return (
    <MapCanvas
      className="aspect-[100/62] w-full overflow-hidden rounded-lg bg-bg"
      label={label}
      options={{ center: view.center, zoom: view.zoom, labels, colors: COLORS, interactive: true }}
      points={points}
      hubs={hubs}
      kinds={kinds}
      view={view}
    />
  );
}

/** What the points on a section's map are, in a few words under it. */
export const pointsNote = (data: LandingData) =>
  data.live ? 'Records from the live map, with illustrative points where there are none yet.' : 'Points are illustrative.';
