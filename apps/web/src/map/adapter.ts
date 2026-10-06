import type { FeatureCollection, Point } from 'geojson';

export interface Camera {
  lon: number;
  lat: number;
  zoom: number;
}

export interface PointLayerSpec {
  id: string;
  color: string;
  /** Called with the properties of the clicked pin. */
  onSelect: (properties: Record<string, unknown>) => void;
}

/**
 * The only surface layers may use to reach the map. Layers never import a map
 * library directly, so a second renderer (the 3D globe) is one more adapter.
 */
export interface MapAdapter {
  whenReady(): Promise<void>;
  /** Swap the basemap style; point layers and their data carry over. */
  setBasemap(style: string): void;
  addPointLayer(spec: PointLayerSpec): void;
  setData(id: string, data: FeatureCollection<Point>): void;
  setVisible(id: string, visible: boolean): void;
  flyTo(camera: Camera): void;
  getCamera(): Camera;
  /** Fires after the camera settles. */
  onCameraChange(listener: (camera: Camera) => void): void;
}
