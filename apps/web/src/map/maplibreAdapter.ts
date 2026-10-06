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
import type { Camera, HeatLayerSpec, MapAdapter, PointLayerSpec } from './adapter';
import { tintStyle } from './tint';

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const POINT_SUFFIXES = ['clusters', 'cluster-count', 'points'];
const ICON_PIXELS = 48;
const LINKS = 'links';
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
    });
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
    const { id, onSelect } = spec;
    this.layers.set(id, { kind: 'points', spec, data: EMPTY, visible: true });
    this.draw(id);

    // Listeners are tied to layer ids, so they outlive a basemap change.
    map.on('click', `${id}-points`, (event) => {
      const feature = event.features?.[0];
      if (feature) onSelect(feature.properties ?? {});
    });
    map.on('click', `${id}-clusters`, async (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (!feature || clusterId == null || feature.geometry.type !== 'Point') return;
      const source = map.getSource<GeoJSONSource>(id);
      const zoom = await source?.getClusterExpansionZoom(clusterId);
      if (!source || zoom == null) return;
      if (zoom > STACK_ZOOM) {
        const leaves = await source.getClusterLeaves(clusterId, STACK_LIMIT, 0);
        spec.onSelectMany(leaves.map((leaf) => leaf.properties ?? {}));
        return;
      }
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    });
    for (const layer of [`${id}-points`, `${id}-clusters`]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
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
