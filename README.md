# ecoSight

*See where innovation happens.* A map-first intelligence platform for the startup
ecosystem, starting with Nairobi. The repository and its packages still carry the
working name Capital Atlas.

- `final_plan.md` — what is left to build, in order.
- `frontend_plan.md` — the interface specification.
- `plan.md` — the original implementation plan and risk list.
- `docs/fork-audit.md` — how this relates to God's Eye View.

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

- `apps/web` — Vite, React, Tailwind and MapLibre. The app reaches the map only through `src/map/adapter.ts`.
  Put the logo at `apps/web/public/logo.png`; the header shows the wordmark alone until it is there.
- `apps/api` — Fastify. Route schemas generate the OpenAPI document.
- `packages/schema` — share-link state and filter rules shared by the web app and, later, the API.
- `db` — SQL migrations, seed data and their runners.
- `workers` — Python pipeline: feed crawlers, raw document store, extraction, eval harness.
- `eval` — labelled set for extraction accuracy. See `eval/README.md`.
- `infra` — Docker Compose for local development.
- `docs` — fork audit, decision records, crawled sources.

## Pipeline

Needs [uv](https://docs.astral.sh/uv/). Run from `workers/`:

```sh
uv sync
uv run pytest
uv run atlas crawl                 # fetch the news feeds into data/raw and raw_document
uv run atlas extract <file.json>   # extract one stored article with the rule-based baseline
uv run atlas eval                  # per-field accuracy on eval/labelled.jsonl
```

Add `--extractor llm` to `extract` or `eval` to use a model instead. It runs on
[Groq](https://console.groq.com) through LangChain and needs `GROQ_API_KEY` in
`.env`. `GROQ_MODEL` changes the model (default `llama-3.3-70b-versatile`).
