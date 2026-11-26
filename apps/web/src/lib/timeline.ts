/**
 * The deal-flow timeline: funding rounds placed on months. A round's date is
 * as precise as its source gave it, so a round known only to a month or a year is
 * never moved to a day it was not reported for: it lands in the month it names
 * and a round with no date, or dated only to a year, cannot be placed on a
 * month: it is counted apart and never drawn.
 */

export interface DatedRound {
  announced_on: string | null;
  announced_precision: 'day' | 'month' | 'year' | null;
  amount_usd: number | null;
}

/** "2026-10-07" as "2026-10". Null for no date, one that is not a date, or one known only to its year. */
export function monthOf(date: string | null, precision: DatedRound['announced_precision'] = 'day'): string | null {
  return date && precision !== 'year' && /^\d{4}-(0[1-9]|1[0-2])/.test(date) ? date.slice(0, 7) : null;
}

/** Whole months from `a` to `b`: months("2026-01", "2026-04") is 3. */
export function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}

export function addMonths(month: string, count: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Every month from the first to the last, inclusive. */
export function monthRange(first: string, last: string): string[] {
  return Array.from({ length: Math.max(0, monthsBetween(first, last)) + 1 }, (_, i) => addMonths(first, i));
}

export const WINDOWS = [1, 3, 12] as const;
export type Window = (typeof WINDOWS)[number];

/** The rounds in the `window` months ending with `end`, and those that cannot be placed. */
export function roundsIn<T extends DatedRound>(rounds: readonly T[], end: string, window: number): { shown: T[]; unplaced: number } {
  const start = addMonths(end, 1 - window);
  const shown: T[] = [];
  let unplaced = 0;
  for (const round of rounds) {
    const month = monthOf(round.announced_on, round.announced_precision);
    if (month === null) unplaced++;
    else if (month >= start && month <= end) shown.push(round);
  }
  return { shown, unplaced };
}

/** The earliest and latest month any round is dated to, or null when none is. */
export function span(rounds: readonly DatedRound[]): [string, string] | null {
  const months = rounds.map((round) => monthOf(round.announced_on, round.announced_precision)).filter((month): month is string => month !== null).sort();
  return months.length ? [months[0]!, months.at(-1)!] : null;
}
