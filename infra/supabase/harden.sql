-- Run after the migrations on a Supabase project. Safe to run again.
--
-- Supabase publishes every table in the public schema through its REST API, to
-- anyone holding the project's publishable key, unless row-level security says
-- otherwise. This data is private, so everything is closed: the two built-in
-- web roles lose their grants, and every table gets row-level security with a
-- single policy that admits only the application's own role.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public to ecosight_app;
grant select, insert, update, delete on all tables in schema public to ecosight_app;
grant usage, select on all sequences in schema public to ecosight_app;
alter default privileges in schema public grant select, insert, update, delete on tables to ecosight_app;
-- The application switches to atlas_app when it reads a fund's private rows.
grant atlas_app to ecosight_app;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      -- Tables that belong to an extension (PostGIS's reference table) are not ours to alter.
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      -- The private fund tables already have their own, stricter policy.
      and c.relname not like 'fund\_private\_%'
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    execute format('drop policy if exists app_access on public.%I', t.relname);
    execute format(
      'create policy app_access on public.%I for all to ecosight_app using (true) with check (true)',
      t.relname
    );
  end loop;
end $$;

-- A view reads with its owner's rights, which would step round the policies
-- above. Reading as the caller keeps the views as closed as the tables.
alter view public.public_office set (security_invoker = true);
alter view public.public_event set (security_invoker = true);
alter view public.organisation_funding set (security_invoker = true);
