-- A view of the product a signed-in user wants to come back to: the page, and
-- the same state a share link carries (place, layers, filters, selection).
create table saved_view (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_user on delete cascade,
  name text not null check (length(name) between 1 and 80),
  page text not null check (page in ('map', 'graph', 'dashboard')),
  state text not null check (length(state) <= 2000),
  created_at timestamptz not null default now()
);
create index saved_view_user on saved_view (user_id, created_at desc);
