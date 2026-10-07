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

/** A date shown only as precisely as it is known: "2021", "Apr 2024" or "Feb 14, 2023". */
export function formatPartialDate(iso: string, precision: 'day' | 'month' | 'year' | null): string {
  if (precision === 'year') return iso.slice(0, 4);
  if (precision === 'month') return formatMonth(iso.slice(0, 7), true);
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}

/** An amount in its own currency, compact: "$3.7M", "CA$4K". */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(amount);
}

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });

/** "KE" as "Kenya". A code the browser does not know is shown as it is. */
export function countryName(code: string): string {
  try {
    return REGIONS.of(code) ?? code;
  } catch {
    return code;
  }
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
