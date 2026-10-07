# ecoSight — Final Plan

Updated Oct 7, 2026

What has been built, and everything still to build for the frontend and the backend, in the order it should be done. `frontend_plan.md` has the interface specification for the map app, the landing page and the graph explorer. `plan.md` keeps the original proposal-derived plan and its risk list.

Urgency:

- **Critical** — blocks other work, or blocks showing the product to anyone.
- **High** — needed for the first credible demo.
- **Medium** — needed for launch.
- **Low** — after launch, or only if time allows.

## 1. What is built

The code is public at <https://github.com/mindscope-world/ecosight>; the data is not in it. The repository's history was rewritten on Oct 7, 2026 to remove the curated data, so earlier commit ids no longer exist. `main` holds everything up to the investors dataset. Later work is on the `beyond-kenya` and `map-polish-and-e2e` branches, both pushed.

Checks pass: 71 TypeScript tests, 74 Python tests, 11 end-to-end browser tests, typecheck, build, and first-load JavaScript of 122 KB for the landing page and 356 KB for the map app, each against a 600 KB budget. CI runs them on every pull request.

### Data

| | Count |
|---|---|
| Organisations published | 213 |
| Organisations on the map | 200, in 18 countries |
| Startups | 69, all in Nairobi |
| Investors, accelerators, hubs and funders | 69 published |
| Universities | 35 |
| Public bodies | 29 |
| NGOs | 12 |
| Funding rounds | 36, for 25 organisations; USD 112.13 million in rounds with a stated dollar amount |
| People named as founders | 141 |
| Drafts held back for review | 37 |
| Events | 0 |

- **Startups dataset** (`datasets/nairobi-startups-2026-10-06/`): 100 rows; the 69 marked verified are published, 31 are drafts.
- **Funding rounds** (`curation/nairobi_startups_funding_rounds.json`): read by hand from the startups dataset's funding notes, each with the words it was read from, plus 16 items deliberately not recorded as rounds.
- **Investors dataset** (`datasets/nairobi-investors-2026-10-07/`): 25 rows; 23 published, 2 drafts. Five were merged into investors already known from funding rounds.
- **East Africa dataset** (`datasets/east-africa-2026-10-07/`): 100 universities, public bodies, NGOs and innovation hubs in nine countries; 96 published, 4 drafts. Five were merged into organisations already on record. Each row's type, city, country code and sector tags were set by hand in `curation/east_africa_100_organizations.mapping.json`. 68 are placed on a building or street, 32 at their city's centre.
- **Stated relationships** (`curation/stated_relationships.csv`): 19 ties read by hand from the two datasets' own text, each with the words it rests on. 16 are published; 3 name an organisation that is not on record and wait in the review queue.
- **Investors abroad** (`curation/investor_headquarters.json`): 17 placed at their headquarters city, on the curator's general knowledge and marked as unsourced on each card. 13 more are listed as not placed.
- **The data is private.** Datasets and the curated files are kept out of git and were purged from the repository's history on Oct 7, 2026. `datasets/README.md` indexes them. The synthetic sample lives only in the test database.

### Database (Postgres, PostGIS, pgvector, pg_trgm; eleven migrations)

Organisations with eleven entity types, other names they go by, founded year, active status and funding note; offices at address, area or city precision in any country; funding rounds with date precision; round investors; programs; events; people in roles; per-field sources with their stated basis; review queue; audit log; submissions; claims; private fund tables under row-level security; a view of per-organisation funding facts; full-text search; a rule that keeps angels at city level.

### API (Fastify)

Office and event layers; organisation detail with funding and connections; event and round detail; search grouped into organisations, people, events, cities and sectors, which reads type, sector and city words; stats with period comparison, city scores, funding by month and a recent feed. Graph queries over the same records: neighbourhood, expand, shortest path, co-investment and most connected. Layers and stats accept the same filters as share links. Rate limits, a setting for which sites may call it, a container definition, and a job that writes the map's data as static files.

### Web (React, Tailwind, MapLibre)

Five pages.

**Landing page** at `/`. Hero over a live world map with figures from the product's own records, audience bar, the problem as a table beside the same records on a map, layer cards, an explore preview from the world down to Nairobi, three use cases, the relationship chain, example signals marked as demo data, a globe with connections, closing call to action and footer.

**Map app** at `/map/`. Top navigation with six lenses; navy map with a marker shape per entity type; clustering that lists records sharing one spot; floating layer control; four heatmaps (funding, and startup, investor and accelerator density, each in its own colour); dark, light and terrain styles; collapsible intelligence panels that follow the filters; entity details with funding, sources and one-click graph navigation; search command palette; filter drawer with ten kinds of filter; status bar; share links; bottom sheets on small screens.

**Graph page** at `/graph/`. Opens on the whole network of investments, programmes and organised events; any organisation can be made the starting point. Nodes use the map's shapes and colours and links are styled by kind. Click for details, double-click or a button to bring in a node's other connections, click a link for the rounds behind it. Six kinds of link can be switched on and off, with people, places and sectors off to begin with. A path finder, co-investor and shared-investor lists, a list of everything in view, and share links that restore the graph. Reached from "View connections" in the map's details panel, and leads back with "Show on map".

**Dashboard** at `/dashboard/`. One tab per kind of organisation: startups, investors, accelerators, NGOs, innovation hubs, universities, government and corporates. Each has headline figures, bar charts (by country and sector; by stage and most raised for startups; largest portfolios for investors) and a table that sorts, searches, narrows by country and pages. A row opens the record's details with links to the map and the graph.

**Review queue** at `/review/`, for reviewers. What the importers held back, with the reason for each; approve, reject with a note, or reopen. The header of every page has an account menu: sign in by emailed link, see who is signed in, sign out.

### Pipeline (Python)

- `atlas convert-rounds`: US dollar figures for rounds reported in another currency, at published reference rates, with the basis recorded.
- `atlas import-links`: relationships between organisations from a CSV, published only when both organisations are on record and the row has a source; the rest go to the review queue.
- `atlas import-orgs`: dataset importer with a dry-run report, column mappings for other datasets, cached geocoding that refuses lookalike matches, merging into records already on file, values a curator sets for one row, and address lookup in any city.
- `atlas import-rounds`: loads curated rounds and refuses any whose quote is not in the stored note.
- `atlas import-locations`: places organisations that have no office at a named city.
- `atlas crawl`: raw document store and two RSS crawlers (TechCabal, Disrupt Africa).
- `atlas extract` and `atlas eval`: extraction with a rule-based baseline and a Groq model through LangChain, and an accuracy harness.

### Deployment

Online since Oct 7, 2026, on free tiers, and private: the landing page at <https://mindscope-world.github.io/ecosight/> and the map app under `/map/`, which opens only with the access key in `.env`. The database is on Supabase with all the data loaded and its public REST interface closed. The API runs as a Supabase Edge Function. The web app is on GitHub Pages and holds code only. `docs/deploy.md` has the commands. Deploying is done by hand.

### Decisions taken

Build clean, no fork. React and Tailwind for the interface, vanilla TypeScript for the map engine. Fastify kept, not FastAPI. UI named ecoSight; internal package names unchanged. Dark theme only, with light as a map style. Free components throughout, with no paid hosting until there is revenue (`docs/adr/0002-zero-cost-stack.md`). Postgres is the system of record; Memgraph is deferred (`docs/adr/0003-graph-engine.md`). The data may not be published: a deployed copy opens only with an access key. Only verified rows are published. Funding is recorded by a person reading the notes, not by rules. Only people named as founders are loaded. Emails and phone numbers are not loaded.

## 2. What is left, in order

### Step 1 — Owner checks (Critical)

No code. These make what exists trustworthy, and 1.1 blocks any public deployment.

| # | Item | Notes |
|---|------|-------|
| 1.1 | ~~Confirm whether the data may be published~~ | **Decided: it may not.** The datasets and everything curated from them are out of git and purged from the repository's history. A deployed API requires an access key, and the map data is never put on a public host as files. See 1.9 for what is left of the purge |
| 1.2 | Check the investors placed abroad | `curation/investor_headquarters.json`: 17 placements from general knowledge, and 13 not placed that the owner may know |
| 1.3 | Check the 36 curated rounds | Investor types are the curator's classification; a bare "$" is read as US dollars; one round is dated by its announcement, not its close; one round counts equity and debt together |
| 1.4 | Check the investors import | One investor in the dataset is treated as the same organisation as a differently named investor in a funding round; two rows are held as drafts. Both judgments are in the mapping file under `curation/` |
| 1.5 | Review the 37 drafts | In particular the 6 startups marked inactive or unclear, and the 4 East African bodies held back: two replaced by successor agencies, one the research calls historical, one whose status is unclear |
| 1.5b | Check the East Africa import | `curation/east_africa_100_organizations.mapping.json`: the type and sector tags given to each of the 100 rows are the curator's reading of the dataset's descriptions. Leadership was loaded only where a person is named as a founder (11 people at 6 organisations) |
| 1.5c | Check the stated relationships | `curation/stated_relationships.csv`: 16 ties published from the datasets' own wording. Judgments to confirm: a campus inside an innovation district is recorded as "hosted by" it; a startup with an office in a hub's building as "hosted by" the hub; a portfolio listing with no round as "backed by". Three rows wait in the queue because the other organisation is not on record |
| 1.5d | Settle the review queue | 37 draft organisations and 3 proposed relationships are waiting at `/review/`. Sign in with the owner's address, which is on the list as admin |
| 1.5e | Set up a mail service for sign-in | Until then Supabase emails sign-in links only to the project's own members, a couple an hour. Needed before anyone else is given an account |
| 1.6 | Merge the `beyond-kenya` branch | Needs a pull request into `main` |
| 1.7 | Confirm the decisions listed in section 1 | They were taken on recommendation, not signed off |
| 1.8 | Copy the reference screenshot into `docs/reference/` | The map app has never been compared with it |
| 1.9 | Finish the purge on GitHub | The branches are clean, but GitHub still serves the old data file to anyone with an old commit link, because the three closed pull requests keep those commits. Only GitHub Support, or deleting and recreating the repository, removes them |

### Step 2 — Put it online, privately (High) — mostly done

The data is private, so the deployed app opens only with an access key. Hosting is free-tier only until there is revenue.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 2.1 | ~~Close the app to the public~~ | Done | The API takes an `ACCESS_KEY`; without it every route but the health check answers 401, nothing is cacheable, and the app shows an access screen. A shared key is a stopgap until sign-in (5.1) |
| 2.2 | ~~Database on Supabase~~ | Done | Migrations applied through Supabase's management API with an access token, since there is no database password in use. All four imports run; counts match the local database. The public REST interface is closed by `infra/supabase/harden.sql`, and the API connects as `ecosight_app`, an ordinary login |
| 2.3 | ~~Host for the API~~ | Done | A Supabase Edge Function running the same Fastify app, so no further account was needed. Answers in about a second. `render.yaml` is kept as an untested alternative |
| 2.3b | ~~Host for the web app~~ | Done | GitHub Pages, from the `gh-pages` branch. Checked in a browser: access screen without the key; counts, search and details with it |
| 2.4 | ~~Scheduled rebuild of the map data~~ | Dropped | Static map files would put the data on a public host. The app reads through the keyed API |
| 2.5 | Turn on the uptime check | Backend | Set the site and API addresses as repository variables, after this branch is merged: the workflow on `main` still checks for static map data and would fail |
| 2.6 | Error reporting | Owner + backend | Needs an account with a reporting service |
| 2.7 | Contact address for the crawler and geocoder | Owner | Required by the services' usage policies before regular use |
| 2.8 | Replace the Supabase access token | Owner | The one in use was pasted into a chat. Revoke it in the Supabase dashboard and put a new one in `.env`; it is needed only for migrations and deploys |
| 2.9 | Keep the free database awake | Backend | Supabase pauses a free project after a week idle. The uptime check does not reach the database yet |
| 2.10 | Deploy from CI | Backend | By hand today. Needs the access token and access key as repository secrets |

**First external demo after this step:** the landing page, which shows illustrative points without a key, then the map for those given the key.

### Step 3 — Graph intelligence (High)

Connections between organisations become something to explore in their own right: a graph engine, an interface over it, and a page built for following links. The architecture and the reasons are in `docs/adr/0003-graph-engine.md`; the page is specified in `frontend_plan.md` section 15.

The owner has accepted Postgres as the system of record and ruled out paid hosting before revenue. No free host can run Memgraph, so the order is: build the graph API and the explorer page now, answered by Postgres, and add Memgraph behind the same API later. The web app cannot tell which store answered.

Items 3.5 to 3.8 are next and need nothing from the owner.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 3.1 | ~~Confirm the architecture and its cost~~ | Decided | Postgres is the system of record. No paid host: Memgraph on Railway is deferred until there is revenue |
| 3.2 | Graph model | Backend | One `Entity` label plus a kind label; relationships `INVESTED_IN`, `ACCELERATED_AT`, `ORGANISED`, `HAS_ROLE`, `LOCATED_IN`, `IN_SECTOR`; a uniqueness constraint on id and a spatial point index, with the index statement checked against the Memgraph version used |
| 3.3 | Memgraph in the local Docker setup | Backend | **Deferred** with 3.4 and 3.11. Beside Postgres, with a volume, and a start-up script for constraints and indexes |
| 3.4 | Projection worker | Backend | **Deferred.** Asynchronous Python over Bolt. Copies published records and their relationships from Postgres in batches, idempotently; a full rebuild and an incremental sync. Drafts never leave Postgres. Relationship types come from a fixed list |
| 3.5 | ~~Graph API~~ | Done | Answered by Postgres through a `graph_edge` view (migration 0008). Six routes: `/graph/overview` (the whole network, capped), `/graph/neighbourhood` (depth 1 to 3, capped), `/graph/expand` (paged), `/graph/path`, `/graph/co-investment`, `/graph/top`. All take the kinds of link and the map's filters; each query has a 3-second limit and the routes share search's smaller rate allowance. People, places and sectors are followed only when asked for. Deployed |
| 3.6 | ~~Graph explorer page~~ | Done | At `/graph/`, drawn in SVG with a force layout worked out in one go, so the same graph always looks the same. Not done from the specification: the map's filters on this page, a radial layout, and paging beyond 40 neighbours per expansion |
| 3.7 | ~~Links between the map and the graph~~ | Done | "View connections" in the map's and the dashboard's details panels; "Show on map" from the graph. Both are share links |
| 3.8 | ~~Tests~~ | Done for now | 28 API tests for the graph queries and six browser tests for the page. When Memgraph arrives: a check that it matches Postgres after a sync |
| 3.8b | ~~Dashboard of tables~~ | Done | At `/dashboard/`, fed by a new `/orgs` list route. Not built: export to a file, and an events table (there are no events) |
| 3.8c | Relationship data | Data | **The graph is still thin**, though less so: 37 investment links, 3 programme places and 13 other ties (part of, hosted by, member of, founded by, backed by), on 79 organisations. Most of the East African institutions still have no links. Needs relationship datasets from the owner: programme cohorts, partnerships, grants. The file format is in `datasets/README.md` |
| 3.9 | Ingestors, through the review queue | Backend | **Relationship CSVs: done.** `atlas import-links` reads "from, relation, to" rows with a source link and a quote. A row whose two organisations are both published and which has a source is loaded; every other row goes to the review queue with its reason. No organisation is created from a name and no name is matched by guesswork. Six new kinds of tie live in `organisation_link` (migration 0009); programme places use the programme tables. First file loaded: 19 relationships stated in the datasets already held, 16 published and 3 queued. **Still to do:** external APIs and other databases, once the owner names them |
| 3.10 | Pitch decks | Owner + backend | Upload, private storage, extraction by a language model, and review before anything is published. Blocked on the owner: decks are confidential, and their text would go to a hosted model |
| 3.11 | Deploy Memgraph | Owner + backend | **Deferred until there is revenue.** On a host with enough memory and a persistent volume at `/var/lib/memgraph`, with the worker as its own service and a written procedure for rebuilding the graph from Postgres |
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
| 4.5 | ~~Street-level address lookup outside Nairobi~~ | Done | An address is looked up within about 30 km of its city's centre, with the same refusal of lookalike matches. A university or public body whose address is not found is placed where the map names it. Otherwise the city's centre |
| 4.6 | ~~Per-country summary~~ | Done | A "By country" tab on the dashboard: one row per country with organisations, cities, each kind, rounds and money raised, counted where each organisation is based, with bars for organisations and money by country. A country's name opens the map filtered to it. Worked out in the browser from the rows the dashboard already loads |
| 4.7 | ~~Currency conversion~~ | Done | `atlas convert-rounds` gives rounds in another currency a US dollar figure at the European Central Bank reference rate (through the free Frankfurter service): the day's rate for a round dated to a day, the period's average for one dated to a month or year. The original amount is kept and the rate and its basis are stored with the round. The one Canadian-dollar round is converted. **Limits:** currencies the ECB does not publish, the Kenyan shilling among them, are left unconverted; and `import-rounds` rebuilds rounds, so run `convert-rounds` after it |
| 4.8 | Founded year | Data | The filter and the card support it; neither dataset has the column |
| 4.9 | Business contacts and logos | Owner + backend | Decide whether public business emails and phones are stored and shown; add a logo field |
| 4.10 | Partners and directors of investors | Owner | The investors dataset lists them; only founders are loaded today |

### Step 5 — Review and accounts (Medium, High for 5.1 and 5.2)

The drafts, and the output of the pipeline and the importers, are approved on the review page.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 5.1 | Sign-in and roles | Backend | **Magic link: done.** Sign-in by emailed link through Supabase, with no library: the session is kept in the browser and sent with each request, and the API checks it with the project. Signing in proves an address; the `app_user` table (migration 0010, kept with `pnpm users`) says whether it is let in and as viewer, reviewer or admin. The shared access key still opens the app for reading. Proved on the live API with a temporary account in each role. **Not done:** Google and LinkedIn, which need OAuth apps only the owner can create; and a mail service, without which Supabase emails only the project's own members |
| 5.2 | Review queue screen | Both | **Approve, reject, archive and reopen: done.** `/review/`, for reviewers only. Draft organisations and proposed relationships are listed with why each was held. Approving publishes; rejecting keeps it out, with a note; archiving sets aside what is incomplete or unverified, in a list of its own, until more is known. Any of the three can be reopened. For a relationship naming an organisation that is not on record, the reviewer chooses the record it means. Every decision is recorded with who made it and written to the audit log, and reloading a dataset keeps it. **Not done:** editing a record's fields, merging duplicates, and reopening an approved relationship |
| 5.3 | Profile menu, saved locations, notifications | Both | The header icons are placeholders today |
| 5.4 | Submit an organisation or event; claim a profile by work email | Both | Tables exist |
| 5.5 | Takedown and opt-out handling | Both | People named as founders must be able to ask for removal |
| 5.6 | Sign in and sign up from the landing page | Frontend | "Sign in" is inactive and "Join the ecosystem" opens the repository |

### Step 6 — Keep the data fresh (Medium)

Independent of the frontend; can run alongside steps 4 and 5.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 6.1 | Run the model extractor once | Backend | The Groq key is in `.env`. Never run against Groq; the default model name is unconfirmed |
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
| 8.1 | End-to-end tests for the core loop | Frontend | **Mostly done.** Twenty browser tests run in CI on all four pages: loading and counts, search, following connections, filters, share links, minimising panels, the phone layout, and the landing page with and without the API. Not covered: anything drawn on the map itself (markers, heatmaps, lines), because the tests block the public basemap to stay independent of it |
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
| 2 | Put it online, privately | Access screen, GitHub Pages | Access key, Supabase database, API as an edge function | High, mostly done |
| 3 | Graph intelligence | Graph explorer page, links to and from the map | Graph API on Postgres now; Memgraph and its worker later; ingestors | High |
| 4 | Close the gaps in the data | Per-country summary | Events, sources, address lookup abroad, currency | High |
| 5 | Review and accounts | Review screen, profile, submit | Sign-in, roles, audit | Medium |
| 6 | Fresh data | — | Extraction to review queue, matching, scheduler | Medium |
| 7 | Advanced map | Selection, time, satellite | Spatial filters, aggregates | Medium |
| 8 | Quality and launch | Tests, performance, accessibility, missing pages | Backups, security, legal | Medium, then Critical |

Step 2 is done apart from small follow-ups. The graph API, the graph page and the dashboard are built and deployed (3.5 to 3.8b); the relationship importer is built and the first ties are loaded (3.9). What the graph needs now is more relationship data from the owner (3.8c), and the review screen (5.2) to settle what the importer queues. Step 6 does not depend on any frontend work. Step 8.7 has the longest lead time and should start during step 2.

## 4. Waiting on the owner

These block other items and cannot be done from the code:

1. Revoke the Supabase access token that was pasted into the chat and put a new one in `.env` (2.8).
2. Decide who gets the access key, and merge the open branches so the uptime check can be turned on (1.6, 2.5).
3. What to do about the old commits GitHub still holds (1.9): ask GitHub Support to remove them, or delete and recreate the repository.
4. Checks of the investors placed abroad, the rounds, the investors import and the drafts (1.2 to 1.5).
5. For the graph: whether pitch decks may be used and sent to a hosted model, whether founders' universities are recorded, and which external APIs and databases to connect (3.9, 3.10, 3.12).
6. An events source, and any dataset of startups outside Kenya (4.1, 4.2).
7. ~~A Groq API key in `.env`~~ Supplied; the extractor has not been run with it yet (6.1).
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
