-- An investor's portfolio, the rounds it led and the last time it invested are
-- counted without the relationships a reviewer has taken down (0015), so the
-- tables and the map agree with the graph. What a company raised is unchanged:
-- the round itself stays on record.
create or replace view organisation_funding as
select
  g.id as organisation_id,
  coalesce((
    select sum(r.amount_usd) from funding_round r
    where r.organisation_id = g.id and r.status = 'published'
  ), 0) as raised_usd,
  -- Years in which it raised a round or took part in one as an investor.
  array(
    select distinct extract(year from r.announced_on)::int
    from funding_round r
    left join round_investor ri on ri.round_id = r.id
    where r.status = 'published' and r.announced_on is not null
      and (r.organisation_id = g.id or ri.investor_id = g.id)
    order by 1
  ) as funding_years,
  (
    select count(*)::int from round_investor ri
    join funding_round r on r.id = ri.round_id and r.status = 'published'
    where ri.investor_id = g.id and ri.is_lead
      and not exists (select 1 from withdrawn_edge w
        where w.kind = 'invested_in' and w.source_org = g.id and w.target_org = r.organisation_id)
  ) as led_rounds,
  (
    select count(distinct r.organisation_id)::int from round_investor ri
    join funding_round r on r.id = ri.round_id and r.status = 'published'
    join organisation c on c.id = r.organisation_id and c.status = 'published'
    where ri.investor_id = g.id
      and not exists (select 1 from withdrawn_edge w
        where w.kind = 'invested_in' and w.source_org = g.id and w.target_org = r.organisation_id)
  ) as portfolio,
  (
    select max(r.announced_on) from round_investor ri
    join funding_round r on r.id = ri.round_id and r.status = 'published'
    where ri.investor_id = g.id
      and not exists (select 1 from withdrawn_edge w
        where w.kind = 'invested_in' and w.source_org = g.id and w.target_org = r.organisation_id)
  ) as last_invested_on
from organisation g;
