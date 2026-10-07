-- The ecosystem as a graph: one row per link between two things, read from the
-- tables that already hold them. Nothing is stored twice. The graph API walks
-- this view, and a graph database can later be filled from it (ADR 0003).
--
-- A node is named by its kind and its key: org:<id>, event:<id>, person:<id>,
-- place:<country>/<city>, sector:<name>. Only published records appear, and a
-- person only as a role that has not been opted out.

create view graph_edge as
-- An investor took part in a company's round. One row per round.
select
  'invested_in'::text as kind,
  'org:' || ri.investor_id as source,
  'org:' || r.organisation_id as target,
  ri.investor_id as source_org,
  r.organisation_id as target_org,
  r.id as ref_id,
  null::text as label,
  r.announced_on as occurred_on
from round_investor ri
join funding_round r on r.id = ri.round_id and r.status = 'published'
join organisation i on i.id = ri.investor_id and i.status = 'published'
join organisation c on c.id = r.organisation_id and c.status = 'published'
where ri.investor_id <> r.organisation_id

union all
-- An organisation went through a programme run by another.
select
  'accelerated_at', 'org:' || pp.organisation_id, 'org:' || p.organisation_id,
  pp.organisation_id, p.organisation_id, p.id, p.name, p.valid_from
from program_participant pp
join program p on p.id = pp.program_id
join organisation a on a.id = pp.organisation_id and a.status = 'published'
join organisation b on b.id = p.organisation_id and b.status = 'published'
where pp.organisation_id <> p.organisation_id

union all
select
  'organised', 'org:' || e.organiser_id, 'event:' || e.id,
  e.organiser_id, null::uuid, e.id, null, (e.starts_at at time zone 'UTC')::date
from event e
join organisation g on g.id = e.organiser_id and g.status = 'published'
where e.status = 'published'

union all
select
  'has_role', 'person:' || pr.id, 'org:' || pr.organisation_id,
  null::uuid, pr.organisation_id, pr.id, pr.role, null::date
from person_role pr
join organisation g on g.id = pr.organisation_id and g.status = 'published'
where not pr.opted_out

union all
-- Places are cities, never addresses, so this is safe for records held at city level.
select distinct
  'located_in', 'org:' || o.organisation_id, 'place:' || o.country || '/' || o.city,
  o.organisation_id, null::uuid, null::uuid, null::text, null::date
from office o
join organisation g on g.id = o.organisation_id and g.status = 'published'
where o.valid_to is null

union all
select
  'in_sector', 'org:' || g.id, 'sector:' || s.name,
  g.id, null::uuid, null::uuid, null::text, null::date
from organisation g
cross join lateral (select distinct unnest(g.sectors) as name) s
where g.status = 'published';
