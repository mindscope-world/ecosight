import type { FeatureCollection, LineString, Point } from 'geojson';
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which no longer holds once
// the library is bundled, so the worker is built as its own asset and named here.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ELEVATION_TILES, LABEL_FONT, type Basemap } from '../config';
import { SHAPE_PATHS } from '../entities';
import type { Camera, HeatLayerSpec, MapAdapter, PickedRecord, PointLayerSpec } from './adapter';
import { distinctRecords, indexSpots, markerId, sharedSpots, spotKey, type Placed, type SpotIndex } from './spots';
import { tintStyle } from './tint';

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const POINT_SUFFIXES = ['clusters', 'cluster-count', 'points'];
const ICON_PIXELS = 48;
const LINKS = 'links';
const SHARED = 'shared-spots';
// How far from the pointer, in pixels, a marker still counts as clicked.
const CLICK_REACH = 5;
// Past this zoom a cluster is records on the same spot: zooming will not part them.
const STACK_ZOOM = 17;
const STACK_LIMIT = 500;

type LayerState = { data: FeatureCollection<Point>; visible: boolean } & (
  | { kind: 'points'; spec: PointLayerSpec }
  | { kind: 'heat'; spec: HeatLayerSpec }
);

/** "#155e75" as the same colour fully transparent, so a ramp can fade in without a grey fringe. */
function transparent(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r},${g},${b},0)`;
}

/** A marker image: the shape filled with the layer colour, ringed in the map background. */
function markerImage(spec: PointLayerSpec): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_PIXELS;
  const context = canvas.getContext('2d')!;
  context.scale(ICON_PIXELS / 24, ICON_PIXELS / 24);
  const path = new Path2D(SHAPE_PATHS[spec.shape]);
  context.lineJoin = 'round';
  context.lineWidth = 3;
  context.strokeStyle = '#071018';
  context.stroke(path);
  context.fillStyle = spec.color;
  context.fill(path);
  return context.getImageData(0, 0, ICON_PIXELS, ICON_PIXELS);
}

export class MapLibreAdapter implements MapAdapter {
  private readonly map: MapLibreMap;
  private readonly ready: Promise<void>;
  /** What each layer shows, kept so it can be redrawn on a new basemap. */
  private readonly layers = new Map<string, LayerState>();
  private links: [number, number][][] = [];
  private spots: SpotIndex = { bySpot: new Map(), byMarker: new Map() };
  private pickListener: (records: PickedRecord[]) => void = () => {};
  private styleReady = false;
  private basemap: Basemap;

  constructor(container: HTMLElement, options: { basemap: Basemap; camera: Camera }) {
    this.basemap = options.basemap;
    this.map = new MapLibreMap({
      container,
      center: [options.camera.lon, options.camera.lat],
      zoom: options.camera.zoom,
      attributionControl: { compact: true },
    });
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-right');
    this.ready = new Promise((resolve) => this.map.once('load', () => resolve()));
    // A new basemap style replaces every source, layer and image, ours included.
    this.map.on('style.load', () => {
      this.styleReady = true;
      if (this.basemap.hillshade) this.drawHillshade();
      for (const id of this.layers.keys()) this.draw(id);
      this.drawLinks();
      this.drawShared();
    });
    // One listener for every layer. A listener per layer would each answer for
    // its own marker, and the last to answer would hide the others.
    this.map.on('click', (event) => void this.pick(event.point.x, event.point.y));
    this.setBasemap(options.basemap);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  setBasemap(basemap: Basemap): void {
    this.basemap = basemap;
    this.styleReady = false;
    this.map.setStyle(basemap.url, {
      diff: false,
      transformStyle: (_previous, next) =>
        basemap.tint ? (tintStyle(next) as StyleSpecification) : next,
    });
  }

  private drawHillshade(): void {
    const map = this.map;
    if (map.getSource('elevation')) return;
    map.addSource('elevation', {
      type: 'raster-dem',
      tiles: [ELEVATION_TILES],
      tileSize: 256,
      encoding: 'terrarium',
      maxzoom: 14,
      attribution: 'Elevation: Mapzen, AWS Open Data',
    });
    // Under roads and labels, over land and water.
    const above = map.getStyle().layers.find((layer) => layer.type === 'line')?.id;
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'elevation',
        paint: {
          'hillshade-exaggeration': 0.6,
          'hillshade-shadow-color': '#02070b',
          'hillshade-highlight-color': '#5d7f99',
          'hillshade-accent-color': '#0b2233',
        },
      },
      above,
    );
  }

  addPointLayer(spec: PointLayerSpec): void {
    const map = this.map;
    const { id } = spec;
    this.layers.set(id, { kind: 'points', spec, data: EMPTY, visible: true });
    this.draw(id);

    // Listeners are tied to layer ids, so they outlive a basemap change.
    for (const layer of [`${id}-points`, `${id}-clusters`]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }

  onPick(listener: (records: PickedRecord[]) => void): void {
    this.pickListener = listener;
  }

  /**
   * What a click at this point of the screen means. A cluster that zooming can
   * still part is zoomed into. Otherwise every record at the clicked spot is
   * gathered, from every visible layer: a startup and an investor in the same
   * building are drawn on top of one another, and both are there.
   */
  private async pick(x: number, y: number): Promise<void> {
    const map = this.map;
    const layers = [...this.layers]
      .filter(([, state]) => state.kind === 'points' && state.visible)
      .flatMap(([id]) => [`${id}-points`, `${id}-clusters`])
      .filter((layer) => map.getLayer(layer));
    if (!layers.length) return;
    const hits = map.queryRenderedFeatures(
      [
        [x - CLICK_REACH, y - CLICK_REACH],
        [x + CLICK_REACH, y + CLICK_REACH],
      ],
      { layers },
    );
    const found: Placed[] = [];
    for (const hit of hits) {
      const id = hit.source;
      const clusterId = hit.properties?.cluster_id;
      if (clusterId == null) {
        // The drawn copy of a marker is rounded to its tile; the record itself has the true place.
        const placed = this.spots.byMarker.get(`${id}|${markerId(hit.properties ?? {})}`);
        if (placed) found.push(placed);
        continue;
      }
      const source = map.getSource<GeoJSONSource>(id);
      const zoom = await source?.getClusterExpansionZoom(clusterId);
      if (!source || zoom == null || hit.geometry.type !== 'Point') continue;
      if (zoom <= STACK_ZOOM) {
        map.easeTo({ center: hit.geometry.coordinates as [number, number], zoom });
        return;
      }
      for (const leaf of await source.getClusterLeaves(clusterId, STACK_LIMIT, 0)) {
        if (leaf.geometry.type !== 'Point') continue;
        const [lon, lat] = leaf.geometry.coordinates as [number, number];
        found.push({ layer: id, lon, lat, properties: leaf.properties ?? {} });
      }
    }
    // Whatever else sits exactly where the clicked markers are, on any visible layer.
    const here = new Set(found.map((placed) => spotKey(placed.lon, placed.lat)));
    for (const key of here) found.push(...(this.spots.bySpot.get(key) ?? []));
    const records = distinctRecords(found);
    if (records.length) this.pickListener(records.map(({ layer, properties }) => ({ layer, properties })));
  }

  /** Recounts which spots hold markers of several layers, after data or visibility changes. */
  private refreshShared(): void {
    this.spots = indexSpots(
      [...this.layers]
        .filter(([, state]) => state.kind === 'points' && state.visible)
        .map(([id, state]) => [id, state.data] as [string, FeatureCollection<Point>]),
    );
    const source = this.map.getSource<GeoJSONSource>(SHARED);
    if (source) source.setData(sharedSpots(this.spots));
    else this.drawShared();
  }

  /**
   * A small counted badge at the corner of markers that share their spot with
   * another layer's, so a startup under an investor is not mistaken for nothing.
   */
  private drawShared(): void {
    const map = this.map;
    if (!this.styleReady || map.getSource(SHARED)) return;
    map.addSource(SHARED, { type: 'geojson', data: sharedSpots(this.spots) });
    map.addLayer({
      id: SHARED,
      type: 'circle',
      source: SHARED,
      minzoom: 8,
      paint: {
        'circle-radius': 8,
        'circle-color': '#e6edf3',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#071018',
        'circle-translate': [12, -12],
      },
    });
    map.addLayer({
      id: `${SHARED}-count`,
      type: 'symbol',
      source: SHARED,
      minzoom: 8,
      layout: {
        'text-field': ['to-string', ['get', 'count']],
        'text-font': [LABEL_FONT],
        'text-size': 10,
        'text-offset': [1.2, -1.2],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#071018' },
    });
  }

  addHeatLayer(spec: HeatLayerSpec): void {
    this.layers.set(spec.id, { kind: 'heat', spec, data: EMPTY, visible: true });
    this.draw(spec.id);
  }

  private draw(id: string): void {
    const state = this.layers.get(id);
    if (!state || this.map.getSource(id)) return;
    if (state.kind === 'heat') this.drawHeat(state.spec, state);
    else this.drawPoints(state.spec, state);
  }

  private drawHeat(spec: HeatLayerSpec, state: LayerState): void {
    const map = this.map;
    const weight: ExpressionSpecification | number = spec.weight
      ? ['interpolate', ['linear'], ['coalesce', ['get', spec.weight.property], 0], 0, 0, spec.weight.max, 1]
      : 1;
    const [sparse, typical, dense] = spec.ramp;
    map.addSource(spec.id, { type: 'geojson', data: state.data });
    // Drawn under the markers of every point layer already on the map.
    const above = map.getStyle().layers.find((layer) => layer.id.endsWith('-clusters'))?.id;
    map.addLayer(
      {
        id: spec.id,
        type: 'heatmap',
        source: spec.id,
        layout: { visibility: state.visible ? 'visible' : 'none' },
        paint: {
          'heatmap-weight': weight,
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 10, 28, 15, 60],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 14, 1.6],
          'heatmap-opacity': 0.75,
          // One hue, dark to light: more is brighter. It fades in from nothing at the edge.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, transparent(sparse),
            0.2, sparse,
            0.65, typical,
            1, dense,
          ],
        },
      },
      above,
    );
  }

  private drawPoints(spec: PointLayerSpec, state: LayerState): void {
    const map = this.map;
    const { id, color } = spec;
    const visibility = state.visible ? 'visible' : 'none';
    if (!map.hasImage(`${id}-marker`))
      map.addImage(`${id}-marker`, markerImage(spec), { pixelRatio: 2 });
    // Clustering runs in the browser so counts stay correct when data is filtered.
    // It stays on at every zoom, so records on the same spot keep a counted marker
    // instead of hiding under one another.
    map.addSource(id, {
      type: 'geojson',
      data: state.data,
      cluster: true,
      clusterRadius: 36,
      clusterMaxZoom: 22,
    });
    map.addLayer({
      id: `${id}-clusters`,
      type: 'circle',
      source: id,
      layout: { visibility },
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-opacity': 0.9,
        'circle-radius': ['step', ['get', 'point_count'], 13, 10, 17, 50, 22, 250, 28],
        'circle-stroke-width': 4,
        'circle-stroke-color': color,
        'circle-stroke-opacity': 0.25,
      },
    });
    map.addLayer({
      id: `${id}-cluster-count`,
      type: 'symbol',
      source: id,
      filter: ['has', 'point_count'],
      layout: {
        visibility,
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': [LABEL_FONT],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
    map.addLayer({
      id: `${id}-points`,
      type: 'symbol',
      source: id,
      filter: ['!', ['has', 'point_count']],
      layout: {
        visibility,
        'icon-image': `${id}-marker`,
        // Branches draw smaller than headquarters.
        'icon-size': ['case', ['boolean', ['get', 'is_hq'], true], 0.75, 0.5],
        'icon-allow-overlap': true,
      },
    });
  }

  setLinks(lines: [number, number][][]): void {
    this.links = lines;
    const source = this.map.getSource<GeoJSONSource>(LINKS);
    if (source) source.setData(this.linkData());
    else this.drawLinks();
  }

  private linkData(): FeatureCollection<LineString> {
    return {
      type: 'FeatureCollection',
      features: this.links.map((coordinates) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates },
        properties: {},
      })),
    };
  }

  private drawLinks(): void {
    const map = this.map;
    // Between asking for a basemap and its arrival there is no style to draw on;
    // the lines are drawn when it lands.
    if (!this.styleReady || map.getSource(LINKS)) return;
    map.addSource(LINKS, { type: 'geojson', data: this.linkData() });
    // Under every marker, over the basemap and the heatmaps.
    const above = map.getStyle().layers.find((layer) => layer.id.endsWith('-clusters'))?.id;
    map.addLayer(
      {
        id: LINKS,
        type: 'line',
        source: LINKS,
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#22d3ee', 'line-width': 1.4, 'line-opacity': 0.75 },
      },
      above,
    );
  }

  setData(id: string, data: FeatureCollection<Point>): void {
    const state = this.layers.get(id);
    if (state) state.data = data;
    this.map.getSource<GeoJSONSource>(id)?.setData(data);
    if (state?.kind === 'points') this.refreshShared();
  }

  setVisible(id: string, visible: boolean): void {
    const state = this.layers.get(id);
    if (!state) return;
    state.visible = visible;
    const visibility = visible ? 'visible' : 'none';
    const ids = state.kind === 'heat' ? [id] : POINT_SUFFIXES.map((suffix) => `${id}-${suffix}`);
    // Mid basemap change the layers are gone; they are redrawn with this visibility.
    for (const layer of ids)
      if (this.map.getLayer(layer)) this.map.setLayoutProperty(layer, 'visibility', visibility);
    if (state.kind === 'points') this.refreshShared();
  }

  flyTo(camera: Camera): void {
    this.map.flyTo({ center: [camera.lon, camera.lat], zoom: camera.zoom });
  }

  fitBounds(bounds: [number, number, number, number]): void {
    this.map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
  }

  getCamera(): Camera {
    const center = this.map.getCenter();
    return { lon: center.lng, lat: center.lat, zoom: this.map.getZoom() };
  }

  onCameraChange(listener: (camera: Camera) => void): void {
    this.map.on('moveend', () => listener(this.getCamera()));
  }

  destroy(): void {
    this.map.remove();
  }
}
