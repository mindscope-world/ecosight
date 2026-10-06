import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { ErrorBody, RoundDetail } from '../schemas.js';

export const roundRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/rounds/:id',
    {
      schema: {
        summary: 'One funding round with its investors and sources',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: RoundDetail, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const [round] = await sql<RoundDetail[]>`
        select
          r.id, r.stage, r.currency, r.announced_on::text as announced_on,
          r.amount_original::float8 as amount_original,
          r.amount_usd::float8 as amount_usd,
          jsonb_build_object('id', g.id, 'name', g.name) as organisation,
          coalesce((
            select jsonb_agg(
              jsonb_build_object('id', i.id, 'name', i.name, 'is_lead', ri.is_lead)
              order by ri.is_lead desc, i.name
            )
            from round_investor ri
            join organisation i on i.id = ri.investor_id and i.status = 'published'
            where ri.round_id = r.id
          ), '[]'::jsonb) as investors,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'field', s.field, 'source_url', s.source_url, 'method', s.method,
              'verified_at', s.verified_at
            ) order by s.field)
            from field_source s
            where s.record_type = 'funding_round' and s.record_id = r.id
          ), '[]'::jsonb) as sources
        from funding_round r
        join organisation g on g.id = r.organisation_id and g.status = 'published'
        where r.id = ${req.params.id} and r.status = 'published'
      `;
      if (!round) return reply.code(404).send({ error: 'Round not found' });
      return round;
    },
  );
};
