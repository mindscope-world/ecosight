// Recolours a grey basemap style into the app's navy palette. Every grey is
// mapped by its lightness onto a ramp from the app background to a pale blue-grey,
// so the map keeps its contrast structure and loses only its neutral cast.

type Rgb = [number, number, number];

const DARKEST: Rgb = [7, 16, 24]; // #071018, the app background
const LIGHTEST: Rgb = [214, 228, 238];
const WATER = '#0b2233';

function parse(color: string): { rgb: Rgb; alpha: number } | null {
  const text = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb,
      alpha: 1,
    };
  }
  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean).map((part) => parseFloat(part));
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  const alpha = parts[3] ?? 1;
  if (fn[1]!.startsWith('rgb')) return { rgb: parts.slice(0, 3) as Rgb, alpha };
  // For hsl only the lightness matters here.
  const grey = (parts[2]! / 100) * 255;
  return { rgb: [grey, grey, grey], alpha };
}

export function tintColor(color: string): string {
  const parsed = parse(color);
  if (!parsed) return color;
  const [r, g, b] = parsed.rgb;
  const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const mixed = DARKEST.map((dark, i) => Math.round(dark + (LIGHTEST[i]! - dark) * lightness));
  return `rgba(${mixed.join(',')},${parsed.alpha})`;
}

function tintValue(value: unknown): unknown {
  if (typeof value === 'string') return tintColor(value);
  // Expressions such as zoom interpolations hold colours among their arguments.
  if (Array.isArray(value)) return value.map(tintValue);
  return value;
}

interface StyleLayer {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
}

export function tintStyle<T extends { layers: StyleLayer[] }>(style: T): T {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (!layer.paint) return layer;
      const paint: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(layer.paint))
        paint[key] = key.endsWith('-color') ? tintValue(value) : value;
      // Water gets its own blue so coasts and rivers stay readable.
      if (layer.id.startsWith('water') && layer.type === 'fill') paint['fill-color'] = WATER;
      if (layer.id.startsWith('waterway')) paint['line-color'] = WATER;
      return { ...layer, paint };
    }),
  };
}
