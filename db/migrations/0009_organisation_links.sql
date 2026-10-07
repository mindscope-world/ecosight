-- Ties between two organisations that are not a funding round or a programme:
-- one is part of another, hosted by it, a member of it, founded by it, backed by
-- it with no round on record, or works with it. Each row reads "source <kind>
-- target". The evidence for a link is in field_source, as for everything else.
create table organisation_link (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references organisation on delete cascade,
  target_id uuid not null references organisation on delete cascade,
  kind text not null check (kind in ('part_of', 'hosted_by', 'member_of', 'founded_by', 'funded_by', 'partner_of')),
  -- A few words on the tie, where there is something to say: the unit, the grant.
  label text,
  status record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_id <> target_id),
  unique (source_id, target_id, kind)
);
create index organisation_link_target on organisation_link (target_id);

-- The graph gains these as edges of their own kinds.
create or replace view graph_edge as
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
where g.status = 'published'

union all
select
  l.kind, 'org:' || l.source_id, 'org:' || l.target_id,
  l.source_id, l.target_id, l.id, l.label, null::date
from organisation_link l
join organisation a on a.id = l.source_id and a.status = 'published'
join organisation b on b.id = l.target_id and b.status = 'published'
where l.status = 'published';
