import { describe, expect, it } from 'vitest';
import { hoverCard } from './hoverCard';

describe('hover card', () => {
  it('says what a record is, where, and its one telling figure', () => {
    expect(
      hoverCard({
        layer: 'startups',
        properties: { name: 'Sample Pay', types: ['startup'], sectors: ['fintech', 'software', 'ai'], stage: 'seed', city: 'Lagos', country: 'NG', precision: 'area', raised_usd: 1_500_000 },
      }),
    ).toEqual({ title: 'Sample Pay', lines: ['Startup · fintech / software', 'Lagos, Nigeria', 'Raised $1.5M · seed'] });
  });

  it('describes an investor by its portfolio and marks a city-level place', () => {
    const card = hoverCard({
      layer: 'investors',
      properties: { name: 'Sample Fund', types: ['fund'], sectors: [], stage: null, city: 'Nairobi', country: 'KE', precision: 'city', raised_usd: 0, portfolio: 6 },
    });
    expect(card?.lines).toEqual(['Investor', 'Nairobi, Kenya · city level', '6 in its portfolio on record']);
  });

  it('leaves out what is not on record, and has nothing to say without a name', () => {
    expect(hoverCard({ layer: 'ngos', properties: { name: 'Sample Trust', types: ['ngo'], sectors: [] } })).toEqual({ title: 'Sample Trust', lines: ['NGO'] });
    expect(hoverCard({ layer: 'startups', properties: {} })).toBeNull();
    expect(hoverCard({ layer: 'events', properties: { name: 'Sample Meetup', venue: 'iHub', city: 'Nairobi', country: 'KE' } })?.lines.slice(0, 2)).toEqual(['Event', 'iHub, Nairobi, Kenya']);
  });
});
