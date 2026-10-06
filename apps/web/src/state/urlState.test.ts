import { describe, expect, it } from 'vitest';
import { decodeUrlState, encodeUrlState } from './urlState';

const id = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

describe('share-link state', () => {
  it('round-trips camera, layers and selection', () => {
    const hash = encodeUrlState({
      camera: { lat: -1.286, lon: 36.8, zoom: 11 },
      layers: ['startups', 'investors'],
      selected: id,
    });
    expect(hash).toBe(`c=-1.28600,36.80000,11.00&l=startups,investors&s=${id}`);
    expect(decodeUrlState('#' + hash)).toEqual({
      camera: { lat: -1.286, lon: 36.8, zoom: 11 },
      layers: ['startups', 'investors'],
      selected: id,
    });
  });

  it('keeps an explicitly empty layer list distinct from an absent one', () => {
    expect(decodeUrlState('#l=')).toEqual({ layers: [] });
    expect(decodeUrlState('')).toEqual({});
  });

  it('drops malformed parts instead of guessing', () => {
    expect(decodeUrlState('#c=91,0,5')).toEqual({});
    expect(decodeUrlState('#c=1,2')).toEqual({});
    expect(decodeUrlState('#c=a,b,c')).toEqual({});
    expect(decodeUrlState('#s=not-a-uuid')).toEqual({});
    expect(decodeUrlState('#l=startups,<script>')).toEqual({ layers: ['startups'] });
  });
});
