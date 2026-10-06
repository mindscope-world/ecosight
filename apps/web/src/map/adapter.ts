import type { Camera } from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import type { Basemap } from '../config';
import type { Shape } from '../entities';

export type { Camera };

export interface PointLayerSpec {
  id: string;
  color: string;
  shape: Shape;
  /** Called with the properties of the clicked marker. */
  onSelect: (properties: Record<string, unknown>) => void;
}

export interface HeatLayerSpec {
  id: string;
  weight?: { property: string; max: number };
}

/**
 * The only surface the app may use to reach the map. Nothing else imports a map
 * library directly, so a second renderer (the 3D globe) is one more adapter.
 */
export interface MapAdapter {
  whenReady(): Promise<void>;
  /** Swap the basemap; layers and their data carry over. */
  setBasemap(basemap: Basemap): void;
  addPointLayer(spec: PointLayerSpec): void;
  addHeatLayer(spec: HeatLayerSpec): void;
  setData(id: string, data: FeatureCollection<Point>): void;
  setVisible(id: string, visible: boolean): void;
  flyTo(camera: Camera): void;
  /** Fit the view to [west, south, east, north]. */
  fitBounds(bounds: [number, number, number, number]): void;
  getCamera(): Camera;
  /** Fires after the camera settles. */
  onCameraChange(listener: (camera: Camera) => void): void;
  destroy(): void;
}
