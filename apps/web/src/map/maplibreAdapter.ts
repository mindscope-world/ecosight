import type { FeatureCollection, Point } from 'geojson';
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
// MapLibre finds its worker relative to its own file, which no longer holds once
// the library is bundled, so the worker is built as its own asset and named here.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LABEL_FONT } from '../config';
import type { Camera, MapAdapter, PointLayerSpec } from './adapter';

setWorkerUrl(workerUrl);

const EMPTY: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

export class MapLibreAdapter implements MapAdapter {
  private readonly map: MapLibreMap;
  private readonly ready: Promise<void>;
  /** What each point layer shows, kept so it can be redrawn on a new basemap. */
  private readonly pointLayers = new Map<
    string,
    { color: string; data: FeatureCollection<Point>; visible: boolean }
  >();

  constructor(container: HTMLElement, options: { style: string; camera: Camera }) {
    this.map = new MapLibreMap({
      container,
      style: options.style,
      center: [options.camera.lon, options.camera.lat],
      zoom: options.camera.zoom,
      attributionControl: { compact: true },
    });
    this.map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    this.ready = new Promise((resolve) => this.map.once('load', () => resolve()));
    // A new basemap style replaces every source and layer, ours included.
    this.map.on('style.load', () => {
      for (const id of this.pointLayers.keys()) this.drawPointLayer(id);
    });
  }

  setBasemap(style: string): void {
    this.map.setStyle(style, { diff: false });
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  addPointLayer({ id, color, onSelect }: PointLayerSpec): void {
    const map = this.map;
    this.pointLayers.set(id, { color, data: EMPTY, visible: true });
    this.drawPointLayer(id);

    // Listeners are tied to layer ids, so they outlive a basemap change.
    map.on('click', `${id}-points`, (event) => {
      const feature = event.features?.[0];
      if (feature) onSelect(feature.properties ?? {});
    });
    map.on('click', `${id}-clusters`, async (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (!feature || clusterId == null || feature.geometry.type !== 'Point') return;
      const zoom = await map.getSource<GeoJSONSource>(id)?.getClusterExpansionZoom(clusterId);
      if (zoom == null) return;
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    });
    for (const layer of [`${id}-points`, `${id}-clusters`]) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
  }

  private drawPointLayer(id: string): void {
    const map = this.map;
    const state = this.pointLayers.get(id);
    if (!state || map.getSource(id)) return;
    const { color, data } = state;
    const visibility = state.visible ? 'visible' : 'none';
    // Clustering runs in the browser so counts stay correct when data is filtered.
    map.addSource(id, {
      type: 'geojson',
      data,
      cluster: true,
      clusterRadius: 36,
      clusterMaxZoom: 12,
    });
    map.addLayer({
      id: `${id}-clusters`,
      type: 'circle',
      source: id,
      layout: { visibility },
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': color,
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
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
      type: 'circle',
      source: id,
      layout: { visibility },
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': color,
        // Branches draw smaller than headquarters.
        'circle-radius': ['case', ['boolean', ['get', 'is_hq'], true], 7, 4.5],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    });
  }

  setData(id: string, data: FeatureCollection<Point>): void {
    const state = this.pointLayers.get(id);
    if (state) state.data = data;
    this.map.getSource<GeoJSONSource>(id)?.setData(data);
  }

  setVisible(id: string, visible: boolean): void {
    const state = this.pointLayers.get(id);
    if (state) state.visible = visible;
    // Mid basemap change the layers are gone; they are redrawn with this visibility.
    if (!this.map.getLayer(`${id}-points`)) return;
    const visibility = visible ? 'visible' : 'none';
    for (const suffix of ['clusters', 'cluster-count', 'points'])
      this.map.setLayoutProperty(`${id}-${suffix}`, 'visibility', visibility);
  }

  flyTo(camera: Camera): void {
    this.map.flyTo({ center: [camera.lon, camera.lat], zoom: camera.zoom });
  }

  getCamera(): Camera {
    const center = this.map.getCenter();
    return { lon: center.lng, lat: center.lat, zoom: this.map.getZoom() };
  }

  onCameraChange(listener: (camera: Camera) => void): void {
    this.map.on('moveend', () => listener(this.getCamera()));
  }
}
