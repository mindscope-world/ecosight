export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat().format(count);
}

/** "2026-03" as "Mar", or "Mar 2026" when long. */
export function formatMonth(month: string, long = false): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: long ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

const UNITS: [limit: number, seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [3600, 60, 'minute'],
  [86_400, 3600, 'hour'],
  [2_592_000, 86_400, 'day'],
  [31_536_000, 2_592_000, 'month'],
  [Infinity, 31_536_000, 'year'],
];

/** "12 min ago", "3 hr ago". Anything under a minute is "just now". */
export function formatAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const [, size, unit] = UNITS.find(([limit]) => seconds < limit)!;
  return new Intl.RelativeTimeFormat('en', { style: 'short' }).format(-Math.floor(seconds / size), unit);
}

/**
 * Change between two periods as a percentage. There is no percentage when the
 * earlier period was empty, so that case shows a dash and never a number.
 */
export function trend(current: number, previous: number): { text: string; tone: 'up' | 'down' | 'flat' | 'none' } {
  if (previous === 0) return { text: '—', tone: 'none' };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) return { text: '0.0%', tone: 'flat' };
  return { text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, tone: change > 0 ? 'up' : 'down' };
}
