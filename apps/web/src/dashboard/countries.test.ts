import { describe, expect, it } from 'vitest';
import type { OrgRow } from '../api';
import { POINT_LAYERS } from '../entities';
import { summariseCountries } from './countries';

const org = (changes: Partial<OrgRow>): OrgRow => ({
  id: 'x', name: 'X', types: ['startup'], sectors: [], stage: null, city: 'Nairobi', country: 'KE', precision: 'address',
  founded_year: null, is_active: true, website_domain: null, raised_usd: 0, rounds: 0, investors: 0, portfolio: 0,
  last_invested_on: null, participants: 0, people: 0, last_verified_at: null, ...changes,
});

describe('per-country summary', () => {
  const rows = summariseCountries(
    [
      org({ raised_usd: 1_000_000, rounds: 2 }),
      org({ city: 'Mombasa', raised_usd: 500_000, rounds: 1 }),
      org({ types: ['incubator', 'fund'] }),
      org({ types: ['university'], city: 'Kampala', country: 'UG' }),
      org({ types: ['fund'], city: null, country: null }),
    ],
    POINT_LAYERS,
  );

  it('counts organisations, cities, rounds and money where each is based', () => {
    expect(rows[0]).toMatchObject({ country: 'KE', organisations: 3, cities: 2, rounds: 3, raised_usd: 1_500_000 });
    expect(rows[1]).toMatchObject({ country: 'UG', organisations: 1, cities: 1, rounds: 0 });
  });

  it('counts an organisation of two kinds under both', () => {
    expect(rows[0]!.kinds).toEqual({ startups: 2, investors: 1, accelerators: 1 });
    expect(rows[1]!.kinds).toEqual({ universities: 1 });
  });

  it('puts organisations with no office last, however many there are', () => {
    expect(rows.at(-1)).toMatchObject({ country: null, organisations: 1, cities: 0 });
  });
});
