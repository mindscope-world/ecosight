-- One row per run of the daily pipeline (crawl, read, flag), so a run that failed or went
-- quiet is noticed. `stats` holds what each step did; the health check reads these rows.
create table pipeline_run (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'daily',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- running until finished; partial when a step failed but the rest ran
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb,
  error text
);
create index pipeline_run_started on pipeline_run (kind, started_at desc);

-- Set when a published organisation's facts were last confirmed more than 12 months ago
-- (by `atlas flag-stale`); cleared when they are confirmed again. Never hides a record.
alter table organisation add column stale_since timestamptz;
create index organisation_stale on organisation (stale_since) where stale_since is not null;
