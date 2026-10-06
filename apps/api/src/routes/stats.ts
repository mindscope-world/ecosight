import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Sql } from '../db.js';
import { eventConditions, FilterQuery, filtersFrom, organisationConditions } from '../filters.js';
import { Stats } from '../schemas.js';

export const statsRoutes: FastifyPluginAsyncTypebox<{ sql: Sql }> = async (app, { sql }) => {
  app.get(
    '/stats',
    {
      schema: {
        summary: 'Totals and activity over published records, narrowed by the filters given',
        querystring: Type.Object(FilterQuery),
        response: { 200: Stats },
      },
    },
    async (req, reply) => {
      const filters = filtersFrom(req.query);
      // Every figure below reads from these four sets, so one place decides what is in scope.
      const [stats] = await sql<Stats[]>`
        with org as (
          select g.* from organisation g
          where g.status = 'published' ${organisationConditions(sql, filters)}
        ),
        site as (
          select o.* from public_office o
          where o.organisation_id in (select id from org)
            and (${filters.city}::text is null or o.city = ${filters.city})
            and (${filters.country}::text is null or o.country = ${filters.country})
        ),
        published_round as (
          select r.id, r.organisation_id, g.name, r.stage, r.amount_usd, r.announced_on, r.created_at, r.updated_at
          from funding_round r
          join org g on g.id = r.organisation_id
          where r.status = 'published'
        ),
        happening as (
          select * from public_event where true ${eventConditions(sql, filters)}
        )
        select
          (select count(*)::int from org) as organisations,
          (select count(*)::int from site) as offices,
          (select count(*)::int from happening where coalesce(ends_at, starts_at) >= now())
            as upcoming_events,
          (select count(*)::int from published_round) as rounds,
          (select coalesce(sum(amount_usd), 0)::float8 from published_round) as raised_usd,
          -- An organisation with several types counts once under each.
          (select count(distinct country)::int from site) as countries,
          (
            select greatest(
              (select max(updated_at) from org),
              (select max(updated_at) from published_round),
              (select max(e.updated_at) from happening h join event e on e.id = h.event_id)
            )
          ) as last_updated,
          jsonb_build_object(
            'startups_added', (
              select jsonb_build_object(
                'current', count(*) filter (where created_at >= now() - interval '30 days'),
                'previous', count(*) filter (where created_at < now() - interval '30 days')
              )
              from org
              where 'startup' = any(types) and created_at >= now() - interval '60 days'
            ),
            'rounds_announced', (
              select jsonb_build_object(
                'current', count(*) filter (where announced_on >= current_date - 30),
                'previous', count(*) filter (where announced_on < current_date - 30)
              )
              from published_round where announced_on >= current_date - 60
            ),
            'active_investors', (
              select jsonb_build_object(
                'current', count(distinct ri.investor_id)
                  filter (where r.announced_on >= current_date - 365),
                'previous', count(distinct ri.investor_id)
                  filter (where r.announced_on < current_date - 365)
              )
              from published_round r join round_investor ri on ri.round_id = r.id
              where r.announced_on >= current_date - 730
            ),
            'programs_added', (
              select jsonb_build_object(
                'current', count(*) filter (where created_at >= now() - interval '30 days'),
                'previous', count(*) filter (where created_at < now() - interval '30 days')
              )
              from program
              where organisation_id in (select id from org) and created_at >= now() - interval '60 days'
            ),
            'events_next_30_days', (
              select count(*) from happening
              where starts_at >= now() and starts_at < now() + interval '30 days'
            )
          ) as activity,
          -- Activity score: organisations + 3 per round announced in the last 12 months
          -- + 2 per upcoming event, scaled so the busiest city is 100.
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'city', city, 'country', country, 'organisations', orgs, 'rounds_12m', rounds,
              'upcoming_events', events, 'lon', lon, 'lat', lat,
              'score', round(100.0 * raw / top)::int
            ) order by raw desc, city)
            from (select *, max(raw) over () as top from (
              select c.city, c.country, c.orgs, c.lon, c.lat,
                coalesce(r.rounds, 0) as rounds, coalesce(e.events, 0) as events,
                c.orgs + 3 * coalesce(r.rounds, 0) + 2 * coalesce(e.events, 0) as raw
              from (
                select city, country, count(distinct organisation_id)::int as orgs,
                  avg(st_x(geom::geometry)) as lon, avg(st_y(geom::geometry)) as lat
                from site group by city, country
              ) c
              left join (
                select o.city, o.country, count(distinct pr.id)::int as rounds
                from published_round pr
                join site o on o.organisation_id = pr.organisation_id and o.is_hq
                where pr.announced_on >= current_date - 365
                group by o.city, o.country
              ) r using (city, country)
              left join (
                select city, country, count(*)::int as events from happening
                where coalesce(ends_at, starts_at) >= now() group by city, country
              ) e using (city, country)
              order by raw desc limit 8
            ) scored) ranked
          ), '[]'::jsonb) as cities,
          (
            select jsonb_agg(jsonb_build_object(
              'month', to_char(m, 'YYYY-MM'),
              'amount_usd', coalesce(f.amount, 0)::float8,
              'rounds', coalesce(f.rounds, 0)
            ) order by m)
            from generate_series(
              date_trunc('month', current_date) - interval '11 months',
              date_trunc('month', current_date), interval '1 month'
            ) m
            left join (
              select date_trunc('month', announced_on) as month,
                sum(amount_usd) as amount, count(*)::int as rounds
              from published_round group by 1
            ) f on f.month = m
          ) as funding_by_month,
          coalesce((
            select jsonb_agg(jsonb_build_object('kind', kind, 'id', id, 'label', label, 'at', at) order by at desc, label)
            from (
              (select 'organisation' as kind, id, name as label, created_at as at
                from org)
              union all
              (select 'round', organisation_id, name, created_at from published_round)
              union all
              (select 'event', p.event_id, p.name, e.created_at
                from happening p join event e on e.id = p.event_id)
              order by at desc, label limit 8
            ) feed
          ), '[]'::jsonb) as recent,
          coalesce((
            select jsonb_agg(jsonb_build_object('type', type, 'count', n) order by n desc, type)
            from (
              select unnest(types)::text as type, count(*)::int as n
              from org group by 1
            ) t
          ), '[]'::jsonb) as by_type,
          coalesce((
            select jsonb_agg(jsonb_build_object('sector', sector, 'count', n) order by n desc, sector)
            from (
              select unnest(sectors) as sector, count(*)::int as n
              from org group by 1 order by n desc, 1 limit 8
            ) s
          ), '[]'::jsonb) as top_sectors,
          coalesce((
            select jsonb_agg(r order by r.announced_on desc nulls last, r.name)
            from (
              select id, organisation_id, name, stage, amount_usd::float8 as amount_usd, announced_on
              from published_round order by announced_on desc nulls last, name limit 6
            ) r
          ), '[]'::jsonb) as recent_rounds
      `;
      reply.header('cache-control', 'public, max-age=60');
      return stats!;
    },
  );
};
