# Deploying ecoSight

How the app is hosted, on free tiers only. It was first deployed on Oct 7, 2026,
and checked in a browser the same day.

| | Address |
|---|---------|
| Landing page | <https://mindscope-world.github.io/ecosight/> |
| Map app | <https://mindscope-world.github.io/ecosight/map/> |
| API | `<SUPABASE_URL>/functions/v1/api` |

**The data is private.** The owner has confirmed it may not be published. Three
rules follow, and they override anything below that seems to say otherwise:

1. The API is always deployed with `ACCESS_KEY` set. Without the key it answers
   nothing but its health check, and the app shows an access screen. The edge
   build refuses to start without one.
2. The map data is never built into static files on a public host. `pnpm
   layers:build` and `VITE_DATA_URL` are for a private host only; on a public one
   leave them out, and the app reads everything through the keyed API.
3. Datasets and the files in `curation/` are never committed.

A shared key is a stopgap. Anyone given it can pass it on, and it cannot be
withdrawn from one person without changing it for all. Sign-in (step 5 of
`final_plan.md`) replaces it.

## The pieces

| Piece | What it is | Where it runs |
|-------|------------|---------------|
| Database | Postgres 17 with PostGIS, pgvector, pg_trgm | Supabase, free tier |
| API | The Fastify app, bundled into one file | A Supabase Edge Function named `api` |
| Web app | Static files from `pnpm --filter @atlas/web build`, code only | GitHub Pages, from the `gh-pages` branch |
| Map data | Read through the keyed API | — |
| Scheduled jobs | Uptime check; later, the crawlers | GitHub Actions on a schedule |

Everything is in one Supabase project and one GitHub repository, so no further
account is needed. The API answers in about a second; a function that has been
idle takes a little longer on its first request.

## Settings in `.env`

None of these are committed.

| Setting | What it is |
|---------|------------|
| `SUPABASE_URL` | The project's address |
| `SUPABASE_ACCESS_TOKEN` | A personal access token. Used only from this machine, to run migrations and deploy the function |
| `SUPABASE_DB_URL` | Connection string for `ecosight_app`, the login the API and the importers use. It goes through the session pooler |
| `ACCESS_KEY` | The key people type into the access screen |

## 1. Database

The project's API keys cannot create tables, and there is no database password
in use. Migrations go through Supabase's management API instead, with the access
token:

```sh
pnpm db:migrate:hosted                                  # applies db/migrations in order
pnpm db:migrate:hosted ../infra/supabase/harden.sql     # run after every migration that adds a table or view
```

`harden.sql` closes the database to Supabase's public REST interface: it takes
all rights away from the `anon` and `authenticated` roles, turns on row-level
security for every table, gives `ecosight_app` access, and makes the views run
with the caller's rights. Without it, anyone holding the publishable key (which
is not a secret) could read the tables directly.

`ecosight_app` is an ordinary login, not a superuser. It was created once, by
hand, through the same SQL endpoint, with a generated password that exists only
in `SUPABASE_DB_URL`.

Load the data from `workers/`, with the same commands as locally:

```sh
DATABASE_URL="$SUPABASE_DB_URL" uv run atlas import-orgs <dataset.csv> --snapshot <date> --apply
DATABASE_URL="$SUPABASE_DB_URL" uv run atlas import-rounds ../curation/<file>.json --apply
DATABASE_URL="$SUPABASE_DB_URL" uv run atlas import-locations ../curation/<file>.json --apply
```

Do not run `pnpm db:seed` against it. The seed refuses a non-local database, and
refuses any database that holds real records.

## 2. API

`apps/api/src/edge.ts` wraps the same Fastify app the tests run, so the function
and the local server answer identically.

```sh
pnpm --filter @atlas/api build:edge                     # writes supabase/functions/api/bundle.js
npx supabase functions deploy api --no-verify-jwt --project-ref <ref>
```

`--no-verify-jwt` turns off Supabase's own check, because the app's access key
is the check. The function's settings are set once and kept by Supabase:

```sh
npx supabase secrets set --project-ref <ref> \
  DATABASE_URL="$SUPABASE_DB_URL" ACCESS_KEY="$ACCESS_KEY" \
  CORS_ORIGINS=https://mindscope-world.github.io
```

| Setting | Why |
|---------|-----|
| `DATABASE_URL` | The `ecosight_app` connection string |
| `ACCESS_KEY` | Required. Closes the API to anyone without it |
| `CORS_ORIGINS` | Only the web app's address may call the API from a browser |

To change the access key, set a new `ACCESS_KEY` secret and redeploy. Everyone
then has to be given the new one.

## 3. Web app

```sh
VITE_API_URL=<SUPABASE_URL>/functions/v1/api \
VITE_DEMO_DATA=false \
pnpm --filter @atlas/web build --base=/ecosight/        # output in apps/web/dist/
```

The build holds code only. Before publishing, check that `apps/web/dist/` has no
`data/` folder, then put its contents, plus an empty `.nojekyll` file, on the
`gh-pages` branch as a single commit and force-push it. Pages serves that branch
from its root.

The landing page needs no key: without one its map shows illustrative points and
says so. The map app shows the access screen until the key is entered, and keeps
the key in that browser.

## 4. Checks after deploying

1. `<api>/health` answers 200, and `<api>/stats` answers 401 without the key.
2. The landing page loads. `/map/` shows the access screen in a private window.
3. With the key, the map shows markers and the status bar says "Live" with the
   right counts; search finds an organisation and its details open.
4. The public REST interface is closed:
   `<SUPABASE_URL>/rest/v1/organisation` with the publishable key answers
   "permission denied".
5. In the repository, under Settings > Secrets and variables > Variables, set
   `WEB_URL` and `API_URL`. The Uptime workflow then checks the site, the API and
   the public basemap every half hour, and emails on failure.

## Limits of the free tiers

- **Supabase pauses a free project after a week without activity.** The uptime
  check calls the API's health route, but that route does not touch the
  database. Until the check is pointed at something that does, open the app at
  least weekly.
- 500 MB of database, and a cap on function calls each month, both far above
  current use.
- The repository is public, so the `gh-pages` branch is too. That is why the
  build must never contain data.

## An alternative that is not in use

`render.yaml` and `infra/api/Dockerfile` run the API as a container on Render's
free plan. They were written before the edge function and have never been
deployed. Render sleeps after 15 minutes idle and takes about a minute to wake.

## Not set up yet

- **Error reporting.** Needs an account with a reporting service.
- **Publishing from CI.** Deploying is done by hand from this machine. A
  workflow would need the access token and the access key as repository secrets.
- **Backups and a restore test.** Step 8 of the plan.
