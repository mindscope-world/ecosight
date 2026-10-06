-- Core schema: organisations, offices, funding, programs, events, provenance.
-- Location lives on office, not organisation, so branches are first-class.

create extension if not exists postgis;
create extension if not exists vector;
create extension if not exists pg_trgm;

create type org_type as enum (
  'startup', 'fund', 'angel_network', 'ngo', 'accelerator', 'corporate'
);
create type record_status as enum ('draft', 'published', 'removed');
create type location_precision as enum ('address', 'city');
create type source_method as enum ('manual', 'partner', 'ai');
create type review_status as enum ('pending', 'approved', 'rejected');

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table organisation (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  -- An organisation can be several things at once (a startup that also invests).
  types org_type[] not null check (cardinality(types) > 0),
  sectors text[] not null default '{}',
  stage text,
  website_domain text,
  description text,
  status record_status not null default 'draft',
  claimed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organisation_name_trgm on organisation using gin (name gin_trgm_ops);
create index organisation_types on organisation using gin (types);
create index organisation_domain on organisation (website_domain);

create table office (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade,
  is_hq boolean not null default false,
  address text,
  city text not null,
  country char(2) not null,
  geom geography(Point, 4326) not null,
  precision location_precision not null default 'address',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index office_geom on office using gist (geom);
create index office_org on office (organisation_id);
create unique index office_one_current_hq on office (organisation_id)
  where is_hq and valid_to is null;

create table funding_round (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade,
  stage text,
  -- Original currency is kept; USD is derived at the rate on the round date.
  amount_original numeric(18, 2),
  currency char(3),
  amount_usd numeric(18, 2),
  fx_rate numeric(18, 8),
  announced_on date,
  status record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index funding_round_org on funding_round (organisation_id);
create index funding_round_date on funding_round (announced_on);

create table round_investor (
  round_id uuid not null references funding_round on delete cascade,
  investor_id uuid not null references organisation on delete cascade,
  is_lead boolean not null default false,
  primary key (round_id, investor_id)
);

create table program (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade,
  name text not null,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table program_participant (
  program_id uuid not null references program on delete cascade,
  organisation_id uuid not null references organisation on delete cascade,
  primary key (program_id, organisation_id)
);

create table event (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organiser_id uuid references organisation on delete set null,
  venue text,
  city text,
  country char(2),
  geom geography(Point, 4326),
  starts_at timestamptz not null,
  ends_at timestamptz,
  url text,
  status record_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_geom on event using gist (geom);
create index event_starts on event (starts_at);

-- People appear only in a role at an organisation, with an opt-out.
create table person_role (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation on delete cascade,
  name text not null,
  role text not null,
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table raw_document (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  fetched_at timestamptz not null default now(),
  content_hash text not null,
  storage_key text not null,
  unique (url, content_hash)
);

-- Provenance for every published field: where it came from and when it was checked.
create table field_source (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  field text not null,
  source_url text,
  method source_method not null,
  quote text,
  confidence real check (confidence between 0 and 1),
  raw_document_id uuid references raw_document on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index field_source_record on field_source (record_type, record_id);

-- The single queue that crawled, partner and user-submitted records pass through.
create table review_item (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid,
  payload jsonb not null,
  method source_method not null,
  status review_status not null default 'pending',
  reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_item_pending on review_item (created_at) where status = 'pending';

create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  record_type text not null,
  record_id uuid not null,
  field text not null,
  previous_value jsonb,
  new_value jsonb,
  at timestamptz not null default now()
);
create index audit_log_record on audit_log (record_type, record_id);

do $$
declare t text;
begin
  foreach t in array array[
    'organisation', 'office', 'funding_round', 'program', 'event', 'person_role'
  ] loop
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
end $$;

-- What the public map may show: current offices of published organisations.
create view public_office as
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
  o.geom
from office o
join organisation g on g.id = o.organisation_id
where g.status = 'published' and o.valid_to is null;
