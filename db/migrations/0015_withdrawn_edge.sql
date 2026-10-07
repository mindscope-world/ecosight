-- A relationship a reviewer has taken down for everyone: a line between two
-- organisations that should not be shown, whatever table it was read from.
-- The records it came from are left as they are, so restoring it is one delete.
create table withdrawn_edge (
  kind text not null,
  source_org uuid not null references organisation on delete cascade,
  target_org uuid not null references organisation on delete cascade,
  reason text not null check (length(reason) between 1 and 300),
  withdrawn_by uuid references app_user on delete set null,
  withdrawn_at timestamptz not null default now(),
  primary key (kind, source_org, target_org)
);

-- Everything on record stays readable under another name, for the reviewer who
-- needs to see what can be withdrawn. The graph itself leaves the withdrawn out.
alter view graph_edge rename to graph_edge_all;
create view graph_edge as
select e.* from graph_edge_all e
where not exists (
  select 1 from withdrawn_edge w
  where w.kind = e.kind and w.source_org = e.source_org and w.target_org = e.target_org
);
