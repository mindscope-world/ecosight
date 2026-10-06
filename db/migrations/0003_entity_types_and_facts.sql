-- More kinds of ecosystem organisation, and the facts the detail panel and the
-- filters need: when an organisation was founded and whether it still operates.

alter type org_type add value if not exists 'incubator';
alter type org_type add value if not exists 'development_funder';
alter type org_type add value if not exists 'innovation_hub';
alter type org_type add value if not exists 'university';
alter type org_type add value if not exists 'government_program';

alter table organisation
  add column founded_year smallint check (founded_year between 1800 and 2100),
  add column is_active boolean not null default true;

-- New columns go at the end: a view's existing columns cannot be reordered.
create or replace view public_office as
select
  o.id as office_id,
  o.organisation_id,
  g.name,
  g.slug,
  g.types,
  g.sectors,
  g.stage,
  o.is_hq,
  o.city,
  o.country,
  o.precision,
  o.valid_from,
  o.geom,
  g.founded_year,
  g.is_active,
  (
    select coalesce(sum(r.amount_usd), 0)
    from funding_round r
    where r.organisation_id = g.id and r.status = 'published'
  ) as raised_usd
from office o
join organisation g on g.id = o.organisation_id
where g.status = 'published' and o.valid_to is null;
