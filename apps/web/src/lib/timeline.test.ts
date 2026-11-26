import { describe, expect, it } from 'vitest';
import { addMonths, monthOf, monthRange, monthsBetween, roundsIn, span } from './timeline';

const round = (announced_on: string | null, precision: 'day' | 'month' | 'year' | null = 'day') => ({ announced_on, announced_precision: precision, amount_usd: 1 });

describe('months', () => {
  it('reads a month from a date and rejects what is not one', () => {
    expect(monthOf('2026-10-07')).toBe('2026-10');
    expect(monthOf('2026-10')).toBe('2026-10');
    expect(monthOf(null)).toBeNull();
    expect(monthOf('soon')).toBeNull();
    expect(monthOf('2026-13-01')).toBeNull();
    expect(monthOf('2025-01-01', 'year')).toBeNull();
  });

  it('counts and steps across year ends', () => {
    expect(monthsBetween('2025-11', '2026-02')).toBe(3);
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-02', '2026-02')).toEqual(['2026-02']);
  });
});

describe('rounds in a window', () => {
  const rounds = [round('2026-10-31'), round('2026-09-01'), round('2026-07-15'), round('2026-06', 'month'), round('2025-01', 'year'), round(null, null)];

  it('keeps the months ending at the cursor and counts those it cannot place apart', () => {
    // One has no date and one is known only to its year.
    expect(roundsIn(rounds, '2026-10', 1)).toEqual({ shown: [rounds[0]], unplaced: 2 });
    expect(roundsIn(rounds, '2026-10', 3).shown).toEqual([rounds[0], rounds[1]]);
    expect(roundsIn(rounds, '2026-10', 12).shown).toHaveLength(4);
    expect(roundsIn(rounds, '2025-01', 12).shown).toEqual([]); // a year-only round is never placed on January
  });

  it('puts a round known only to its month in that month, whatever the day', () => {
    expect(roundsIn(rounds, '2026-06', 1).shown).toEqual([rounds[3]]);
    expect(roundsIn(rounds, '2026-05', 1).shown).toEqual([]);
  });

  it('finds the span of dated rounds', () => {
    expect(span(rounds)).toEqual(['2026-06', '2026-10']);
    expect(span([round(null, null)])).toBeNull();
    expect(span([])).toBeNull();
  });
});
