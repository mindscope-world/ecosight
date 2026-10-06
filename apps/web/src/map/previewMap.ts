import type { FeatureCollection, LineString, Point } from 'geojson';
import { Map as MapLibreMap, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASEMAPS } from '../config';
import { tintStyle } from './tint';

setWorkerUrl(workerUrl);

/**
 * A quiet, mostly non-interactive map for the landing page: glowing points,
 * pulsing hubs and connection lines over the app's own navy basemap. The app
 * itself uses MapAdapter; this is a separate, simpler thing for showing, not using.
 */
export interface PreviewOptions {
  center: [number, number];
  zoom: number;
  /** Place names and roads. Off for the wide, stylised views. */
  labels: boolean;
  globe?: boolean;
  /** Drift slowly east and back, so the view is never quite still. */
  drift?: boolean;
  /** Colour per value of each point's `kind` property. */
  colors: Record<string, string>;
}

const empty = <G extends Point | LineString>(): FeatureCollection<G> => ({ type: 'FeatureCollection', features: [] });
const FRAME_MS = 60;
const LAND = '#10212f';
const SEA = '#071018';

export class PreviewMap {
  private readonly map: MapLibreMap;
  private data = {
    points: empty<Point>(),
    hubs: empty<Point>(),
    lines: empty<LineString>(),
  };
  private kinds: string[] | null = null;
  private ready = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    container: HTMLElement,
    private readonly options: PreviewOptions,
  ) {
    this.map = new MapLibreMap({
      container,
      center: options.center,
      zoom: options.zoom,
      interactive: false,
      attributionControl: { compact: true },
      renderWorldCopies: false,
    });
    this.map.setStyle(BASEMAPS.dark.url, {
      diff: false,
      transformStyle: (_previous, next) => this.restyle(next),
    });
    this.map.once('style.load', () => {
      if (options.globe) this.map.setProjection({ type: 'globe' });
      this.draw();
      this.ready = true;
      this.setActive(true);
    });
  }

  private restyle(style: StyleSpecification): StyleSpecification {
    const tinted = tintStyle(style) as StyleSpecification;
    if (this.options.labels) return tinted;
    // Land, water and borders only: the points are the subject. Water takes the
    // page's own colour so the map has no edge, and land is lifted a step above it.
    const layers = tinted.layers
      .filter((layer) => layer.type === 'background' || layer.id === 'water' || layer.id.startsWith('boundary_country'))
      .map((layer) => {
        if (layer.type === 'background') return { ...layer, paint: { 'background-color': LAND } };
        if (layer.id === 'water') return { ...layer, paint: { 'fill-color': SEA } };
        return { ...layer, paint: { ...layer.paint, 'line-color': '#1e3547', 'line-opacity': 0.6 } };
      });
    return { ...tinted, layers: layers as StyleSpecification['layers'] };
  }

  private draw(): void {
    const map = this.map;
    const colour: unknown = [
      'match',
      ['get', 'kind'],
      ...Object.entries(this.options.colors).flat(),
      '#22d3ee',
    ];
    map.addSource('lines', { type: 'geojson', data: this.data.lines });
    map.addSource('hubs', { type: 'geojson', data: this.data.hubs });
    map.addSource('points', { type: 'geojson', data: this.data.points });
    map.addLayer({
      id: 'lines',
      type: 'line',
      source: 'lines',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#22d3ee', 'line-width': 1.2, 'line-opacity': 0.5, 'line-dasharray': [2, 3] },
    });
    map.addLayer({
      id: 'hubs-pulse',
      type: 'circle',
      source: 'hubs',
      paint: { 'circle-color': '#22d3ee', 'circle-radius': 10, 'circle-opacity': 0.2, 'circle-blur': 0.5 },
    });
    map.addLayer({
      id: 'points-glow',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-color': colour as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 5, 5, 8, 11, 13],
        'circle-opacity': 0.2,
        'circle-blur': 1,
      },
    });
    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-color': colour as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.5, 5, 2.4, 11, 4.5],
        'circle-opacity': 0.9,
      },
    });
    this.applyKinds();
  }

  setPoints(points: FeatureCollection<Point>): void {
    this.data.points = points;
    if (this.ready) this.map.getSource<GeoJSONSource>('points')?.setData(points);
  }

  setHubs(hubs: FeatureCollection<Point>): void {
    this.data.hubs = hubs;
    if (this.ready) this.map.getSource<GeoJSONSource>('hubs')?.setData(hubs);
  }

  setLines(lines: FeatureCollection<LineString>): void {
    this.data.lines = lines;
    if (this.ready) this.map.getSource<GeoJSONSource>('lines')?.setData(lines);
  }

  /** Show only points of these kinds; null shows all. */
  setKinds(kinds: string[] | null): void {
    this.kinds = kinds;
    if (this.ready) this.applyKinds();
  }

  private applyKinds(): void {
    const filter = this.kinds ? (['in', ['get', 'kind'], ['literal', this.kinds]] as never) : null;
    for (const layer of ['points', 'points-glow']) this.map.setFilter(layer, filter);
  }

  flyTo(center: [number, number], zoom: number): void {
    if (this.still) this.map.jumpTo({ center, zoom });
    else this.map.flyTo({ center, zoom, duration: 1800, essential: true });
  }

  /** Start or stop the motion. Stopped while off screen, and never started for reduced motion. */
  setActive(active: boolean): void {
    clearInterval(this.timer);
    this.timer = undefined;
    if (!active || !this.ready || this.still) return;
    const started = performance.now();
    const [lon, lat] = this.options.center;
    this.timer = setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      const beat = 0.5 + 0.5 * Math.sin(seconds * 1.6);
      this.map.setPaintProperty('hubs-pulse', 'circle-radius', 8 + beat * 10);
      this.map.setPaintProperty('hubs-pulse', 'circle-opacity', 0.26 - beat * 0.18);
      // Marching dashes: the line pattern is shifted one step at a time.
      const step = Math.floor(seconds * 4) % 5;
      this.map.setPaintProperty('lines', 'line-dasharray', [0.001 + step, 2, 3 - Math.min(step, 3) + 0.001, 0.001]);
      if (this.options.drift) this.map.jumpTo({ center: [lon + Math.sin(seconds / 14) * 5, lat] });
    }, FRAME_MS);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.map.remove();
  }
}
