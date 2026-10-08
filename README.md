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

Open <http://localhost:5173> for the landing page and <http://localhost:5173/map/> for the map app. The API's OpenAPI document is at
<http://localhost:4000/openapi.json>.

## Checks

```sh
pnpm typecheck
pnpm db:test      # build the separate test database with the synthetic sample
pnpm test         # API tests run against that test database
pnpm build
pnpm check:bundle # fails if either page's first-load JavaScript exceeds 600 KB compressed
pnpm e2e          # drives both pages in Chrome against the test database; starts its own servers
```

## Deploying

`docs/deploy.md` has the steps. In short: `pnpm layers:build` writes the map's data
as static files so the map loads without the API, the web app is a static build,
and the API runs as a container from `infra/api/Dockerfile`.

## Layout

- `apps/web` — Vite, React, Tailwind and MapLibre. Two pages: the landing page (`index.html`, `src/landing/`) and the map app (`map/index.html`, `src/`). The app reaches the map only through `src/map/adapter.ts`; the landing page's previews use `src/map/previewMap.ts`.
  `public/logo.png` is the pin mark cropped from the full logo in `logo.png` at the repo root.
- `apps/api` — Fastify. Route schemas generate the OpenAPI document.
- `packages/schema` — share-link state and filter rules shared by the web app and, later, the API.
- `db` — SQL migrations, seed data and their runners.
- `workers` — Python pipeline: feed crawlers, raw document store, extraction, eval harness.
- `eval` — labelled set for extraction accuracy. See `eval/README.md`.
- `datasets` — researched datasets, one dated folder each. The files are not in git; see `datasets/README.md`.
- `curation` — work derived from a dataset by hand, such as funding rounds read from its notes. Not in git, like the datasets.
- `infra` — Docker Compose for local development.
- `docs` — fork audit, decision records, crawled sources.

## Pipeline

Needs [uv](https://docs.astral.sh/uv/). Run from `workers/`:

```sh
uv sync
uv run pytest
uv run atlas crawl                 # fetch the news feeds into data/raw and raw_document
uv run atlas extract <file.json>   # extract one stored article with the rule-based baseline
uv run atlas extract-news          # dry run: read stored news and list the funding rounds it reports
uv run atlas extract-news --apply  # put them in the review queue; nothing is published until a reviewer approves
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
Where a dataset describes a row in a sentence rather than a value, the mapping file's
`overrides` gives that row's values by hand, keyed by its name: `type`, `city`,
`country`, `sectors`, `status`, or any other field.
A dataset that cites its sources by ID, with the links in a file of their own, names
that file in the mapping: `"source_register": {"file": "<sources>.csv", "id": "Source ID", "url": "URL"}`.
The file sits beside the dataset, and the IDs in the source columns are read as its links.
`pnpm db:seed` refuses to run on a database that holds real records.

```sh
uv run atlas import-rounds ../curation/<file>.json          # dry run: checks the file and prints the rounds
uv run atlas import-rounds ../curation/<file>.json --apply  # load; re-running replaces what it loaded before
```

```sh
uv run atlas import-locations ../curation/<file>.json          # dry run: shows who can be placed and where
uv run atlas import-locations ../curation/<file>.json --apply  # load; re-running replaces what it placed before
```

`import-locations` gives a city to organisations that are on record with no office,
such as investors named only in a funding round. They are placed at the centre of
the city, never at an address, and each carries the stated basis for its placement.
`import-orgs` also places records outside Nairobi at city level, from a dataset's
`City` and `Country` columns, or exactly where it gives `Latitude` and `Longitude`.

`import-rounds` loads funding rounds a person has read out of a dataset's funding
notes. Every round carries the words it was read from, and the load stops if a
quote is not in the stored note. The note is both funding cells of the row: the level or
status, and the details. Where the amount is in one and the date in the other, the round
gives the words for its date separately, as `date_quote`. A date may also be read from the
address of the round's `source`, when that source is on record for the organisation and its
address carries the date it was published; `date_quote` is then the date as the address writes it. Re-running `import-orgs` removes the rounds of the
organisations it replaces, so run `import-rounds` again after it.

```sh
uv run atlas find-profiles                 # dry run: profile links among the sources already on record
uv run atlas find-profiles --web           # also read each organisation's own website
uv run atlas find-profiles --web --search   # also ask a web search service for those still not found
uv run atlas find-profiles --web --search --apply   # save what was found
```

`find-profiles` looks for the LinkedIn profile of each person on record, so a founder's
name in an organisation's details can link to it. It never requests linkedin.com, whose
terms forbid automated collection. It reads profile links that are already published
elsewhere: among the organisation's sources on record, and with `--web` on the
organisation's own home, team and about pages, where robots.txt allows, at most four
pages a site and one request a second. A link is kept only when its address carries the
person's first and last name and it is the only match for both the person and the
profile; anything else is listed as not chosen. With `--search`, those still not found
are looked up through SerpAPI (`SERPAPI_API_KEY` in `.env`), one request a second, asking
Google for the person's name and organisation among LinkedIn profiles, and DuckDuckGo
for anyone Google did not find. DuckDuckGo is asked through SerpAPI as well: it has no
search API of its own and its robots.txt forbids scripts from its results pages. The
free plan allows 250 requests a month, so a run stops at `--limit` requests (240 unless
told otherwise) and the next run carries on from there; `--engine google` halves the cost. Only the service's answer is read, and a result counts only if
its title or summary also names the organisation, since many people share a name.
Answers are kept in `data/profile-search-cache.json`, so a second run asks nothing twice. Only the address is stored, with the
page it was found on. A person who has opted out is never looked up.

```sh
uv run atlas fetch-logos            # dry run: which organisations have a logo to fetch
uv run atlas fetch-logos --apply    # fetch and store them; --refresh fetches again those already held
```

`fetch-logos` gets each published organisation's logo from its own website, for the image
on its card: the icon the site declares for a phone's home screen, else its largest icon,
else `/favicon.ico`. Only the organisation's site is asked, within its robots.txt. The
image is stored in the database (up to 64 KB) and sent with the organisation's details, so
the app never loads it from another site and no one else learns which records are opened.
A card with no logo shows the organisation's initials.

Add `--extractor llm` to `extract` or `eval` to use a model instead. It runs on
[Groq](https://console.groq.com) through LangChain and needs `GROQ_API_KEY` in
`.env`. `GROQ_MODEL` changes the model (default `openai/gpt-oss-120b`).
