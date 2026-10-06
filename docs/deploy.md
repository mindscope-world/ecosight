# Deploying ecoSight

How to put the app somewhere people can open it, using free tiers. Nothing here
has been deployed yet: the pieces are built and were run together locally on
Oct 7, 2026, and the steps that need an account are written out for the owner.

**Before any public deployment:** confirm that the sources of the loaded data
allow publishing it (item 1.3 in `final_plan.md`).

## The pieces

| Piece | What it is | Where it runs |
|-------|------------|---------------|
| Database | Postgres with PostGIS, pgvector, pg_trgm | Supabase, free tier |
| Web app | Static files from `pnpm --filter @atlas/web build` | Any static host |
| Map data | Four static files from `pnpm layers:build`, served beside the web app | Same static host |
| API | Container from `infra/api/Dockerfile` | Any host that runs a container |
| Scheduled jobs | Rebuild map data; later, the crawlers | GitHub Actions on a schedule |

The map draws from the static files, so it still loads when the API is down.
Details, search and connections need the API.

## 1. Database

1. Create a Supabase project in the region agreed for data residency.
2. In the SQL editor, nothing needs enabling by hand: the first migration creates
   the extensions.
3. From a machine with the repo, using the project's direct connection string:

   ```sh
   DATABASE_URL='postgres://...' pnpm db:migrate
   ```

4. Load the data, from `workers/`:

   ```sh
   DATABASE_URL='postgres://...' uv run atlas import-orgs <dataset.csv> --snapshot <date> --apply
   DATABASE_URL='postgres://...' uv run atlas import-rounds ../curation/<file>.json --apply
   ```

Do not run `pnpm db:seed` against it. The seed refuses a non-local database, and
refuses any database that holds real records.

## 2. API

Build and run the container. It needs `DATABASE_URL`; the host usually sets `PORT`.

```sh
docker build -f infra/api/Dockerfile -t ecosight-api .
```

| Setting | Value | Why |
|---------|-------|-----|
| `DATABASE_URL` | The Supabase connection string (the pooled one, if the host opens many connections) | |
| `CORS_ORIGINS` | The web app's address, for example `https://ecosight.example` | Only that site may call the API from a browser |
| `TRUST_PROXY` | `1` | The host's proxy sits in front; without this every visitor shares one rate limit |
| `RATE_LIMIT_PER_MINUTE` | `120` (the default) | Per visitor. Search gets a quarter of it |

Health check path: `/health`. It is not rate limited.

No host is chosen yet. It must run a container (or Node 22) and stay within a free
tier; check each candidate's current terms, since free tiers change. A host that
sleeps when idle is acceptable for a demo: the map still loads from static files,
and the first search or detail request wakes it.

## 3. Map data and web app

```sh
DATABASE_URL='postgres://...' pnpm layers:build      # writes apps/web/public/data/
VITE_DATA_URL=data \
VITE_API_URL=https://<api host> \
VITE_DEMO_DATA=false \
pnpm --filter @atlas/web build                        # output in apps/web/dist/
```

Upload `apps/web/dist/` to the static host. If the site is served from a sub-path
(for example GitHub Pages at `/ecosight/`), add `--base=/ecosight/` to the build
command; the logo and the data folder follow it.

Rebuild and re-upload when the data changes. The events file leaves out events
that have ended, so it goes stale within a day: run the rebuild daily once events
are loaded.

## 4. Checks after deploying

1. The map shows markers, and the status bar says "Live" with the right counts.
2. Search finds an organisation and the details panel opens (this is the API).
3. Stop the API: the map and the left panel still load.
4. In the repository, under Settings > Secrets and variables > Variables, set
   `WEB_URL` and `API_URL`. The Uptime workflow then checks the site, the map
   data, the API and the public basemap every half hour, and emails on failure.

## Not set up yet

- **Error reporting.** Needs an account with a reporting service.
- **A scheduled rebuild.** A workflow that runs steps 3 on a timer needs the
  database address as a repository secret and the static host's upload
  credentials, so it is written once the hosts are chosen.
- **Backups and a restore test.** Step 8 of the plan.
