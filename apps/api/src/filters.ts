import {
  ACTIVE_INVESTOR_DAYS,
  decodeFilters,
  INVESTOR_TYPES,
  type Filters,
} from '@atlas/schema';
import { Type } from '@sinclair/typebox';
import type { Sql } from './db.js';

/** The filter parts of a query string, exactly as share links carry them. */
export const FilterQuery = {
  fs: Type.Optional(Type.String({ description: 'Sectors, comma-separated' })),
  fg: Type.Optional(Type.String({ description: 'Funding stages, comma-separated' })),
  fc: Type.Optional(Type.String({ description: 'City' })),
  fk: Type.Optional(Type.String({ description: 'Country, two-letter code' })),
  fa: Type.Optional(Type.String({ description: 'active or inactive' })),
  fy: Type.Optional(Type.String({ description: 'Founded years, from-to; either side may be empty' })),
  fr: Type.Optional(Type.String({ description: 'Least total raised, US dollars' })),
  fd: Type.Optional(Type.String({ description: 'Years with a funding round, from-to' })),
  fi: Type.Optional(Type.String({ description: 'Investors only: active, lead or portfolio' })),
  fe: Type.Optional(Type.String({ description: 'Event start dates, from_to (YYYY-MM-DD)' })),
};

export function filtersFrom(query: Record<string, unknown>): Filters {
  const params = new URLSearchParams();
  for (const key of Object.keys(FilterQuery)) {
    const value = query[key];
    if (typeof value === 'string') params.set(key, value);
  }
  return decodeFilters(params);
}

/**
 * Conditions on `organisation g` for the organisations that pass the filters.
 * This is the SQL form of `matches` in the shared schema package; a test checks
 * that the two give the same answer.
 */
export function organisationConditions(sql: Sql, filters: Filters) {
  const f = filters;
  const none = sql``;
  return sql`
    ${f.sectors.length ? sql`and g.sectors && ${f.sectors}::text[]` : none}
    ${f.stages.length ? sql`and g.stage = any(${f.stages}::text[])` : none}
    ${f.status !== 'all' ? sql`and g.is_active = ${f.status === 'active'}` : none}
    ${f.foundedFrom !== null ? sql`and g.founded_year >= ${f.foundedFrom}` : none}
    ${f.foundedTo !== null ? sql`and g.founded_year <= ${f.foundedTo}` : none}
    ${
      f.city !== null || f.country !== null
        ? sql`and exists (
            select 1 from office o
            where o.organisation_id = g.id and o.valid_to is null
              ${f.city !== null ? sql`and o.city = ${f.city}` : none}
              ${f.country !== null ? sql`and o.country = ${f.country}` : none}
          )`
        : none
    }
    ${
      f.raisedMin !== null
        ? sql`and (select raised_usd from organisation_funding where organisation_id = g.id) >= ${f.raisedMin}`
        : none
    }
    ${
      f.fundedFrom !== null || f.fundedTo !== null
        ? sql`and exists (
            select 1 from organisation_funding ff, unnest(ff.funding_years) y
            where ff.organisation_id = g.id
              and y >= ${f.fundedFrom ?? 0} and y <= ${f.fundedTo ?? 9999}
          )`
        : none
    }
    ${
      f.investor !== 'any'
        ? sql`and (
            not (g.types && ${[...INVESTOR_TYPES]}::org_type[])
            or exists (
              select 1 from organisation_funding ff where ff.organisation_id = g.id and ${
                f.investor === 'lead'
                  ? sql`ff.led_rounds > 0`
                  : f.investor === 'portfolio'
                    ? sql`ff.portfolio > 0`
                    : sql`ff.last_invested_on >= current_date - ${ACTIVE_INVESTOR_DAYS}::int`
              }
            )
          )`
        : none
    }
  `;
}

/** Conditions on a `public_event` row: events follow the place and date filters only. */
export function eventConditions(sql: Sql, filters: Filters) {
  const none = sql``;
  return sql`
    ${filters.city !== null ? sql`and city = ${filters.city}` : none}
    ${filters.country !== null ? sql`and country = ${filters.country}` : none}
    ${filters.eventFrom !== null ? sql`and starts_at::date >= ${filters.eventFrom}::date` : none}
    ${filters.eventTo !== null ? sql`and starts_at::date <= ${filters.eventTo}::date` : none}
  `;
}
