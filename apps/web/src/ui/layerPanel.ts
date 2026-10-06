import type { Layer } from '../layers/types';

/** Checkbox per layer; reports toggles and can be synced from outside. */
export function mountLayerPanel(
  root: HTMLElement,
  layers: readonly Layer[],
  onToggle: (layer: Layer, enabled: boolean) => void,
) {
  const inputs = new Map<string, HTMLInputElement>();
  const heading = document.createElement('h1');
  heading.textContent = 'Capital Atlas';
  root.append(heading);

  for (const layer of layers) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.addEventListener('change', () => onToggle(layer, input.checked));
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = layer.color;
    label.append(input, swatch, layer.label);
    root.append(label);
    inputs.set(layer.id, input);
  }

  return {
    sync() {
      for (const layer of layers) inputs.get(layer.id)!.checked = layer.isEnabled();
    },
  };
}
