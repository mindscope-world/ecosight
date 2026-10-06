import { describe, expect, it } from 'vitest';
import type { Stats } from '../api';
import { countryName, formatAgo, formatPartialDate, trend } from './format';
import { greatCircle } from './geo';
import { buildSignals } from './signals';

const zero = { current: 0, previous: 0 };
const stats: Stats = {
  organisations: 10, offices: 12, countries: 1, last_updated: null, upcoming_events: 0, rounds: 0,
  raised_usd: 0, cities: [], recent: [], by_type: [], top_sectors: [], recent_rounds: [],
  funding_by_month: [{ month: '2026-09', amount_usd: 0, rounds: 0 }],
  activity: { startups_added: zero, rounds_announced: zero, active_investors: zero, programs_added: zero, events_next_30_days: 0 },
};

describe('trend', () => {
  it('gives a signed percentage', () => {
    expect(trend(114, 100)).toEqual({ text: '+14.0%', tone: 'up' });
    expect(trend(50, 100)).toEqual({ text: '-50.0%', tone: 'down' });
    expect(trend(7, 7)).toEqual({ text: '0.0%', tone: 'flat' });
  });

  it('never invents a percentage when the earlier period was empty', () => {
    expect(trend(30, 0)).toEqual({ text: '—', tone: 'none' });
    expect(trend(0, 0)).toEqual({ text: '—', tone: 'none' });
  });
});

describe('formatAgo', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  it('picks the largest fitting unit', () => {
    expect(formatAgo('2026-10-06T11:59:40Z', now)).toBe('just now');
    expect(formatAgo('2026-10-06T11:48:00Z', now)).toBe('12 min. ago');
    expect(formatAgo('2026-10-06T09:00:00Z', now)).toBe('3 hr. ago');
    expect(formatAgo('2026-10-03T12:00:00Z', now)).toBe('3 days ago');
  });
});

describe('countryName', () => {
  it('names a country from its code and passes through what it does not know', () => {
    expect(countryName('KE')).toBe('Kenya');
    expect(countryName('not a code')).toBe('not a code');
  });
});

describe('formatPartialDate', () => {
  it('shows no more of a date than is known', () => {
    expect(formatPartialDate('2021-01-01', 'year')).toBe('2021');
    expect(formatPartialDate('2024-04-01', 'month')).toMatch(/^Apr 2024$/);
    expect(formatPartialDate('2023-02-14', 'day')).toMatch(/14/);
  });
});

describe('signals', () => {
  it('says nothing when there is nothing to report', () => {
    expect(buildSignals(stats, [])).toEqual([]);
    expect(buildSignals(stats, [{ sector: 'fintech', share: 0.1 }])).toEqual([]);
  });

  it('reports only what the figures support', () => {
    const busy: Stats = {
      ...stats,
      funding_by_month: [{ month: '2026-09', amount_usd: 2_500_000, rounds: 2 }],
      activity: { ...stats.activity, rounds_announced: { current: 3, previous: 2 }, startups_added: { current: 5, previous: 0 } },
    };
    const signals = buildSignals(busy, [{ sector: 'fintech', share: 0.28 }]);
    expect(signals.map((s) => s.title)).toEqual(['fintech leads', 'Funding activity', 'New on the map', 'Capital deployed']);
    expect(signals[1]!.tag).toEqual({ text: '+50.0%', tone: 'up' });
    expect(signals[2]!.tag).toBeUndefined();
    expect(signals[3]!.detail).toContain('$2.5M');
  });
});

describe('greatCircle', () => {
  it('runs from one place to the other and bows toward the pole', () => {
    const line = greatCircle([36.82, -1.29], [-77.04, 38.9], 10); // Nairobi to Washington
    expect(line).toHaveLength(11);
    expect(line[0]![0]).toBeCloseTo(36.82, 5);
    expect(line[10]![1]).toBeCloseTo(38.9, 5);
    // Halfway along it is north of the straight-line midpoint between the two latitudes.
    expect(line[5]![1]).toBeGreaterThan((-1.29 + 38.9) / 2);
  });

  it('draws nothing but the two ends between a place and itself', () => {
    expect(greatCircle([36.82, -1.29], [36.82, -1.29])).toEqual([[36.82, -1.29], [36.82, -1.29]]);
  });
});
