import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { areaCondition, eventConditions, FilterQuery, filtersFrom, organisationConditions } from '../filters.js';
import { OrgType } from '../schemas.js';

const FeatureCollection = Type.Object({
  type: Type.Literal('FeatureCollection'),
  features: Type.Array(Type.Any()),
});

/**
 * Public map layers as GeoJSON. In production these are built on a schedule and
 * served as static files from the CDN; this route is the same query, live.
 */
export const layerRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/layers/offices.geojson',
    {
      schema: {
        summary: 'Current offices of published organisations',
        querystring: Type.Object({ type: Type.Optional(OrgType), ...FilterQuery }),
        response: { 200: FeatureCollection },
      },
    },
    async (req, reply) => {
      const type = req.query.type ?? null;
      const filters = filtersFrom(req.query);
      const [row] = await sql<{ features: unknown[] }[]>`
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', st_asgeojson(geom, 6)::jsonb,
          'properties', jsonb_build_object(
            'office_id', office_id,
            'org_id', organisation_id,
            'name', name,
            'primary_type', types[1],
            'types', types,
            'sector', sectors[1],
            'sectors', sectors,
            'stage', stage,
            'is_hq', is_hq,
            'precision', precision,
            'city', city,
            'country', country,
            'founded_year', founded_year,
            'is_active', is_active,
            'raised_usd', f.raised_usd::float8,
            'funding_years', f.funding_years,
            'led_rounds', f.led_rounds,
            'portfolio', f.portfolio,
            'last_invested_on', f.last_invested_on,
            'valid_from', valid_from
          )
        ) order by name, office_id), '[]'::jsonb) as features
        from public_office o
        join organisation_funding f using (organisation_id)
        where (${type}::org_type is null or ${type}::org_type = any(types))
          and organisation_id in (
            select g.id from organisation g where true ${organisationConditions(sql, filters)}
          )
          -- With a place filter, only the offices in that place are drawn.
          and (${filters.city}::text is null or o.city = ${filters.city})
          and (${filters.country}::text is null or o.country = ${filters.country})
          ${areaCondition(sql, filters.area, sql`o.geom`)}
      `;
      reply.header('cache-control', 'public, max-age=60');
      return { type: 'FeatureCollection' as const, features: row?.features ?? [] };
    },
  );

  app.get(
    '/layers/rounds.geojson',
    {
      schema: {
        summary: 'Published funding rounds, each placed at its organisation\'s main office',
        response: { 200: FeatureCollection },
      },
    },
    async (_req, reply) => {
      // One point per round, at the head office when there is one. A round with no office on record is left out.
      // The date is as precise as the source gave it: a month or a year is not made into a day.
      const [row] = await sql<{ features: unknown[] }[]>`
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', st_asgeojson(o.geom, 6)::jsonb,
          'properties', jsonb_build_object(
            'round_id', r.id,
            'org_id', o.organisation_id,
            'name', o.name,
            'types', o.types,
            'sector', o.sectors[1],
            'stage', r.stage,
            'amount_usd', r.amount_usd::float8,
            'announced_on', r.announced_on::text,
            'announced_precision', r.announced_precision,
            'city', o.city,
            'country', o.country,
            'precision', o.precision
          )
        ) order by r.announced_on nulls first, r.id), '[]'::jsonb) as features
        from funding_round r
        join lateral (
          select * from public_office p where p.organisation_id = r.organisation_id
          order by p.is_hq desc, p.valid_from nulls last, p.office_id limit 1
        ) o on true
        where r.status = 'published'
      `;
      reply.header('cache-control', 'public, max-age=60');
      return { type: 'FeatureCollection' as const, features: row?.features ?? [] };
    },
  );

  app.get(
    '/layers/events.geojson',
    {
      schema: {
        summary: 'Published events that have not ended',
        querystring: Type.Object(FilterQuery),
        response: { 200: FeatureCollection },
      },
    },
    async (req, reply) => {
      const filters = filtersFrom(req.query);
      const [row] = await sql<{ features: unknown[] }[]>`
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', st_asgeojson(geom, 6)::jsonb,
          'properties', jsonb_build_object(
            'event_id', event_id,
            'name', name,
            'venue', venue,
            'city', city,
            'country', country,
            'starts_at', starts_at
          )
        ) order by starts_at, event_id), '[]'::jsonb) as features
        from public_event
        where coalesce(ends_at, starts_at) >= now() ${eventConditions(sql, filters)}
      `;
      reply.header('cache-control', 'public, max-age=60');
      return { type: 'FeatureCollection' as const, features: row?.features ?? [] };
    },
  );
};
