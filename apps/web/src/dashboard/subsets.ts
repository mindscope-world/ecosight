import type { OrgRow } from '../api';

/**
 * Narrower lists of a tab's rows that other pages link to: the map's activity
 * figures each lead to the rows they count. Named in the address as `w=<id>`.
 */
export interface Subset {
  /** What the list holds, as shown on the chip that removes it. */
  label: string;
  /** The tab the list belongs on, when it is not any tab. */
  tab?: string;
  test: (row: OrgRow, today: Date) => boolean;
}

/** True when an ISO date falls within the given number of days before today. */
export function within(date: string | null, days: number, today: Date): boolean {
  if (!date) return false;
  const age = (today.getTime() - new Date(date).getTime()) / 86_400_000;
  return age <= days && age >= -1;
}

export const SUBSETS: Record<string, Subset> = {
  unplaced: { label: 'Not on the map', test: (row) => row.precision === null },
  added: { label: 'Added in the last 30 days', test: (row, today) => within(row.added_on, 30, today) },
  rounds: {
    label: 'A round announced in the last 30 days',
    tab: 'startups',
    test: (row, today) => within(row.last_round_on, 30, today),
  },
  active: {
    label: 'Invested in the last 12 months',
    tab: 'investors',
    test: (row, today) => within(row.last_invested_on, 365, today),
  },
  programs: {
    label: 'A programme added in the last 30 days',
    tab: 'accelerators',
    test: (row, today) => within(row.last_program_on, 30, today),
  },
};

/** The dashboard's address for one tab, narrowed to a subset when one is named. */
export const dashboardHash = (tab: string, subset?: string) => `v=1&t=${tab}${subset ? `&w=${subset}` : ''}`;
