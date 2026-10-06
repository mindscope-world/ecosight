# ecoSight — Final Plan

Updated Oct 7, 2026

What has been built, and everything still to build for the frontend and the backend, in the order it should be done. `frontend_plan.md` has the full interface specification and `plan.md` keeps the original proposal-derived plan and its risk list.

Urgency:

- **Critical** — blocks other work, or blocks showing the product to anyone.
- **High** — needed for the first credible demo.
- **Medium** — needed for launch.
- **Low** — after launch, or only if time allows.

## 1. What is built

The work is public at <https://github.com/mindscope-world/ecosight>. Pull request 1 brings it into `main`, and CI passes on it. Work after that pull request is on the `step-2-real-data` branch. Checks pass locally: 68 TypeScript tests, 74 Python tests, typecheck, build, and first-load JavaScript of 122 KB for the landing page and 356 KB for the map app, each against the 600 KB budget.

### Data

- **Datasets live in `datasets/`**, one dated folder each, kept out of git (see `datasets/README.md`).
- **First real dataset loaded** from `nairobi_startups_organisations_100.csv` (research snapshot Oct 6, 2026). Of 100 rows, the 69 marked verified are published. The other 31 are kept as drafts with a pending review item each: 18 not verified, 7 partially verified, 6 inactive or unclear.
- **Placement of the 69:** 16 at a confirmed building, 23 on their street or neighbourhood, 30 at city level.
- **Funding:** 36 rounds for 25 organisations, read by hand from the funding notes into `curation/nairobi_startups_funding_rounds.json`, each with the words it was read from. USD 112.13 million in rounds with a stated dollar amount. The file also lists 16 items deliberately not recorded as rounds, with reasons.
- **Investors and programs:** a second dataset of 25 Nairobi venture firms, impact investors and accelerators is loaded: 23 published, 2 kept as drafts because their own evidence calls their Nairobi presence unverified. 5 placed at a confirmed building, 9 on their street or neighbourhood, 9 at city level. With the 35 investors named in funding rounds (5 of them the same organisations, merged), 53 investors and programs are on record and 23 are on the map.
- **People:** 118 named as founders. **Sources:** every loaded field carries its source link.
- The synthetic sample now lives only in the test database.

### Database (Postgres, PostGIS, pgvector, pg_trgm; five migrations)

Organisations with eleven entity types, founded year, active status and funding note; offices with address, area and city precision; funding rounds with date precision; round investors; programs; events; people in roles; per-field sources; review queue; audit log; submissions; claims; private fund tables under row-level security; hex aggregates; full-text search; a rule that keeps angels at city level.

### API (Fastify)

Office and event layers; organisation detail with funding and connections; event and round detail; search grouped into organisations, events, cities and sectors, which reads type, sector and city words; stats with period comparison, city scores, funding by month and a recent feed; OpenAPI document.

### Web (React, Tailwind, MapLibre)

Two pages: the landing page at `/` and the map app at `/map/`.

**Landing page.** Hero over a live world map with figures from the product's own records, audience bar, problem section (a table beside the same records on a map), layer cards, an explore preview that travels from the world to Nairobi, three use cases, the relationship chain, example signals marked as demo data, a globe with connections, closing call to action and footer. Specified and reported in `frontend_plan.md` section 14.

**Map app.**

The ecoSight interface: top navigation with six lenses, logo, navy map with a marker shape per entity type, clustering, floating layer control, funding heatmap, startup density, dark, light and terrain styles, collapsible left and right intelligence panels, entity details with funding and one-click graph navigation, search command palette, filter drawer, status bar, share links, and bottom sheets on small screens.

### Pipeline (Python)

- `atlas import-orgs`: dataset importer with a dry-run report, cached geocoding that refuses lookalike matches, and safe re-runs.
- `atlas import-rounds`: loads curated rounds and refuses any whose quote is not in the stored note.
- `atlas crawl`: raw document store and two RSS crawlers (TechCabal, Disrupt Africa).
- `atlas extract` and `atlas eval`: extraction with a rule-based baseline and a Groq model through LangChain, and an accuracy harness.

### Decisions taken

Build clean, no fork. React and Tailwind for the interface, vanilla TypeScript for the map engine. Fastify kept, not FastAPI. UI named ecoSight; internal package names unchanged. Dark theme only, with light as a map style. Free components throughout (`docs/adr/0002-zero-cost-stack.md`). Only verified rows are published. Funding is recorded by a person reading the notes, not by rules.

## 2. What is left, in order

### Step 1 — Check and ship what exists (Critical)

Nothing here needs new features. It makes the work safe, shared and trusted.

| # | Item | Who | Notes |
|---|------|-----|-------|
| 1.1 | ~~Create a remote, push the branch, get CI green~~ | Done | Public repository, CI green on pull request 1. Still to do: merge the pull request |
| 1.2 | ~~Decide whether the dataset files go into git~~ | Done, by default | They are organised under `datasets/` and ignored by git, because the repository is public and they hold names and contacts. Reversible if the owner decides otherwise |
| 1.3 | Confirm the data's sources allow publishing it | Owner | Risk R6 in `plan.md`. Blocks any public deployment |
| 1.4b | Check the investors import | Owner | `curation/nairobi_vc_accelerator_dataset_2026-10-07.mapping.json` records two judgments: "Equator Africa" is the "Equator" named in Leta's round, and two rows are held as drafts. Only people named as founders were loaded, not partners or directors |
| 1.4 | Check the 36 curated rounds | Owner | Especially: investor types are the curator's classification, a bare "$" is read as US dollars, SunCulture is dated by announcement, Pezesha's equity and debt are one round |
| 1.5 | Review the 33 drafts | Owner | 31 from the startups dataset, in particular the 6 marked inactive or unclear; 2 from the investors dataset (The Baobab Network, Pangea Accelerator) |
| 1.6 | Confirm the decisions listed in section 1 and ADR 0002 | Owner | They were taken on recommendation, not signed off |
| 1.7 | Copy the reference screenshot into `docs/reference/` | Owner | The interface has never been compared with it |

### Step 2 — Make the real data work on the map (High)

The first real dataset exposed gaps that the synthetic sample hid. These come first because every later feature is judged on this data.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 2.1 | ~~A way to see records that share one point~~ | Done | Records on one spot keep a counted marker at every zoom; clicking it lists them, and each opens with a link back to the list |
| 2.2 | Locations for investors | Backend + data | **Mostly done.** The Nairobi investors dataset is loaded (19 investors, 10 accelerators and incubators, 1 hub). 17 investors abroad are placed at their headquarters city, in 9 countries, from `curation/investor_headquarters.json`. Those placements rest on the curator's general knowledge, not on cited sources, and say so on each card: they need checking and sourcing. 13 investors remain unplaced because their location is not known with confidence; the file lists them |
| 2.3 | Country-level view | Both | Partly done: records in any country can be stored and drawn, the country filter lists every country with records by name, and the market panel ranks cities worldwide. Still to build: a per-country summary, and street-level address lookup outside Nairobi (records elsewhere sit at their city's centre unless the dataset gives coordinates) |
| 2.4 | ~~Entity types from data~~ | Done | Types are read from a dataset's type or category column, including descriptive ones ("VC / impact investor", "innovation hub and accelerator"). The startups dataset has no such column, so its rows remain startups |
| 2.5b | Startups outside Kenya | Data | The importer accepts them (`City`, `Country`, and optionally `Latitude` and `Longitude` columns), but no dataset of them has been supplied. Three drafts in the Nairobi dataset are described as based elsewhere (London, Mauritius, Kigali); they stay drafts because the research could not confirm them as distinct organisations |
| 2.5 | Events | Data + backend | There are no real events, so the Events layer and its panels are empty. Needs a source: a dataset or a crawler |
| 2.6 | ~~Importer for other datasets~~ | Done | `--mapping` reads other column headings; founded year and coordinates are read when given; an organisation already on record (same website or name) is not loaded twice. Cities other than Nairobi are reported and left without an office until 2.2 and 2.3 |
| 2.7 | Currency conversion | Backend | One round is in Canadian dollars and is left out of dollar totals |
| 2.8 | Business contacts and logo | Backend + owner | Decide whether public business emails and phones are stored and shown; add a logo field |
| 2.9 | Founded year | Data | The filter and the card support it; the dataset has no such column |

### Step 3 — Put it somewhere people can open it (High)

The first demo outside this machine.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 3.1 | Choose the free hosts | Owner | Supabase for the database; any static host for the web app (GitHub Pages works without another account); scheduled jobs on GitHub Actions. A container host for the API is still to choose |
| 3.2 | Staging deployment | Owner + backend | Prepared, not deployed: the API runs as a container (`infra/api/Dockerfile`), the web build reads static data and supports a sub-path, and `docs/deploy.md` has the steps. Needs the accounts from 3.1, and 1.3 before anything is public |
| 3.3 | ~~Public layer build job~~ | Done | `pnpm layers:build` writes the map's data as static files; checked that the map loads with the API stopped. Scheduling it waits on 3.1 |
| 3.4 | ~~Rate limits on the public API~~ | Done | 120 requests a minute per visitor, a quarter of that for search; also a setting for which sites may call the API |
| 3.5 | Error reporting and an uptime check | Backend + owner | Uptime check written (site, map data, API, basemap, every half hour); it starts once the addresses are set as repository variables. Error reporting needs an account with a reporting service |
| 3.6 | Set the crawler and geocoder contact address | Owner | `CRAWLER_USER_AGENT`; required by the services' usage policies before regular use |

**First external demo after this step:** real Nairobi data, click from a startup to its investors and on to their portfolio.

### Step 4 — Filters and search, completed (High)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 4.1 | ~~Filters accepted by the layer and stats endpoints~~ | Done | The API and the browser apply one set of rules from `packages/schema`; a test checks they agree on fifteen filter combinations |
| 4.2 | ~~Activity panels follow the filters~~ | Done | Activity, signals, chart, cities, feed and status bar follow them. If the API cannot be reached the panels keep the all-records figures and say so; the map keeps filtering by itself |
| 4.3 | Remaining filter kinds | Both | Done: country, year of a funding round, event dates, investor activity (active, lead, has portfolio). Not done: region and radius, which wait for the country view (2.3) and area selection (7.1). The country, event and investor filters have little to act on until step 2's data arrives |
| 4.4 | ~~Search results for people~~ | Done | Founders are found by name and open their organisation; anyone who has opted out is left out. Rounds are reached through their organisation |

### Step 5 — Review and accounts (Medium, High for 5.1 and 5.2)

Drafts and, later, pipeline output need somewhere to be approved. Today that is a database edit.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 5.1 | Sign-in and roles | Backend | Magic link, Google, LinkedIn on Supabase |
| 5.2 | Review queue screen | Both | Approve, reject, edit, merge duplicates; every change written to the audit log |
| 5.3 | Profile menu, saved locations, notifications | Both | The header icons are placeholders today |
| 5.4 | Submit an organisation or event; claim a profile by work email | Both | Tables exist |
| 5.5 | Takedown and opt-out handling | Both | People named as founders must be able to ask for removal |

### Step 6 — Keep the data fresh (Medium)

Independent of the frontend; can run alongside steps 4 and 5.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 6.1 | Add the Groq key and run the model extractor once | Owner + backend | Never run against Groq; the default model name is unconfirmed |
| 6.2 | Labelled set: 50, then 200 news items | People | No accuracy figure exists until this does |
| 6.3 | Read each publisher's terms of use | People | Recorded in `docs/sources.md`; needed before daily crawling |
| 6.4 | Match extracted companies to existing records | Backend | Website, name similarity, then embeddings |
| 6.5 | Write extraction results to the review queue | Backend | With per-field source and confidence |
| 6.6 | Confidence scoring and the auto-approval rule | Backend | Rounds above USD 1 million always go to a person |
| 6.7 | Choose the model on the labelled set | Backend | |
| 6.8 | Daily scheduler, run-health alerts, more crawlers | Backend | |
| 6.9 | Stale-record flagging at 12 months | Backend | |

### Step 7 — Advanced map (Medium)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 7.1 | Polygon and radius selection feeding the filters | Both | |
| 7.2 | Recent activity layer | Both | |
| 7.3 | Time slider and deal-flow replay | Both | Rounds now carry dates and their precision |
| 7.4 | Lines from headquarters to branches on selection | Frontend | |
| 7.5 | Satellite style | Frontend + owner | Needs an imagery source with a suitable licence; shown disabled today |
| 7.6 | Hex aggregates for heatmaps | Backend | Heatmaps are drawn in the browser today; needed only at larger scale |

### Step 8 — Quality and launch (Medium, Critical before launch)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 8.1 | End-to-end tests for the core loop | Frontend | Search, filter, select, follow a connection, share link |
| 8.2 | Performance checks in CI | Frontend | First map on a mid-range phone, filter change under 300 ms |
| 8.3 | Accessibility pass | Frontend | Keyboard paths, contrast, screen-reader labels |
| 8.4 | Compare the interface with the reference screenshot | Frontend | Depends on 1.7 |
| 8.5 | Backups with a tested restore | Backend | |
| 8.6 | Security review and a load test at 10 times launch scale | Backend | |
| 8.7 | Legal: data residency, ODPC registration, privacy pages | People | Long lead time; start during step 3 |
| 8.8 | Offline caching | Frontend | |
| 8.9 | Production cutover | Backend | |

### Landing page follow-ups (Medium)

The landing page is built; these are what it still lacks.

| # | Item | Track | Notes |
|---|------|-------|-------|
| L.1 | Privacy, Terms and Data Policy pages | Owner | Required before a public launch; belongs with 8.7. Shown as plain text in the footer today |
| L.2 | About, Methodology and Contact pages | Owner + frontend | Methodology can be drawn from `docs/sources.md` and the import rules |
| L.3 | Sign in and sign up from the landing page | Both | Follows step 5; "Sign in" is inactive and "Join the ecosystem" opens the repository |
| L.4 | Real event points | Data | Investors and programs are now real in Nairobi; events still need a source (2.5) |
| L.5 | Social preview image and sharing metadata | Frontend | Once the copy is final |
| L.6 | Lighthouse and accessibility pass on the landing page | Frontend | With 8.2 and 8.3 |

### Later (Low)

- 3D globe.
- Search queries parsed by a model.
- Private fund seats: portfolio and pipeline layers (the database isolation already exists).
- Watchlists, alerts, paid API.

## 3. Order at a glance

| Step | What | Frontend | Backend | Urgency |
|------|------|----------|---------|---------|
| 1 | Check and ship what exists | — | Remote, CI | Critical |
| 2 | Real data on the map | Stacked records, country view | Investor locations, types, events, importer, currency | High |
| 3 | Somewhere to open it | — | Hosting, staging, layer files, rate limits | High |
| 4 | Filters and search completed | Panels follow filters, more filter kinds | Filters on the API | High |
| 5 | Review and accounts | Review screen, profile, submit | Sign-in, roles, audit | Medium |
| 6 | Fresh data | — | Extraction to review queue, matching, scheduler | Medium |
| 7 | Advanced map | Selection, time, lines, satellite | Spatial filters, aggregates | Medium |
| 8 | Quality and launch | Tests, performance, accessibility | Backups, security, legal | Medium, then Critical |
| L | Landing page follow-ups | Missing pages, sharing metadata | — | Medium |

Steps 1 and 2 are the priority. Step 6 does not depend on any frontend work and can start as soon as 6.1 to 6.3 are done. Step 8.7 has the longest lead time and should start no later than step 3.

## 4. Waiting on the owner

These block other items and cannot be done from the code:

1. A remote for the repository (1.1).
2. Whether the dataset files go into git, and whether their sources allow publishing (1.2, 1.3).
3. A check of the 36 rounds and the 31 drafts (1.4, 1.5).
4. The reference screenshot inside the repo (1.7).
5. A Groq API key in `.env` (6.1).
6. Which hosts to use (3.1), and a contact address for the crawler (3.6).
7. Whether to store and show business emails and phone numbers (2.8).

## 5. Sending more data

The importer reads a CSV. Useful columns, beyond what the first dataset had:

| Field | Why |
|-------|-----|
| Type (startup, investor, accelerator, hub, university and so on) | Fills the other layers; everything is a startup today |
| Founded year | The filter and the card are ready for it |
| City and country for investors | Puts investors on the map |
| Events: name, venue, start and end, link | The Events layer is empty |
| Latitude and longitude, where known | Removes the need to look addresses up |

Three rules stay in force: individual angels are placed at city level only, people appear only as a role at an organisation, and data whose terms forbid publishing is not displayed.
