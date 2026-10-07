import type { OrgRow } from '../api';
import type { PointLayerDef } from '../entities';

export interface CountryRow {
  /** Two-letter code, or null for organisations with no office on record. */
  country: string | null;
  organisations: number;
  cities: number;
  /** How many of each kind, by layer id. An organisation of two kinds counts under both. */
  kinds: Record<string, number>;
  /** Rounds raised by organisations based there, and their total in US dollars. */
  rounds: number;
  raised_usd: number;
}

/**
 * What is on record for each country, counting an organisation where its
 * headquarters is. Largest first; organisations with no office come last.
 */
export function summariseCountries(rows: readonly OrgRow[], layers: readonly PointLayerDef[]): CountryRow[] {
  const byCountry = new Map<string | null, { row: CountryRow; cities: Set<string> }>();
  for (const org of rows) {
    let entry = byCountry.get(org.country);
    if (!entry) {
      entry = {
        row: { country: org.country, organisations: 0, cities: 0, kinds: {}, rounds: 0, raised_usd: 0 },
        cities: new Set(),
      };
      byCountry.set(org.country, entry);
    }
    entry.row.organisations += 1;
    entry.row.rounds += org.rounds;
    entry.row.raised_usd += org.raised_usd;
    if (org.city) entry.cities.add(org.city);
    for (const layer of layers)
      if (layer.types.some((type) => org.types.includes(type)))
        entry.row.kinds[layer.id] = (entry.row.kinds[layer.id] ?? 0) + 1;
  }
  return [...byCountry.values()]
    .map(({ row, cities }) => ({ ...row, cities: cities.size }))
    .sort(
      (a, b) =>
        Number(a.country === null) - Number(b.country === null) ||
        b.organisations - a.organisations ||
        (a.country ?? '').localeCompare(b.country ?? ''),
    );
}
