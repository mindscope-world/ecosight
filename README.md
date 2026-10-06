# Capital Atlas

A web map of the startup ecosystem, starting with Nairobi. See `plan.md` for the
implementation plan and `docs/fork-audit.md` for how this relates to God's Eye View.

## Run locally

Needs Node 22+, pnpm and Docker.

```sh
cp .env.example .env
pnpm install
pnpm db:up        # Postgres with PostGIS and pgvector on port 5433
pnpm db:migrate
pnpm db:seed      # synthetic sample organisations around Nairobi
pnpm dev          # API on :4000, web app on :5173
```

Open <http://localhost:5173>. The API's OpenAPI document is at
<http://localhost:4000/openapi.json>.

## Checks

```sh
pnpm typecheck
pnpm test         # API tests need the seeded database
pnpm build
pnpm check:bundle # fails if first-load JavaScript exceeds 600 KB compressed
```

## Layout

- `apps/web` — Vite, TypeScript and MapLibre. Layers reach the map only through `src/map/adapter.ts`.
- `apps/api` — Fastify. Route schemas generate the OpenAPI document.
- `db` — SQL migrations, seed data and their runners.
- `infra` — Docker Compose for local development.
