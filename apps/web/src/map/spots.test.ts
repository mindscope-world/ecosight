import type { FeatureCollection, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import { distinctRecords, indexSpots, sharedSpots, spotKey } from './spots';

const at = (lon: number, lat: number, properties: Record<string, unknown>) => ({
  type: 'Feature' as const,
  geometry: { type: 'Point' as const, coordinates: [lon, lat] },
  properties,
});
const layer = (...features: ReturnType<typeof at>[]): FeatureCollection<Point> => ({ type: 'FeatureCollection', features });

// A startup and an investor in one building, a second startup next door, and
// an organisation of two kinds that is drawn on two layers.
const index = indexSpots([
  ['startups', layer(at(36.8, -1.26, { org_id: 's1', office_id: 'o1' }), at(36.81, -1.26, { org_id: 's2', office_id: 'o2' }))],
  ['investors', layer(at(36.8, -1.26, { org_id: 'i1', office_id: 'o3' }), at(36.9, -1.3, { org_id: 'both', office_id: 'o4' }))],
  ['accelerators', layer(at(36.9, -1.3, { org_id: 'both', office_id: 'o4' }))],
]);

describe('records that share a spot', () => {
  it('finds everything at one place across layers', () => {
    const here = index.bySpot.get(spotKey(36.8, -1.26))!;
    expect(here.map((record) => [record.layer, record.properties.org_id])).toEqual([
      ['startups', 's1'],
      ['investors', 'i1'],
    ]);
    expect(index.bySpot.get(spotKey(36.81, -1.26))).toHaveLength(1);
  });

  it('finds a marker by its layer and office', () => {
    expect(index.byMarker.get('investors|o3')).toMatchObject({ lon: 36.8, lat: -1.26 });
    expect(index.byMarker.get('startups|o3')).toBeUndefined();
  });

  it('badges only spots where different kinds overlap, with how many records are there', () => {
    const { features } = sharedSpots(index);
    expect(features).toHaveLength(1);
    expect(features[0]).toMatchObject({ geometry: { coordinates: [36.8, -1.26] }, properties: { count: 2 } });
  });

  it('counts an organisation on two layers once', () => {
    expect(distinctRecords(index.bySpot.get(spotKey(36.9, -1.3))!)).toHaveLength(1);
  });

  it('treats places a few metres apart as different spots', () => {
    expect(spotKey(36.8, -1.26)).not.toBe(spotKey(36.80002, -1.26));
    expect(spotKey(36.8, -1.26)).toBe(spotKey(36.8000001, -1.26));
  });
});
