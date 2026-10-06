import { describe, expect, it } from 'vitest';
import { matches, NO_FILTERS } from './filters';
import { decodeUrlState, encodeUrlState } from './urlState';

const id = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

describe('share-link state', () => {
  it('round-trips camera, layers and selection', () => {
    const hash = encodeUrlState({
      camera: { lat: -1.286, lon: 36.8, zoom: 11 },
      layers: ['startups', 'investors'],
      selected: { kind: 'org', id },
    });
    expect(hash).toBe(`v=1&c=-1.28600,36.80000,11.00&l=startups,investors&s=${id}`);
    expect(decodeUrlState('#' + hash)).toEqual({
      camera: { lat: -1.286, lon: 36.8, zoom: 11 },
      layers: ['startups', 'investors'],
      selected: { kind: 'org', id },
    });
  });

  it('round-trips a selected event', () => {
    const hash = encodeUrlState({ selected: { kind: 'event', id } });
    expect(hash).toBe(`v=1&e=${id}`);
    expect(decodeUrlState(hash)).toEqual({ selected: { kind: 'event', id } });
  });

  it('carries the open screen, leaving the map out', () => {
    expect(encodeUrlState({ view: 'investors' })).toBe('v=1&p=investors');
    expect(encodeUrlState({ view: 'map' })).toBe('v=1');
    expect(decodeUrlState('#v=1&p=events')).toEqual({ view: 'events' });
    expect(decodeUrlState('#v=1&p=admin')).toEqual({});
  });

  it('carries the map style and filters', () => {
    const filters = {
      ...NO_FILTERS,
      sectors: ['fintech', 'health, care'],
      status: 'active' as const,
      foundedFrom: 2015,
      raisedMin: 1_000_000,
    };
    const hash = encodeUrlState({ mapStyle: 'terrain', filters });
    expect(hash).toBe('v=1&m=terrain&fs=fintech,health%252C%2520care&fa=active&fy=2015-&fr=1000000');
    expect(decodeUrlState(hash)).toEqual({ mapStyle: 'terrain', filters });
    expect(decodeUrlState('#m=dark&fa=maybe&fy=12-99999&fr=-5')).toEqual({});
  });

  it('reads links made before versioning and ignores newer versions', () => {
    expect(decodeUrlState(`#l=ngos&s=${id}`)).toEqual({
      layers: ['ngos'],
      selected: { kind: 'org', id },
    });
    expect(decodeUrlState(`#v=2&l=ngos&s=${id}`)).toEqual({});
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

describe('filters', () => {
  const org = { sectors: ['fintech'], stage: 'seed', city: 'Nairobi', is_active: true, founded_year: 2018, raised_usd: 500_000 };

  it('match everything when empty', () => {
    expect(matches(org, NO_FILTERS)).toBe(true);
  });

  it('combine across kinds and accept any value within a kind', () => {
    expect(matches(org, { ...NO_FILTERS, sectors: ['agritech', 'fintech'], stages: ['seed'] })).toBe(true);
    expect(matches(org, { ...NO_FILTERS, sectors: ['fintech'], stages: ['series-a'] })).toBe(false);
    expect(matches(org, { ...NO_FILTERS, status: 'inactive' })).toBe(false);
    expect(matches(org, { ...NO_FILTERS, foundedFrom: 2015, foundedTo: 2018 })).toBe(true);
    expect(matches(org, { ...NO_FILTERS, raisedMin: 1_000_000 })).toBe(false);
  });

  it('leave out records with no value for a filtered fact', () => {
    expect(matches({ ...org, founded_year: null }, { ...NO_FILTERS, foundedFrom: 2000 })).toBe(false);
    expect(matches({ ...org, stage: null }, { ...NO_FILTERS, stages: ['seed'] })).toBe(false);
  });
});
