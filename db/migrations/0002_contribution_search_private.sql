-- Search, the contribution queue inputs, per-fund private tables, hex aggregates,
-- and the rule that keeps city-precision offices off their real address.

-- Name matching by meaning. 384 dimensions fits small open embedding models that
-- run on a laptop CPU (all-MiniLM-L6-v2, bge-small), so no paid API is needed.
alter table organisation add column name_embedding vector(384);

-- array_to_string is only marked stable, which a generated column cannot use.
create function join_words(text[]) returns text language sql immutable parallel safe
  return array_to_string($1, ' ');

alter table organisation add column search tsvector generated always as (
  setweight(to_tsvector('simple'::regconfig, name), 'A') ||
  setweight(to_tsvector('simple'::regconfig, join_words(sectors)), 'B') ||
  setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'C')
) stored;
create index organisation_search on organisation using gin (search);

-- City centroids. A city-precision office is drawn here and nowhere else.
create table city (
  name text not null,
  country char(2) not null,
  centroid geography(Point, 4326) not null,
  primary key (name, country)
);
insert into city (name, country, centroid)
values ('Nairobi', 'KE', st_setsrid(st_makepoint(36.8219, -1.2921), 4326)::geography);

-- Angels are only ever located to a city. The address is dropped and the point is
-- moved to the centroid at write time, so no tile or export can leak where they live.
create function office_enforce_precision() returns trigger language plpgsql as $$
declare
  centre geography;
begin
  if exists (
    select 1 from organisation g
    where g.id = new.organisation_id and 'angel_network' = any(g.types)
  ) then
    new.precision := 'city';
  end if;

  if new.precision = 'city' then
    select centroid into centre from city where name = new.city and country = new.country;
    if centre is null then
      raise exception 'No centroid for city % (%); add it to city before storing a city-precision office',
        new.city, new.country;
    end if;
    new.geom := centre;
    new.address := null;
  end if;
  return new;
end $$;
create trigger office_precision before insert or update on office
  for each row execute function office_enforce_precision();

-- An organisation that becomes an angel network has its existing offices snapped too.
create function organisation_snap_offices() returns trigger language plpgsql as $$
begin
  if 'angel_network' = any(new.types) and not ('angel_network' = any(old.types)) then
    update office set precision = 'city' where organisation_id = new.id;
  end if;
  return new;
end $$;
create trigger organisation_angel_offices after update of types on organisation
  for each row execute function organisation_snap_offices();

-- What members send in. Each one becomes a review_item; nothing publishes from here.
create table submission (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null,
  record_type text not null check (record_type in ('organisation', 'event')),
  payload jsonb not null,
  review_item_id uuid references review_item on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index submission_by on submission (submitted_by);

create table claim (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade,
  claimed_by uuid not null,
  work_email text not null,
  -- True when the email domain equals the organisation's website domain.
  domain_matches boolean not null default false,
  status review_status not null default 'pending',
  review_item_id uuid references review_item on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claim_org on claim (organisation_id);
create unique index claim_one_pending on claim (organisation_id, claimed_by)
  where status = 'pending';

-- Private rows of a fund. Row-level security is forced, so even the table owner
-- sees only the fund named in app.fund_id, which the API sets per transaction.
create table fund_private_portfolio (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references organisation on delete cascade,
  organisation_id uuid not null references organisation on delete cascade,
  invested_on date,
  amount_usd numeric(18, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, organisation_id)
);

create table fund_private_pipeline (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references organisation on delete cascade,
  organisation_id uuid not null references organisation on delete cascade,
  pipeline_stage text not null default 'watching',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fund_id, organisation_id)
);

do $$
declare t text;
begin
  foreach t in array array['fund_private_portfolio', 'fund_private_pipeline'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- An unset or empty app.fund_id compares as null, so it matches no row.
    execute format(
      'create policy fund_isolation on %I
         using (fund_id = nullif(current_setting(''app.fund_id'', true), '''')::uuid)
         with check (fund_id = nullif(current_setting(''app.fund_id'', true), '''')::uuid)',
      t
    );
  end loop;
end $$;

-- Superusers and bypassrls roles skip row-level security, so requests that touch
-- private rows run as this role. It cannot log in; the API switches to it inside a
-- transaction after setting app.fund_id.
do $$
begin
  if not exists (select from pg_roles where rolname = 'atlas_app') then
    create role atlas_app nologin;
  end if;
end $$;
grant usage on schema public to atlas_app;
grant select on all tables in schema public to atlas_app;
grant insert, update, delete on fund_private_portfolio, fund_private_pipeline to atlas_app;

-- Counts and totals per H3 cell, rebuilt nightly by the workers.
create table hex_aggregate (
  h3_cell text not null,
  resolution smallint not null check (resolution between 0 and 15),
  layer text not null,
  org_count integer not null default 0,
  round_count integer not null default 0,
  amount_usd numeric(18, 2) not null default 0,
  built_at timestamptz not null default now(),
  primary key (layer, resolution, h3_cell)
);

do $$
declare t text;
begin
  foreach t in array array[
    'submission', 'claim', 'fund_private_portfolio', 'fund_private_pipeline'
  ] loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end $$;

-- What the public map may show of events.
create view public_event as
select id as event_id, name, organiser_id, venue, city, country, starts_at, ends_at, url, geom
from event
where status = 'published' and geom is not null;
