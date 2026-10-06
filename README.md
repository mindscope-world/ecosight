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
pnpm db:test      # build the separate test database with the synthetic sample
pnpm test         # API tests run against that test database
pnpm build
pnpm check:bundle # fails if first-load JavaScript exceeds 600 KB compressed
```

## Layout

- `apps/web` — Vite, React, Tailwind and MapLibre. The app reaches the map only through `src/map/adapter.ts`.
  `public/logo.png` is the pin mark cropped from the full logo in `logo.png` at the repo root.
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
uv run atlas import-orgs <file.csv>          # dry run: writes data/import-report.md, changes nothing
uv run atlas import-orgs <file.csv> --apply  # load it; re-running replaces what it loaded before
```

`import-orgs` reads a researched organisations CSV. Only rows marked `verified` are
published; the rest are kept as drafts with a pending review item. Addresses are
placed through the public Nominatim geocoder (one request a second, cached in
`data/geocode-cache.json`), and a match is kept only when it carries the building or
street name. Add `--replace-sample` to remove the synthetic sample at the same time.

A dataset with different column headings is read through `--mapping file.json`, a
JSON object from field names (`name`, `type`, `status`, `industry`, `founded_year`,
`premise`, `latitude`, `longitude`, `website` and the others in `DEFAULT_COLUMNS`
in `importer.py`) to that dataset's headings. Only `name` is required. A dataset
with no verification column loads as drafts unless `--publish-all` is given. An
organisation already on record from another source is reported and not loaded again.
`pnpm db:seed` refuses to run on a database that holds real records.

```sh
uv run atlas import-rounds ../curation/<file>.json          # dry run: checks the file and prints the rounds
uv run atlas import-rounds ../curation/<file>.json --apply  # load; re-running replaces what it loaded before
```

`import-rounds` loads funding rounds a person has read out of a dataset's funding
notes. Every round carries the words it was read from, and the load stops if a
quote is not in the stored note. Re-running `import-orgs` removes the rounds of the
organisations it replaces, so run `import-rounds` again after it.

Add `--extractor llm` to `extract` or `eval` to use a model instead. It runs on
[Groq](https://console.groq.com) through LangChain and needs `GROQ_API_KEY` in
`.env`. `GROQ_MODEL` changes the model (default `llama-3.3-70b-versatile`).
