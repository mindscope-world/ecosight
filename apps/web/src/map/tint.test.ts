import { describe, expect, it } from 'vitest';
import { tintColor, tintStyle } from './tint';

describe('basemap tint', () => {
  it('maps greys onto the navy ramp by lightness', () => {
    expect(tintColor('#000')).toBe('rgba(7,16,24,1)');
    expect(tintColor('rgb(255,255,255)')).toBe('rgba(214,228,238,1)');
    expect(tintColor('rgba(60,60,60,0.8)')).toMatch(/^rgba\(\d+,\d+,\d+,0.8\)$/);
    expect(tintColor('hsl(0,0%,100%)')).toBe('rgba(214,228,238,1)');
  });

  it('leaves what it cannot read alone', () => {
    expect(tintColor('transparent')).toBe('transparent');
  });

  it('recolours paint colours, including inside expressions, and gives water its own blue', () => {
    const style = tintStyle({
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#000', 'background-opacity': 1 } },
        { id: 'road', type: 'line', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5, '#fff', 6, '#000'] } },
        { id: 'water', type: 'fill', paint: { 'fill-color': 'rgb(27,27,29)' } },
        { id: 'labels', type: 'symbol' },
      ],
    });
    expect(style.layers[0]!.paint).toEqual({ 'background-color': 'rgba(7,16,24,1)', 'background-opacity': 1 });
    expect(style.layers[1]!.paint!['line-color']).toEqual([
      'interpolate', ['linear'], ['zoom'], 5, 'rgba(214,228,238,1)', 6, 'rgba(7,16,24,1)',
    ]);
    expect(style.layers[2]!.paint!['fill-color']).toBe('#0b2233');
    expect(style.layers[3]).toEqual({ id: 'labels', type: 'symbol' });
  });
});
