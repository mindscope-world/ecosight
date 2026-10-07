import { describe, expect, it } from 'vitest';
import type { OrgRow } from '../api';
import { dashboardHash, SUBSETS, within } from './subsets';

const today = new Date('2026-10-07T12:00:00Z');
const row = (changes: Partial<OrgRow>) =>
  ({ precision: 'city', added_on: '2026-01-01', last_round_on: null, last_invested_on: null, last_program_on: null, ...changes }) as OrgRow;

describe('dashboard subsets', () => {
  it('counts a date as recent up to the stated number of days back', () => {
    expect(within('2026-10-07', 30, today)).toBe(true);
    expect(within('2026-09-08', 30, today)).toBe(true);
    expect(within('2026-09-06', 30, today)).toBe(false);
    expect(within(null, 30, today)).toBe(false);
    // A round dated ahead of today is not recent activity.
    expect(within('2026-12-01', 30, today)).toBe(false);
  });

  it('each list holds the rows its figure on the map counts', () => {
    expect(SUBSETS.unplaced!.test(row({ precision: null }), today)).toBe(true);
    expect(SUBSETS.unplaced!.test(row({}), today)).toBe(false);
    expect(SUBSETS.added!.test(row({ added_on: '2026-10-01' }), today)).toBe(true);
    expect(SUBSETS.rounds!.test(row({ last_round_on: '2026-09-20' }), today)).toBe(true);
    expect(SUBSETS.rounds!.test(row({ last_round_on: '2025-09-20' }), today)).toBe(false);
    expect(SUBSETS.active!.test(row({ last_invested_on: '2025-11-01' }), today)).toBe(true);
    expect(SUBSETS.active!.test(row({ last_invested_on: '2024-11-01' }), today)).toBe(false);
    expect(SUBSETS.programs!.test(row({ last_program_on: '2026-10-06' }), today)).toBe(true);
  });

  it('names a list in the address', () => {
    expect(dashboardHash('startups', 'added')).toBe('v=1&t=startups&w=added');
    expect(dashboardHash('investors')).toBe('v=1&t=investors');
  });
});
