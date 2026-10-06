import type { MapAdapter } from '../map/adapter';

/** One toggleable view of the map. Each layer owns its data and its drawing. */
export interface Layer {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  /** Register sources and drawing with the map. Called once, hidden. */
  render(map: MapAdapter): void;
  /** Show or hide the layer; data loads the first time it is shown. */
  setEnabled(enabled: boolean): Promise<void>;
  isEnabled(): boolean;
}
