# ecoSight — Final Plan

Updated Oct 7, 2026

What has been built, and everything still to build for the frontend and the backend, in the order it should be done. `frontend_plan.md` has the interface specification for the map app, the landing page and the graph explorer. `plan.md` keeps the original proposal-derived plan and its risk list.

Urgency:

- **Critical** — blocks other work, or blocks showing the product to anyone.
- **High** — needed for the first credible demo.
- **Medium** — needed for launch.
- **Low** — after launch, or only if time allows.

## 1. What is built

The code is public at <https://github.com/mindscope-world/ecosight>. Pull requests 1 and 2 are merged, so `main` holds everything up to the investors dataset. Two further commits, organisations outside Kenya and the density layers, are pushed on the `beyond-kenya` branch and not yet merged. Later work (the density fix, connection lines and end-to-end tests) is on the `map-polish-and-e2e` branch.

Checks pass: 70 TypeScript tests, 74 Python tests, 11 end-to-end browser tests, typecheck, build, and first-load JavaScript of 122 KB for the landing page and 356 KB for the map app, each against a 600 KB budget. CI runs them on every pull request.

### Data

| | Count |
|---|---|
| Organisations published | 122 |
| Organisations on the map | 109, in 10 countries |
| Startups | 69, all in Nairobi |
| Investors, accelerators, hubs and funders | 53 on record, 40 on the map |
| Funding rounds | 36, for 25 organisations; USD 112.13 million in rounds with a stated dollar amount |
| People named as founders | 134 |
| Drafts held back for review | 33 |
| Events | 0 |

- **Startups dataset** (`datasets/nairobi-startups-2026-10-06/`): 100 rows; the 69 marked verified are published, 31 are drafts.
- **Funding rounds** (`curation/nairobi_startups_funding_rounds.json`): read by hand from the startups dataset's funding notes, each with the words it was read from, plus 16 items deliberately not recorded as rounds.
- **Investors dataset** (`datasets/nairobi-investors-2026-10-07/`): 25 rows; 23 published, 2 drafts. Five were merged into investors already known from funding rounds.
- **Investors abroad** (`curation/investor_headquarters.json`): 17 placed at their headquarters city, on the curator's general knowledge and marked as unsourced on each card. 13 more are listed as not placed.
- Dataset files are kept out of git; `datasets/README.md` indexes them. The synthetic sample lives only in the test database.

### Database (Postgres, PostGIS, pgvector, pg_trgm; seven migrations)

Organisations with eleven entity types, other names they go by, founded year, active status and funding note; offices at address, area or city precision in any country; funding rounds with date precision; round investors; programs; events; people in roles; per-field sources with their stated basis; review queue; audit log; submissions; claims; private fund tables under row-level security; a view of per-organisation funding facts; full-text search; a rule that keeps angels at city level.

### API (Fastify)

Office and event layers; organisation detail with funding and connections; event and round detail; search grouped into organisations, people, events, cities and sectors, which reads type, sector and city words; stats with period comparison, city scores, funding by month and a recent feed. Layers and stats accept the same filters as share links. Rate limits, a setting for which sites may call it, a container definition, and a job that writes the map's data as static files.

### Web (React, Tailwind, MapLibre)

Two pages.

**Landing page** at `/`. Hero over a live world map with figures from the product's own records, audience bar, the problem as a table beside the same records on a map, layer cards, an explore preview from the world down to Nairobi, three use cases, the relationship chain, example signals marked as demo data, a globe with connections, closing call to action and footer.

**Map app** at `/map/`. Top navigation with six lenses; navy map with a marker shape per entity type; clustering that lists records sharing one spot; floating layer control; four heatmaps (funding, and startup, investor and accelerator density, each in its own colour); dark, light and terrain styles; collapsible intelligence panels that follow the filters; entity details with funding, sources and one-click graph navigation; search command palette; filter drawer with ten kinds of filter; status bar; share links; bottom sheets on small screens.

### Pipeline (Python)

- `atlas import-orgs`: dataset importer with a dry-run report, column mappings for other datasets, cached geocoding that refuses lookalike matches, merging into records already on file, and placement in any city.
- `atlas import-rounds`: loads curated rounds and refuses any whose quote is not in the stored note.
- `atlas import-locations`: places organisations that have no office at a named city.
- `atlas crawl`: raw document store and two RSS crawlers (TechCabal, Disrupt Africa).
- `atlas extract` and `atlas eval`: extraction with a rule-based baseline and a Groq model through LangChain, and an accuracy harness.

### Deployment preparation

Static map data, a sub-path-aware web build, the API container, an uptime workflow and `docs/deploy.md`. Nothing is deployed.

### Decisions taken

Build clean, no fork. React and Tailwind for the interface, vanilla TypeScript for the map engine. Fastify kept, not FastAPI. UI named ecoSight; internal package names unchanged. Dark theme only, with light as a map style. Free components throughout (`docs/adr/0002-zero-cost-stack.md`). Only verified rows are published. Funding is recorded by a person reading the notes, not by rules. Only people named as founders are loaded. Emails and phone numbers are not loaded.

## 2. What is left, in order

### Step 1 — Owner checks (Critical)

No code. These make what exists trustworthy, and 1.1 blocks any public deployment.

| # | Item | Notes |
|---|------|-------|
| 1.1 | Confirm the data's sources allow publishing it | Risk R6 in `plan.md` |
| 1.2 | Check the investors placed abroad | `curation/investor_headquarters.json`: 17 placements from general knowledge, and 13 not placed that the owner may know |
| 1.3 | Check the 36 curated rounds | Investor types are the curator's classification; a bare "$" is read as US dollars; one round is dated by its announcement, not its close; one round counts equity and debt together |
| 1.4 | Check the investors import | One investor in the dataset is treated as the same organisation as a differently named investor in a funding round; two rows are held as drafts. Both judgments are in the mapping file under `curation/` |
| 1.5 | Review the 33 drafts | In particular the 6 startups marked inactive or unclear |
| 1.6 | Merge the `beyond-kenya` branch | Needs a pull request into `main` |
| 1.7 | Confirm the decisions listed in section 1 | They were taken on recommendation, not signed off |
| 1.8 | Copy the reference screenshot into `docs/reference/` | The map app has never been compared with it |

### Step 2 — Put it online (High) — next

Everything needed is built; what is missing is accounts and the go-ahead from 1.1.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 2.1 | Static preview on GitHub Pages | Backend | The landing page and the map load from static files alone, so this needs no other account. Details, search and filtered panels will not work until the API is up |
| 2.2 | Database on Supabase | Owner + backend | Create the project; run the migrations and the four import commands |
| 2.3 | Host for the API | Owner + backend | A host that runs a container. The graph proposal names Railway, which could run the API, the worker, Memgraph and Postgres together (see 3.11); it is not free |
| 2.4 | Scheduled rebuild of the map data | Backend | A workflow on a timer; needs the database address as a repository secret |
| 2.5 | Turn on the uptime check | Owner | Set the site and API addresses as repository variables |
| 2.6 | Error reporting | Owner + backend | Needs an account with a reporting service |
| 2.7 | Contact address for the crawler and geocoder | Owner | Required by the services' usage policies before regular use |

**First external demo after this step:** the landing page, then the map, with a click from a startup to its investors and on to their portfolio.

### Step 3 — Graph intelligence (High)

Connections between organisations become something to explore in their own right: a graph engine, an interface over it, and a page built for following links. The architecture and the reasons are in `docs/adr/0003-graph-engine.md`; the page is specified in `frontend_plan.md` section 15.

The engine is Memgraph, fed by an asynchronous background worker and queried only through the Fastify API. Postgres stays the system of record and Memgraph is rebuilt from it, so the review queue, sources, draft status and location rules all still apply to everything in the graph.

Items 3.1 to 3.8 need no account and can be built and tested locally. They do not depend on step 2.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 3.1 | Confirm the architecture and its cost | Owner | Memgraph on Railway departs from the free stack of ADR 0002. ADR 0003 also keeps Postgres as the system of record, which changes the proposal's direct writes into the graph |
| 3.2 | Graph model | Backend | One `Entity` label plus a kind label; relationships `INVESTED_IN`, `ACCELERATED_AT`, `ORGANISED`, `HAS_ROLE`, `LOCATED_IN`, `IN_SECTOR`; a uniqueness constraint on id and a spatial point index, with the index statement checked against the Memgraph version used |
| 3.3 | Memgraph in the local Docker setup | Backend | Beside Postgres, with a volume, and a start-up script for constraints and indexes |
| 3.4 | Projection worker | Backend | Asynchronous Python over Bolt. Copies published records and their relationships from Postgres in batches, idempotently; a full rebuild and an incremental sync. Drafts never leave Postgres. Relationship types come from a fixed list |
| 3.5 | Graph API | Backend | On Fastify: an entity's neighbourhood to a chosen depth; expanding one node; the shortest path between two entities; co-investors and shared portfolios; the most connected entities; all filterable by relationship type, sector, country and date. Rate limited, with a time limit per query |
| 3.6 | Graph explorer page | Frontend | A third page at `/graph/`. Specified in `frontend_plan.md` section 15 |
| 3.7 | Links between the map and the graph | Frontend | "View connections" from the details panel opens the graph on that organisation; "Show on map" from the graph does the reverse; both are share links |
| 3.8 | Tests | Both | The graph matches Postgres after a sync (counts and sampled paths); API tests against a Memgraph service in CI; browser tests for the explorer page |
| 3.9 | Ingestors, through the review queue | Backend | Relationship CSVs first (the importer already reads organisations). Then external APIs and other databases, once the owner names them. Each matches incoming names to existing records before proposing anything |
| 3.10 | Pitch decks | Owner + backend | Upload, private storage, extraction by a language model, and review before anything is published. Blocked on the owner: decks are confidential, and their text would go to a hosted model |
| 3.11 | Deploy on Railway | Owner + backend | Memgraph with a persistent volume at `/var/lib/memgraph`, the worker as its own service on a schedule, and a written procedure for rebuilding the graph from Postgres. Railway can also host the API and so settle 2.3 |
| 3.12 | Founders' universities | Owner | `FOUNDER_ALMA_MATER` is in the proposal. It is personal data of a kind the product has avoided so far and needs a decision before any is loaded |

Not planned for now: loading map markers from the API by viewport, as the proposal's second phase describes. The map loads each layer once as a static file and clusters in the browser, which is why it works with the API down. Revisit when a layer passes about 50,000 points.

The data the graph starts with is modest: about 120 organisations, 37 investor-to-company links from 36 rounds, 134 founders, and no programme or event links yet. Items 4.1 and 4.2 and the ingestors in 3.9 are what make it denser.

### Step 4 — Close the gaps in the data (High)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 4.1 | Events | Data + backend | There are none, so the Events layer and its panels are empty. Needs a dataset or a crawler |
| 4.2 | Startups outside Kenya | Data | The importer accepts them (`City`, `Country`, optionally `Latitude` and `Longitude`); no dataset has been supplied |
| 4.3 | Sources for the investors placed abroad | Data | Replace general-knowledge cities with sourced addresses; place the 13 that are missing |
| 4.4 | ~~Keep city-level records out of the density layers~~ | Done | The four heatmaps count only records whose position means something; the layer list says so |
| 4.5 | Street-level address lookup outside Nairobi | Backend | Records elsewhere sit at their city's centre unless the dataset gives coordinates |
| 4.6 | Per-country summary | Both | Records, rounds and investors by country; the country filter exists |
| 4.7 | Currency conversion | Backend | One round is in Canadian dollars and is left out of dollar totals |
| 4.8 | Founded year | Data | The filter and the card support it; neither dataset has the column |
| 4.9 | Business contacts and logos | Owner + backend | Decide whether public business emails and phones are stored and shown; add a logo field |
| 4.10 | Partners and directors of investors | Owner | The investors dataset lists them; only founders are loaded today |

### Step 5 — Review and accounts (Medium, High for 5.1 and 5.2)

The 33 drafts, and later the output of the pipeline and the graph ingestors, need somewhere to be approved. Today that is a database edit. Depends on 2.2.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 5.1 | Sign-in and roles | Backend | Magic link, Google, LinkedIn on Supabase |
| 5.2 | Review queue screen | Both | Approve, reject, edit, merge duplicates; every change written to the audit log |
| 5.3 | Profile menu, saved locations, notifications | Both | The header icons are placeholders today |
| 5.4 | Submit an organisation or event; claim a profile by work email | Both | Tables exist |
| 5.5 | Takedown and opt-out handling | Both | People named as founders must be able to ask for removal |
| 5.6 | Sign in and sign up from the landing page | Frontend | "Sign in" is inactive and "Join the ecosystem" opens the repository |

### Step 6 — Keep the data fresh (Medium)

Independent of the frontend; can run alongside steps 4 and 5.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 6.1 | Add the Groq key and run the model extractor once | Owner + backend | Never run against Groq; the default model name is unconfirmed |
| 6.2 | Labelled set: 50, then 200 news items | People | No accuracy figure exists until this does |
| 6.3 | Read each publisher's terms of use | People | Recorded in `docs/sources.md`; needed before daily crawling |
| 6.4 | Match extracted companies to existing records | Backend | The dataset importer's matching by website, name and other names can be reused |
| 6.5 | Write extraction results to the review queue | Backend | With per-field source and confidence. Useful once 5.2 exists |
| 6.6 | Confidence scoring and the auto-approval rule | Backend | Rounds above USD 1 million always go to a person |
| 6.7 | Choose the model on the labelled set | Backend | |
| 6.8 | Daily scheduler, run-health alerts, more crawlers | Backend | |
| 6.9 | Stale-record flagging at 12 months | Backend | |

### Step 7 — Advanced map (Medium)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 7.1 | Polygon and radius selection feeding the filters | Both | Also gives the region and radius filters |
| 7.2 | Recent activity layer | Both | |
| 7.3 | Time slider and deal-flow replay | Both | Rounds carry dates and their precision |
| 7.4 | ~~Lines from an investor to its portfolio, and from headquarters to branches~~ | Done | Selecting an organisation draws arcs to its investors, the companies it has backed, and its branches. Organisations with no location get no line |
| 7.5 | Satellite style | Frontend + owner | Needs an imagery source with a suitable licence; shown disabled today |
| 7.6 | Hex aggregates for heatmaps | Backend | Heatmaps are drawn in the browser today; needed only at larger scale |

### Step 8 — Quality and launch (Medium, Critical before launch)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 8.1 | End-to-end tests for the core loop | Frontend | **Mostly done.** Eleven browser tests run in CI on both pages: loading and counts, search, following connections, filters, share links, minimising panels, the phone layout, and the landing page with and without the API. Not covered: anything drawn on the map itself (markers, heatmaps, lines), because the tests block the public basemap to stay independent of it |
| 8.2 | Performance checks in CI | Frontend | First map on a mid-range phone, filter change under 300 ms |
| 8.3 | Accessibility pass on both pages | Frontend | Keyboard paths, contrast, screen-reader labels |
| 8.4 | Compare the map app with the reference screenshot | Frontend | Depends on 1.8 |
| 8.5 | Privacy, Terms and Data Policy pages | Owner | Required before a public launch. Plain text in the footer today |
| 8.6 | About, Methodology and Contact pages | Owner + frontend | Methodology can be drawn from `docs/sources.md` and the import rules |
| 8.7 | Legal: data residency, ODPC registration | People | Long lead time; start during step 2 |
| 8.8 | Backups with a tested restore | Backend | |
| 8.9 | Security review and a load test at 10 times launch scale | Backend | |
| 8.10 | Social preview image and sharing metadata | Frontend | Once the copy is final |
| 8.11 | Offline caching | Frontend | |
| 8.12 | Production cutover | Backend | |

### Later (Low)

- 3D globe.
- Search queries parsed by a model.
- Private fund seats: portfolio and pipeline layers (the database isolation already exists).
- Watchlists, alerts, paid API.

## 3. Order at a glance

| Step | What | Frontend | Backend | Urgency |
|------|------|----------|---------|---------|
| 1 | Owner checks | — | — | Critical |
| 2 | Put it online | — | Static preview, database, API host, scheduled rebuild | High |
| 3 | Graph intelligence | Graph explorer page, links to and from the map | Memgraph, projection worker, graph API, ingestors | High |
| 4 | Close the gaps in the data | Per-country summary | Events, sources, address lookup abroad, currency | High |
| 5 | Review and accounts | Review screen, profile, submit | Sign-in, roles, audit | Medium |
| 6 | Fresh data | — | Extraction to review queue, matching, scheduler | Medium |
| 7 | Advanced map | Selection, time, satellite | Spatial filters, aggregates | Medium |
| 8 | Quality and launch | Tests, performance, accessibility, missing pages | Backups, security, legal | Medium, then Critical |

Steps 2 and 3 are next and do not depend on each other: step 2 waits on the owner, while most of step 3 can be built locally now. Step 6 does not depend on any frontend work. Step 8.7 has the longest lead time and should start during step 2.

## 4. Waiting on the owner

These block other items and cannot be done from the code:

1. Confirmation that the data's sources allow publishing (1.1). It blocks step 2.
2. Confirmation of the graph architecture and its cost on Railway (3.1).
3. A Supabase project and a host for the API, or Railway for all of it (2.2, 2.3, 3.11).
4. Checks of the investors placed abroad, the rounds, the investors import and the drafts (1.2 to 1.5).
5. For the graph: whether pitch decks may be used and sent to a hosted model, whether founders' universities are recorded, and which external APIs and databases to connect (3.9, 3.10, 3.12).
6. An events source, and any dataset of startups outside Kenya (4.1, 4.2).
7. A Groq API key in `.env` (6.1).
8. A contact address for the crawler and geocoder (2.7).
9. Whether to store and show business emails and phones, and investors' partners (4.9, 4.10).
10. The reference screenshot inside the repo (1.8).

## 5. Sending more data

The importer reads a CSV; a mapping file handles different column headings. Most useful now:

| Data | Why |
|------|-----|
| Events: name, venue, city, start and end, link | The Events layer is empty |
| Startups in other cities, with `City` and `Country` | Only Nairobi has startups |
| Sourced addresses for the investors abroad | Their cities are from general knowledge today |
| Relationships: who invested in whom, who went through which programme, with dates | These are the links the graph is made of; only 37 investment links exist today |
| Founded year | The filter and the card are ready for it |
| Latitude and longitude, where known | Places a record exactly, in any country |

Three rules stay in force: individual angels are placed at city level only, people appear only as a role at an organisation, and data whose terms forbid publishing is not displayed.
