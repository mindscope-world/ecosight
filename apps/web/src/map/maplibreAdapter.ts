import { AREA_MAX_KM, AREA_MAX_VERTICES, circleRing, distanceKm, type Area } from '@atlas/schema';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
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
import type { Camera, DrawMode, HeatLayerSpec, HoverCard, MapAdapter, PickedRecord, PointLayerSpec } from './adapter';
import { distinctRecords, indexSpots, markerId, sharedSpots, spotKey, type Placed, type SpotIndex } from './spots';
import { tintStyle } from './tint';

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const POINT_SUFFIXES = ['clusters', 'cluster-count', 'points'];
const ICON_PIXELS = 48;
const LINKS = 'links';
const SHARED = 'shared-spots';
const SELECTED = 'selected';
const AREA = 'area';
const DRAFT = 'area-draft';
// A click this close to a polygon's first corner, in pixels, closes it.
const CLOSE_REACH = 10;
// One beat of the ring around the selected record, in milliseconds.
const PULSE_MS = 1600;
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

/** The hover card as elements. Text is set as text, so nothing in a record's name is read as markup. */
function cardElement(card: HoverCard): HTMLElement {
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = card.title;
  box.append(title);
  for (const line of card.lines) {
    const row = document.createElement('div');
    row.textContent = line;
    box.append(row);
  }
  return box;
}

export class MapLibreAdapter implements MapAdapter {
  private readonly map: MapLibreMap;
  private readonly ready: Promise<void>;
  /** What each layer shows, kept so it can be redrawn on a new basemap. */
  private readonly layers = new Map<string, LayerState>();
  private links: [number, number][][] = [];
  private spots: SpotIndex = { bySpot: new Map(), byMarker: new Map() };
  private pickListener: (records: PickedRecord[]) => void = () => {};
  private describe: (record: PickedRecord) => HoverCard | null = () => null;
  private readonly hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: '260px', className: 'atlas-hover' });
  private area: Area | null = null;
  private drawing: { mode: DrawMode; points: [number, number][]; cursor: [number, number] | null; listener: (area: Area | null) => void } | null = null;
  private highlight: [number, number][] = [];
  private pulse = 0;
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
      this.drawHighlight();
      this.drawArea();
    });
    // One listener for every layer. A listener per layer would each answer for
    // its own marker, and the last to answer would hide the others.
    this.map.on('click', (event) => {
      if (this.drawing) this.drawClick([event.lngLat.lng, event.lngLat.lat], event.point);
      else void this.pick(event.point.x, event.point.y);
    });
    this.map.on('mousemove', (event) => {
      if (!this.drawing) return;
      this.drawing.cursor = [event.lngLat.lng, event.lngLat.lat];
      this.showDraft();
    });
    this.map.on('dblclick', (event) => {
      if (this.drawing?.mode !== 'polygon') return;
      event.preventDefault();
      // The two clicks of the double click each added a corner at the same place.
      this.drawing.points.pop();
      this.finishPolygon();
    });
    window.addEventListener('keydown', this.onKey);
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
    // A card beside the marker under the pointer, gone as soon as the pointer leaves it.
    map.on('mousemove', `${id}-points`, (event) => {
      const hit = event.features?.[0];
      if (!hit || hit.geometry.type !== 'Point') return;
      // The drawn copy of a marker is rounded to its tile; the record itself has the true place.
      const placed = this.spots.byMarker.get(`${id}|${markerId(hit.properties ?? {})}`);
      const card = this.describe({ layer: id, properties: placed?.properties ?? hit.properties ?? {} });
      if (!card) return this.hoverPopup.remove();
      const at = placed ? ([placed.lon, placed.lat] as [number, number]) : (hit.geometry.coordinates as [number, number]);
      this.hoverPopup.setLngLat(at).setDOMContent(cardElement(card)).addTo(map);
    });
    map.on('mouseleave', `${id}-points`, () => this.hoverPopup.remove());
    // The ring around the selected record stays above every layer of markers.
    for (const layer of [`${SELECTED}-pulse`, `${SELECTED}-ring`]) if (map.getLayer(layer)) map.moveLayer(layer);
  }

  onHover(describe: (record: PickedRecord) => HoverCard | null): void {
    this.describe = describe;
  }

  setHighlight(places: [number, number][]): void {
    this.highlight = places;
    const source = this.map.getSource<GeoJSONSource>(SELECTED);
    if (source) source.setData(this.highlightData());
    else this.drawHighlight();
    this.beat();
  }

  private highlightData(): FeatureCollection<Point> {
    return {
      type: 'FeatureCollection',
      features: this.highlight.map((coordinates) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties: {} })),
    };
  }

  /** A steady ring round the selected marker, and a second that swells and fades. */
  private drawHighlight(): void {
    const map = this.map;
    if (!this.styleReady || map.getSource(SELECTED)) return;
    map.addSource(SELECTED, { type: 'geojson', data: this.highlightData() });
    map.addLayer({
      id: `${SELECTED}-pulse`,
      type: 'circle',
      source: SELECTED,
      paint: { 'circle-radius': 16, 'circle-color': '#22d3ee', 'circle-opacity': 0.12, 'circle-stroke-width': 2, 'circle-stroke-color': '#22d3ee', 'circle-stroke-opacity': 0.6 },
    });
    map.addLayer({
      id: `${SELECTED}-ring`,
      type: 'circle',
      source: SELECTED,
      paint: { 'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
    });
  }

  /** Keeps the outer ring moving while something is selected. Still for readers who ask for less motion. */
  private beat(): void {
    cancelAnimationFrame(this.pulse);
    if (!this.highlight.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const step = (now: number) => {
      const map = this.map;
      if (map.getLayer(`${SELECTED}-pulse`)) {
        const t = (now % PULSE_MS) / PULSE_MS;
        map.setPaintProperty(`${SELECTED}-pulse`, 'circle-radius', 15 + 20 * t);
        map.setPaintProperty(`${SELECTED}-pulse`, 'circle-opacity', 0.22 * (1 - t));
        map.setPaintProperty(`${SELECTED}-pulse`, 'circle-stroke-opacity', 0.9 * (1 - t));
      }
      this.pulse = requestAnimationFrame(step);
    };
    this.pulse = requestAnimationFrame(step);
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

  setArea(area: Area | null): void {
    this.area = area;
    const source = this.map.getSource<GeoJSONSource>(AREA);
    if (source) source.setData(this.areaData(area));
    else this.drawArea();
  }

  private areaData(area: Area | null): FeatureCollection<Polygon> {
    return { type: 'FeatureCollection', features: area ? [this.areaFeature(area)] : [] };
  }

  private areaFeature(area: Area): Feature<Polygon> {
    const ring = area.type === 'circle' ? circleRing(area.lon, area.lat, area.km) : [...area.ring, area.ring[0]!];
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
  }

  /** The selected area, and the one being drawn, under the markers and over the basemap. */
  private drawArea(): void {
    const map = this.map;
    if (!this.styleReady || map.getSource(AREA)) return;
    const above = map.getStyle().layers.find((layer) => layer.id.endsWith('-clusters'))?.id;
    map.addSource(AREA, { type: 'geojson', data: this.areaData(this.area) });
    map.addSource(DRAFT, { type: 'geojson', data: this.draftData() });
    for (const [id, opacity, dash] of [[AREA, 0.1, [1]], [DRAFT, 0.06, [2, 2]]] as const) {
      map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': '#22d3ee', 'fill-opacity': opacity } }, above);
      map.addLayer({ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-dasharray': [...dash] } }, above);
    }
  }

  private draftData(): FeatureCollection {
    const draw = this.drawing;
    const features: Feature[] = [];
    if (draw) {
      const { points, cursor } = draw;
      if (draw.mode === 'circle' && points[0] && cursor) {
        const km = Math.max(0.05, distanceKm(points[0], cursor));
        features.push(this.areaFeature({ type: 'circle', lon: points[0][0], lat: points[0][1], km }));
      } else if (draw.mode === 'polygon' && points.length) {
        const path = cursor ? [...points, cursor] : points;
        features.push(
          path.length >= 3
            ? this.areaFeature({ type: 'polygon', ring: path })
            : { type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: {} },
        );
      }
      // The corners placed so far.
      for (const point of points) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: {} });
    }
    return { type: 'FeatureCollection', features };
  }

  private showDraft(): void {
    this.map.getSource<GeoJSONSource>(DRAFT)?.setData(this.draftData());
  }

  startDraw(mode: DrawMode, listener: (area: Area | null) => void): void {
    // Replacing a drawing in progress is not a cancellation: the caller asked for the new one.
    if (this.drawing) this.endDraw();
    this.drawing = { mode, points: [], cursor: null, listener };
    this.hoverPopup.remove();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.doubleClickZoom.disable();
    this.showDraft();
  }

  cancelDraw(): void {
    const draw = this.drawing;
    if (!draw) return;
    this.endDraw();
    draw.listener(null);
  }

  private endDraw(): void {
    this.drawing = null;
    this.map.getCanvas().style.cursor = '';
    this.map.doubleClickZoom.enable();
    this.showDraft();
  }

  private finish(area: Area): void {
    const draw = this.drawing!;
    this.endDraw();
    draw.listener(area);
  }

  private drawClick(at: [number, number], pixel: { x: number; y: number }): void {
    const draw = this.drawing!;
    if (draw.mode === 'circle') {
      if (!draw.points.length) {
        draw.points.push(at);
        this.showDraft();
        return;
      }
      const km = Math.min(AREA_MAX_KM, Math.max(0.1, Math.round(distanceKm(draw.points[0]!, at) * 10) / 10));
      this.finish({ type: 'circle', lon: draw.points[0]![0], lat: draw.points[0]![1], km });
      return;
    }
    const first = draw.points[0];
    if (first && draw.points.length >= 3) {
      const start = this.map.project(first);
      if (Math.hypot(start.x - pixel.x, start.y - pixel.y) <= CLOSE_REACH) return this.finishPolygon();
    }
    if (draw.points.length < AREA_MAX_VERTICES) draw.points.push(at);
    this.showDraft();
  }

  private finishPolygon(): void {
    const draw = this.drawing;
    if (!draw || draw.points.length < 3) return;
    this.finish({ type: 'polygon', ring: draw.points });
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.drawing) return;
    if (event.key === 'Escape') this.cancelDraw();
    else if (event.key === 'Enter' && this.drawing.mode === 'polygon') this.finishPolygon();
  };

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

  /**
   * What is drawn, in numbers, and where a place falls on the screen. For the
   * browser tests, which cannot see a canvas: nothing in the app reads this.
   */
  inspect(): { markers: number; clusters: number; ringed: number; lines: number; card: string | null; area: boolean; drawing: boolean } {
    const map = this.map;
    const drawn = (suffix: string) =>
      [...this.layers]
        .filter(([, state]) => state.kind === 'points' && state.visible)
        .map(([id]) => `${id}-${suffix}`)
        .filter((layer) => map.getLayer(layer));
    return {
      markers: map.queryRenderedFeatures({ layers: drawn('points') }).length,
      clusters: map.queryRenderedFeatures({ layers: drawn('clusters') }).length,
      ringed: this.highlight.length,
      lines: this.links.length,
      area: this.area !== null,
      drawing: this.drawing !== null,
      card: this.hoverPopup.isOpen() ? (this.hoverPopup.getElement()?.textContent ?? '') : null,
    };
  }

  screenPoint(lon: number, lat: number): { x: number; y: number } {
    const box = this.map.getCanvas().getBoundingClientRect();
    const point = this.map.project([lon, lat]);
    return { x: box.left + point.x, y: box.top + point.y };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.pulse);
    this.hoverPopup.remove();
    this.map.remove();
  }
}
