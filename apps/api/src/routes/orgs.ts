import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { ErrorBody, OrgDetail } from '../schemas.js';

export const orgRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/orgs/:id',
    {
      schema: {
        summary: 'Detail card for one organisation, with sources and verification dates',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: OrgDetail, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const [org] = await sql<OrgDetail[]>`
        select
          g.id, g.name, g.slug, g.types::text[] as types, g.sectors, g.stage,
          g.website_domain, g.description,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id, 'is_hq', o.is_hq, 'address', o.address, 'city', o.city,
              'country', o.country, 'precision', o.precision,
              'lon', st_x(o.geom::geometry), 'lat', st_y(o.geom::geometry)
            ) order by o.is_hq desc, o.valid_from)
            from office o
            where o.organisation_id = g.id and o.valid_to is null
          ), '[]'::jsonb) as offices,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'field', s.field, 'source_url', s.source_url, 'method', s.method,
              'verified_at', s.verified_at
            ) order by s.field)
            from field_source s
            where s.record_type = 'organisation' and s.record_id = g.id
          ), '[]'::jsonb) as sources,
          (
            select max(s.verified_at) from field_source s
            where s.record_type = 'organisation' and s.record_id = g.id
          ) as last_verified_at
        from organisation g
        where g.id = ${id} and g.status = 'published'
      `;
      if (!org) return reply.code(404).send({ error: 'Organisation not found' });
      return org;
    },
  );
};
