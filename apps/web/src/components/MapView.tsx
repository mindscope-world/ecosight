import type { Camera } from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import { useEffect, useRef, type RefObject } from 'react';
import type { Basemap } from '../config';
import { HEAT_LAYERS, POINT_LAYERS } from '../entities';
import type { Area, DrawMode, MapAdapter, PickedRecord } from '../map/adapter';
import { hoverCard } from '../map/hoverCard';
import { MapLibreAdapter } from '../map/maplibreAdapter';

/**
 * The map. It owns the adapter and keeps it in step with the props: basemap,
 * each layer's records and which layers are shown.
 */
export function MapView({
  adapter,
  basemap,
  initialCamera,
  data,
  enabled,
  selectedPlaces,
  area,
  drawMode,
  onDrawn,
  onPick,
  onCamera,
  onReady,
}: {
  /** Filled once the map exists, for the camera moves the rest of the app makes. */
  adapter: RefObject<MapAdapter | null>;
  basemap: Basemap;
  initialCamera: Camera;
  /** Records per point layer, already filtered. */
  data: Record<string, FeatureCollection<Point>>;
  enabled: ReadonlySet<string>;
  /** Where the selected record is drawn, to ring it. Empty when nothing is selected or it is not in view. */
  selectedPlaces: [number, number][];
  /** The area the filters are limited to, outlined on the map. */
  area: Area | null;
  /** When set, the pointer draws an area of this kind; `onDrawn` gets it, or null if drawing was cancelled. */
  drawMode: DrawMode | null;
  onDrawn: (area: Area | null) => void;
  /** Markers were clicked: every record at that spot, on any visible layer. */
  onPick: (records: PickedRecord[]) => void;
  onCamera: () => void;
  /** Called once, when the map can first be drawn on. */
  onReady: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // The map is created once; these keep its listeners pointed at the latest props.
  const latest = useRef({ onPick, onCamera, onReady, data, enabled, basemap, selectedPlaces, area, drawMode, onDrawn });
  latest.current = { onPick, onCamera, onReady, data, enabled, basemap, selectedPlaces, area, drawMode, onDrawn };
  const applied = useRef(basemap);

  useEffect(() => {
    const map = new MapLibreAdapter(container.current!, {
      basemap: applied.current,
      camera: initialCamera,
    });
    let alive = true;
    void map.whenReady().then(() => {
      if (!alive) return;
      // Heatmaps first, so markers are drawn over them.
      for (const layer of HEAT_LAYERS) map.addHeatLayer({ id: layer.id, weight: layer.weight, ramp: layer.ramp });
      for (const layer of POINT_LAYERS) map.addPointLayer({ id: layer.id, color: layer.color, shape: layer.shape });
      map.onPick((records) => latest.current.onPick(records));
      map.onHover(hoverCard);
      adapter.current = map;
      // In development the map can be asked what it has drawn, which is how the browser tests check it.
      if (import.meta.env.DEV) (window as unknown as { __ecosightMap?: MapLibreAdapter }).__ecosightMap = map;
      // The style may have been changed while the first one was still loading.
      if (latest.current.basemap !== applied.current) {
        applied.current = latest.current.basemap;
        map.setBasemap(applied.current);
      }
      push(map, latest.current.data, latest.current.enabled);
      map.setHighlight(latest.current.selectedPlaces);
      map.setArea(latest.current.area);
      if (latest.current.drawMode) map.startDraw(latest.current.drawMode, (drawn) => latest.current.onDrawn(drawn));
      map.onCameraChange(() => latest.current.onCamera());
      latest.current.onReady();
    });
    return () => {
      alive = false;
      adapter.current = null;
      map.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (adapter.current) push(adapter.current, data, enabled);
  }, [adapter, data, enabled]);

  useEffect(() => {
    adapter.current?.setHighlight(selectedPlaces);
  }, [adapter, selectedPlaces]);

  useEffect(() => {
    adapter.current?.setArea(area);
  }, [adapter, area]);

  useEffect(() => {
    const map = adapter.current;
    if (!map) return;
    if (drawMode) map.startDraw(drawMode, (drawn) => latest.current.onDrawn(drawn));
    else map.cancelDraw();
  }, [adapter, drawMode]);

  useEffect(() => {
    if (!adapter.current || applied.current === basemap) return;
    applied.current = basemap;
    adapter.current.setBasemap(basemap);
  }, [adapter, basemap]);

  // MapLibre sets its own positioning on the container, so the sizing goes on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" aria-label="Map of the ecosystem" />
    </div>
  );
}

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

function push(map: MapAdapter, data: Record<string, FeatureCollection<Point>>, enabled: ReadonlySet<string>) {
  for (const layer of POINT_LAYERS) {
    map.setData(layer.id, data[layer.id] ?? EMPTY);
    map.setVisible(layer.id, enabled.has(layer.id));
  }
  for (const layer of HEAT_LAYERS) {
    // A record with no public address is drawn at its city's centre. Dozens of
    // them on one point would read as the densest place on the map, so the
    // heatmaps count only records whose position means something.
    const located = (data[layer.source] ?? EMPTY).features.filter(
      (feature) => feature.properties?.precision !== 'city',
    );
    map.setData(layer.id, { type: 'FeatureCollection', features: located });
    map.setVisible(layer.id, enabled.has(layer.id));
  }
}
