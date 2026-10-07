import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { FilterQuery, filtersFrom, organisationConditions } from '../filters.js';
import { ErrorBody, OrgDetail, OrgList, OrgRow, OrgType } from '../schemas.js';

export const orgRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/orgs',
    {
      schema: {
        summary: 'Published organisations as rows, by name, for tables',
        querystring: Type.Object({
          type: Type.Optional(OrgType),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 500 })),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
          ...FilterQuery,
        }),
        response: { 200: OrgList },
      },
    },
    async (req) => {
      const { type, limit = 500, offset = 0 } = req.query;
      const where = sql`
        g.status = 'published'
        ${type ? sql`and ${type}::org_type = any(g.types)` : sql``}
        ${organisationConditions(sql, filtersFrom(req.query))}
      `;
      const [count] = await sql<{ total: number }[]>`select count(*)::int as total from organisation g where ${where}`;
      const organisations = await sql<OrgRow[]>`
        select
          g.id, g.name, g.types::text[] as types, g.sectors, g.stage, g.founded_year, g.is_active,
          g.website_domain, hq.city, hq.country::text as country, hq.precision::text as precision,
          f.raised_usd::float8 as raised_usd, f.portfolio, f.last_invested_on::text as last_invested_on,
          g.created_at::date::text as added_on,
          (select max(r.announced_on)::text from funding_round r
            where r.organisation_id = g.id and r.status = 'published') as last_round_on,
          (select max(p.created_at)::date::text from program p where p.organisation_id = g.id) as last_program_on,
          (select count(*)::int from funding_round r
            where r.organisation_id = g.id and r.status = 'published') as rounds,
          (select count(distinct ri.investor_id)::int from funding_round r
            join round_investor ri on ri.round_id = r.id
            join organisation i on i.id = ri.investor_id and i.status = 'published'
            where r.organisation_id = g.id and r.status = 'published') as investors,
          (select count(distinct pp.organisation_id)::int from program p
            join program_participant pp on pp.program_id = p.id
            join organisation x on x.id = pp.organisation_id and x.status = 'published'
            where p.organisation_id = g.id) as participants,
          (select count(*)::int from person_role pr
            where pr.organisation_id = g.id and not pr.opted_out) as people,
          (select max(s.verified_at) from field_source s
            where s.record_type = 'organisation' and s.record_id = g.id) as last_verified_at
        from organisation g
        join organisation_funding f on f.organisation_id = g.id
        left join lateral (
          select o.city, o.country, o.precision from office o
          where o.organisation_id = g.id and o.valid_to is null
          order by o.is_hq desc, o.valid_from nulls last limit 1
        ) hq on true
        where ${where}
        order by lower(g.name), g.id
        limit ${limit} offset ${offset}
      `;
      return { total: count!.total, organisations };
    },
  );

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
          g.website_domain, g.description, g.founded_year, g.is_active, g.funding_note,
          coalesce((
            select sum(r.amount_usd) from funding_round r
            where r.organisation_id = g.id and r.status = 'published'
          ), 0)::float8 as raised_usd,
          jsonb_build_object(
            'investors', coalesce((
              select jsonb_agg(distinct jsonb_build_object('id', i.id, 'name', i.name, 'types', i.types))
              from funding_round r
              join round_investor ri on ri.round_id = r.id
              join organisation i on i.id = ri.investor_id and i.status = 'published'
              where r.organisation_id = g.id and r.status = 'published'
            ), '[]'::jsonb),
            'portfolio', coalesce((
              select jsonb_agg(distinct jsonb_build_object('id', c.id, 'name', c.name, 'types', c.types))
              from round_investor ri
              join funding_round r on r.id = ri.round_id and r.status = 'published'
              join organisation c on c.id = r.organisation_id and c.status = 'published'
              where ri.investor_id = g.id
            ), '[]'::jsonb),
            -- Programs this organisation runs or took part in, with the other party.
            'programs', coalesce((
              select jsonb_agg(jsonb_build_object(
                'name', p.name,
                'organisation', jsonb_build_object('id', x.id, 'name', x.name, 'types', x.types)
              ) order by p.name, x.name)
              from program p
              join program_participant pp on pp.program_id = p.id
              join organisation x
                on x.id = case when p.organisation_id = g.id then pp.organisation_id else p.organisation_id end
                and x.status = 'published'
              where p.organisation_id = g.id or pp.organisation_id = g.id
            ), '[]'::jsonb),
            'events', coalesce((
              select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.starts_at)
              from event e
              where e.organiser_id = g.id and e.status = 'published'
            ), '[]'::jsonb),
            'affiliations', coalesce((
              select jsonb_agg(jsonb_build_object(
                'kind', l.kind, 'outgoing', l.source_id = g.id, 'label', l.label,
                'organisation', jsonb_build_object('id', x.id, 'name', x.name, 'types', x.types)
              ) order by l.kind, x.name)
              from organisation_link l
              join organisation x
                on x.id = case when l.source_id = g.id then l.target_id else l.source_id end
                and x.status = 'published'
              where l.status = 'published' and (l.source_id = g.id or l.target_id = g.id)
            ), '[]'::jsonb),
            'people', coalesce((
              select jsonb_agg(jsonb_build_object('name', pr.name, 'role', pr.role, 'linkedin_url', pr.linkedin_url) order by pr.name)
              from person_role pr
              where pr.organisation_id = g.id and not pr.opted_out
            ), '[]'::jsonb)
          ) as connections,
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
              'id', r.id, 'stage', r.stage, 'amount_usd', r.amount_usd::float8,
              'amount_original', r.amount_original::float8, 'currency', r.currency,
              'announced_on', r.announced_on, 'announced_precision', r.announced_precision
            ) order by r.announced_on desc nulls last)
            from funding_round r
            where r.organisation_id = g.id and r.status = 'published'
          ), '[]'::jsonb) as rounds,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'field', s.field, 'source_url', s.source_url, 'method', s.method,
              'quote', s.quote, 'verified_at', s.verified_at
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
