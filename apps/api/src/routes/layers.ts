import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { eventConditions, FilterQuery, filtersFrom, organisationConditions } from '../filters.js';
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
