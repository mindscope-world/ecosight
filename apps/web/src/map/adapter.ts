import type { Camera } from '@atlas/schema';
import type { FeatureCollection, Point } from 'geojson';
import type { Basemap } from '../config';
import type { HeatRamp, Shape } from '../entities';

export type { Camera };

export interface PointLayerSpec {
  id: string;
  color: string;
  shape: Shape;
}

/** A record a click landed on: the layer it is drawn on and its properties. */
export interface PickedRecord {
  layer: string;
  properties: Record<string, unknown>;
}

/** What is shown beside a marker while the pointer rests on it. */
export interface HoverCard {
  title: string;
  lines: string[];
}

export interface HeatLayerSpec {
  id: string;
  weight?: { property: string; max: number };
  /** One hue from dark to light: sparse, typical, dense. */
  ramp: HeatRamp;
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
  /**
   * Called when markers are clicked, with every record at that spot on any
   * visible layer: one record, or several that share the place and cannot be
   * told apart by zooming.
   */
  onPick(listener: (records: PickedRecord[]) => void): void;
  /**
   * Describe a record for the small card shown while the pointer rests on its
   * marker. The card goes when the pointer leaves. Null shows nothing.
   */
  onHover(describe: (record: PickedRecord) => HoverCard | null): void;
  /** Ring the given places, pulsing, to mark the selected record. An empty list clears it. */
  setHighlight(places: [number, number][]): void;
  /** Draw lines between places, replacing any drawn before. An empty list clears them. */
  setLinks(lines: [number, number][][]): void;
  flyTo(camera: Camera): void;
  /** Fit the view to [west, south, east, north]. */
  fitBounds(bounds: [number, number, number, number]): void;
  getCamera(): Camera;
  /** Fires after the camera settles. */
  onCameraChange(listener: (camera: Camera) => void): void;
  destroy(): void;
}
