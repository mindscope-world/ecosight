import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { OrgType } from '../schemas.js';

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
        querystring: Type.Object({ type: Type.Optional(OrgType) }),
        response: {
          200: Type.Object({
            type: Type.Literal('FeatureCollection'),
            features: Type.Array(Type.Any()),
          }),
        },
      },
    },
    async (req, reply) => {
      const type = req.query.type ?? null;
      const [row] = await sql<{ features: unknown[] }[]>`
        select coalesce(jsonb_agg(jsonb_build_object(
          'type', 'Feature',
          'geometry', st_asgeojson(geom, 6)::jsonb,
          'properties', jsonb_build_object(
            'office_id', office_id,
            'org_id', organisation_id,
            'name', name,
            'primary_type', types[1],
            'sector', sectors[1],
            'stage', stage,
            'is_hq', is_hq,
            'valid_from', valid_from
          )
        ) order by name, office_id), '[]'::jsonb) as features
        from public_office
        where ${type}::org_type is null or ${type}::org_type = any(types)
      `;
      reply.header('cache-control', 'public, max-age=60');
      return { type: 'FeatureCollection' as const, features: row?.features ?? [] };
    },
  );
};
