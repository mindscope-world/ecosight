-- Who may sign in, and what each may do. Signing in proves an email address;
-- this table says whether that address is let in at all, and as what. An address
-- that is not here gets nothing, however validly it signed in.
create table app_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  -- viewer: read. reviewer: also settle the review queue. admin: reserved for managing users.
  role text not null check (role in ('viewer', 'reviewer', 'admin')),
  created_at timestamptz not null default now()
);
