import { describe, expect, it } from 'vitest';
import { countActive, decodeFilters, encodeFilters, matches, matchesEvent, narrowsOrganisations, NO_FILTERS } from './filters';
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
  const org = {
    types: ['startup'], sectors: ['fintech'], stage: 'seed', city: 'Nairobi', country: 'KE', is_active: true,
    founded_year: 2018, raised_usd: 500_000, funding_years: [2021, 2023], led_rounds: 0, portfolio: 0,
    last_invested_on: null,
  };
  const fund = { ...org, types: ['fund'], funding_years: [2024], led_rounds: 1, portfolio: 3, last_invested_on: '2026-03-01' };
  const now = Date.parse('2026-10-07T12:00:00Z');

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

  it('match on country and on the years of funding', () => {
    expect(matches(org, { ...NO_FILTERS, country: 'KE' })).toBe(true);
    expect(matches(org, { ...NO_FILTERS, country: 'NG' })).toBe(false);
    expect(matches(org, { ...NO_FILTERS, fundedFrom: 2022, fundedTo: 2023 })).toBe(true);
    expect(matches(org, { ...NO_FILTERS, fundedFrom: 2024 })).toBe(false);
    expect(matches(org, { ...NO_FILTERS, fundedTo: 2021 })).toBe(true);
  });

  it('apply the investor filter to investors only', () => {
    expect(matches(org, { ...NO_FILTERS, investor: 'lead' })).toBe(true); // a startup is unaffected
    expect(matches(fund, { ...NO_FILTERS, investor: 'lead' })).toBe(true);
    expect(matches({ ...fund, led_rounds: 0 }, { ...NO_FILTERS, investor: 'lead' })).toBe(false);
    expect(matches({ ...fund, portfolio: 0 }, { ...NO_FILTERS, investor: 'portfolio' })).toBe(false);
    expect(matches(fund, { ...NO_FILTERS, investor: 'active' }, now)).toBe(true);
    expect(matches({ ...fund, last_invested_on: '2025-10-06' }, { ...NO_FILTERS, investor: 'active' }, now)).toBe(false);
    expect(matches({ ...fund, last_invested_on: '2025-10-07' }, { ...NO_FILTERS, investor: 'active' }, now)).toBe(true);
    expect(matches({ ...fund, last_invested_on: null }, { ...NO_FILTERS, investor: 'active' }, now)).toBe(false);
  });

  it('filter events by place and start date only', () => {
    const event = { city: 'Nairobi', country: 'KE', starts_at: '2026-10-20T15:00:00Z' };
    expect(matchesEvent(event, { ...NO_FILTERS, sectors: ['fintech'] })).toBe(true);
    expect(matchesEvent(event, { ...NO_FILTERS, city: 'Lagos' })).toBe(false);
    expect(matchesEvent(event, { ...NO_FILTERS, eventFrom: '2026-10-20', eventTo: '2026-10-20' })).toBe(true);
    expect(matchesEvent(event, { ...NO_FILTERS, eventFrom: '2026-10-21' })).toBe(false);
    expect(narrowsOrganisations({ ...NO_FILTERS, eventFrom: '2026-10-21' })).toBe(false);
    expect(narrowsOrganisations({ ...NO_FILTERS, country: 'KE' })).toBe(true);
  });

  it('round-trip every kind through the URL', () => {
    const all = {
      sectors: ['fintech'], stages: ['seed'], city: 'Nairobi', country: 'KE', status: 'active' as const,
      foundedFrom: 2015, foundedTo: null, raisedMin: 1_000_000, fundedFrom: null, fundedTo: 2023,
      investor: 'lead' as const, eventFrom: '2026-10-01', eventTo: null,
    };
    const query = encodeFilters(all).join('&');
    expect(query).toBe('fs=fintech&fg=seed&fc=Nairobi&fk=KE&fa=active&fy=2015-&fr=1000000&fd=-2023&fi=lead&fe=2026-10-01_');
    expect(decodeFilters(new URLSearchParams(query))).toEqual(all);
    expect(countActive(all)).toBe(10);
    expect(decodeFilters(new URLSearchParams('fk=Kenya&fi=whale&fe=soon_2026-13-01&fd=x-y'))).toEqual(NO_FILTERS);
  });
});
