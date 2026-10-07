-- An organisation's own logo, for its card. The image itself is kept, small, so
-- the app never asks another site for it: which records a reader opens stays
-- between the reader and this API.
create table organisation_logo (
  organisation_id uuid primary key references organisation on delete cascade,
  content_type text not null
    check (content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/svg+xml')),
  image bytea not null check (octet_length(image) between 1 and 65536),
  -- The address the image was fetched from, on the organisation's own website.
  source_url text not null,
  fetched_at timestamptz not null default now()
);
