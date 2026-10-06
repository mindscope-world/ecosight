import { BASEMAP_STYLES, DEFAULT_CAMERA } from './config';
import { createOrganisationLayer } from './layers/organisations';
import type { Layer } from './layers/types';
import { MapLibreAdapter } from './map/maplibreAdapter';
import { applyTheme, loadTheme, saveTheme } from './state/theme';
import { decodeUrlState, encodeUrlState } from './state/urlState';
import { mountCard } from './ui/card';
import { mountLayerPanel } from './ui/layerPanel';
import { mountThemeToggle } from './ui/themeToggle';
import './style.css';

const initial = decodeUrlState(location.hash);
let selected = initial.selected;

const theme = loadTheme();
applyTheme(theme);

const map = new MapLibreAdapter(document.getElementById('map')!, {
  style: BASEMAP_STYLES[theme],
  camera: initial.camera ?? DEFAULT_CAMERA,
});

function writeUrl() {
  const hash = encodeUrlState({
    camera: map.getCamera(),
    layers: layers.filter((layer) => layer.isEnabled()).map((layer) => layer.id),
    selected,
  });
  history.replaceState(null, '', '#' + hash);
}

const card = mountCard(document.getElementById('card')!, () => {
  selected = undefined;
  writeUrl();
});

async function select(orgId: string) {
  selected = orgId;
  writeUrl();
  await card.open(orgId);
}

const layers: Layer[] = [
  createOrganisationLayer({ id: 'startups', label: 'Startups', color: '#2563eb', type: 'startup', onSelect: select }),
  createOrganisationLayer({ id: 'investors', label: 'Investors', color: '#059669', type: 'fund', onSelect: select }),
  createOrganisationLayer({ id: 'ngos', label: 'NGOs', color: '#d97706', type: 'ngo', onSelect: select }),
  createOrganisationLayer({ id: 'accelerators', label: 'Accelerators', color: '#9333ea', type: 'accelerator', onSelect: select }),
];

async function toggle(layer: Layer, enabled: boolean) {
  try {
    await layer.setEnabled(enabled);
  } catch (error) {
    console.error(`[layer:${layer.id}]`, error);
  }
  writeUrl();
}

const panel = mountLayerPanel(document.getElementById('layer-panel')!, layers, toggle);
mountThemeToggle(document.getElementById('layer-panel')!, theme, (next) => {
  applyTheme(next);
  saveTheme(next);
  map.setBasemap(BASEMAP_STYLES[next]);
});

await map.whenReady();
for (const layer of layers) layer.render(map);

// A link with no layer list shows everything; an explicit empty list shows nothing.
const enabledIds = initial.layers ?? layers.map((layer) => layer.id);
await Promise.all(layers.map((layer) => toggle(layer, enabledIds.includes(layer.id))));
panel.sync();

map.onCameraChange(writeUrl);
if (selected) void card.open(selected);
