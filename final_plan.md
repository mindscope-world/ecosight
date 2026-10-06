# ecoSight — Final Plan

Oct 6, 2026

Everything left to build for the frontend and the backend, in the order it should be built, with urgency. This is the working order. `plan.md` keeps the original proposal-derived plan and its risk list; `frontend_plan.md` has the full UI specification.

Urgency:

- **Critical** — blocks other work or blocks showing the product to anyone.
- **High** — needed for the first credible demo.
- **Medium** — needed for launch.
- **Low** — after launch, or only if time allows.

## Where things stand

Built and passing checks locally (40 TypeScript tests, 26 Python tests, first-load JavaScript 353 KB of a 600 KB budget):

- **Database:** Postgres with PostGIS, pgvector and pg_trgm; organisations, offices, funding rounds, investors, programs, events, provenance, review queue, audit log, submissions, claims, private fund tables with row-level security, hex aggregates.
- **API (Fastify):** office and event layers, organisation detail with connections, event and round detail, grouped search that reads type, sector and city words, stats with period comparison, city scores, funding by month and a recent feed.
- **Web (React, Tailwind, MapLibre):** the ecoSight interface from `frontend_plan.md`: top navigation, shaped markers, layer control, heatmaps, three map styles, left and right intelligence panels, entity details with graph navigation, search command palette, filter drawer, status bar, bottom sheets on small screens. `frontend_plan.md` section 13 lists what is and is not built.
- **Pipeline (Python):** raw document store, two RSS crawlers, extraction with a rule-based baseline and a Groq model through LangChain, eval harness.

Not done: nothing after the first commit is committed, there is no remote, CI has never run, the data is synthetic, and the Groq path has not been run against Groq.

Phases 2, 3 and 4 below were built ahead of phase 1, on the synthetic sample. Their remaining items are marked.

## Phase 0 — Unblock (Critical, do first)

| # | Item | Track | Notes |
|---|------|-------|-------|
| 0.1 | Commit the `sprint-2-foundations` branch, add a remote, push, get CI green | Both | Everything since the first commit is uncommitted |
| 0.2 | Settle the open decisions in `frontend_plan.md` section 12 | Both | React and Tailwind, Fastify or FastAPI, the ecoSight name, scope. Phase 2 cannot start without the first three |
| 0.3 | Add the Groq key to `.env` and run the model extractor once | Backend | Confirms the default model name is still offered |
| 0.4 | Copy the reference screenshot into `docs/reference/` | Frontend | It could not be read from outside the project |

## Phase 1 — Real data in (Critical) — first dataset loaded

Loaded on Oct 7, 2026 from `nairobi_startups_organisations_100.csv` (research snapshot Oct 6, 2026):

- 100 rows read. The 69 marked verified are published; the other 31 (18 not verified, 7 partially verified, 6 inactive or unclear) are drafts with pending review items.
- Of the 69: 16 are placed at a confirmed building, 23 on their street or neighbourhood, 30 at city level.
- 118 people named as founders, 403 field sources. All 100 are typed as startups.
- Not loaded by the importer: business emails and phone numbers. Funding rounds and investors were added afterwards by hand, see below.
- The synthetic sample now lives only in the test database (`pnpm db:test`).

Done: 1.1 except logo URL, 1.2, 1.3, 1.4 (within the dataset), 1.5, 1.7, 1.8. Remaining in this phase:

- Review the 31 drafts, in particular the 6 marked inactive or unclear.
- Have the owner check the 36 rounds read from the funding notes (`curation/nairobi_startups_funding_rounds.json`): 25 organisations, 35 investors, USD 112.13 million in rounds with a stated dollar amount. The file also lists 16 items deliberately not recorded as rounds, with the reason for each.
- Investors created from those rounds have a name and a type only: no office, so they are in search and in connections but not on the map.
- Convert non-dollar amounts (one CAD prize so far) once currency conversion exists.
- Decide whether business emails and phones should be stored and shown.
- City-level records all sit on one point in the city centre; the map needs a way to list them (30 today).
- Entity types beyond startup, when a dataset carries them.

The real startup dataset replaces the synthetic sample. This comes before the redesign so every later screen is built and judged on real records.

| # | Item | Track | Urgency |
|---|------|-------|---------|
| 1.1 | Schema additions: new entity types, founded year and active status are done (migration 0003). Logo URL still to add | Backend | Critical |
| 1.2 | Dataset importer: read the file, validate, report problems row by row, load nothing until the report is clean or the problems are accepted | Backend | Critical |
| 1.3 | Geocoding for rows without coordinates: public Nominatim at one request per second, results cached | Backend | Critical |
| 1.4 | Duplicate detection inside the dataset and against existing records: website domain, then name similarity | Backend | Critical |
| 1.5 | Provenance on import: every loaded field gets a source and method, so cards show where data came from | Backend | High |
| 1.6 | City centroids for every city in the dataset, so city-precision records can be placed | Backend | High |
| 1.7 | Update API tests and seed handling so the synthetic sample is test-only | Backend | High |
| 1.8 | Check the map with real volume: clustering, load time, cards | Frontend | High |

### What the dataset should contain

Any of CSV, Excel or JSON works. One row per organisation is easiest; funding rounds and extra offices can be separate sheets or files keyed by organisation name or website.

| Field | Needed | Notes |
|-------|--------|-------|
| Name | Required | |
| Type | Required | Startup, investor, accelerator, and so on. Several allowed |
| City and country | Required | |
| Website | Strongly preferred | Used to catch duplicates |
| Address, or latitude and longitude | Preferred | Without either, the record is placed at the city centre |
| Sectors | Preferred | One or more |
| Description | Preferred | |
| Stage, founded year, active or not | Optional | |
| Branch offices | Optional | City, country, address |
| Funding rounds | Optional | Date, stage, amount, currency, investors, lead |
| Source link per record | Preferred | Shown on the card as provenance |

Three things to know before uploading:

- Individual angel investors are placed at city level only, never at an address. Leave home addresses out.
- People appear only as a role at an organisation (for example founder). Personal contact details are not loaded.
- Say where the data came from and whether its terms allow publishing it. Licensed data cannot be displayed (risk R6 in `plan.md`).

When the file arrives the first output is a validation report: rows read, rows ready, duplicates, rows that could not be located, values that did not fit. Nothing is published until that report has been reviewed.

## Phase 2 — Design system and shell (High) — built

Remaining: a check against the reference screenshot once it is in the repo.

| # | Item | Track |
|---|------|-------|
| 2.1 | Design tokens, typography, panel and micro-label styles from the brief; categorical colours validated on the dark surface | Frontend |
| 2.2 | Move the UI shell to React and Tailwind if decision 0.2 says so; map adapter and layers stay vanilla TypeScript | Frontend |
| 2.3 | Rebrand to ecoSight: logo, wordmark, title | Frontend |
| 2.4 | Top navigation: MAP, DISCOVER, ECOSYSTEMS, INVESTORS, STARTUPS, EVENTS, search trigger; account icons as placeholders | Frontend |
| 2.5 | Dark map style tuned to the palette | Frontend |
| 2.6 | Left and right panel frames, collapsible, reusing the existing window mechanism | Frontend |
| 2.7 | Bottom status bar | Frontend |
| 2.8 | `/stats`: add location and country counts and last-updated time for the status bar | Backend |
| 2.9 | Fold the dashboard into the panels; move settings behind the profile menu | Frontend |

## Phase 3 — Markers, layers, details (High) — built except 3.8

| # | Item | Track |
|---|------|-------|
| 3.1 | Marker shapes per entity type and shaped cluster markers; map legend | Frontend |
| 3.2 | Floating layer control with the new layers and a map style switcher (dark, light first) | Frontend |
| 3.3 | Layer endpoints for the new entity types | Backend |
| 3.4 | Entity details panel: header facts, company, funding summary, investors, locations | Frontend |
| 3.5 | Organisation detail: total raised, latest round, investors, founded year, status | Backend |
| 3.6 | Connections endpoint: investors, portfolio, programs, events and people-in-roles for an entity | Backend |
| 3.7 | Connections section with one-click navigation through the graph; the map follows | Frontend |
| 3.8 | Public layer build job: write layer GeoJSON to static files for the CDN | Backend |

**First demo after this phase:** real data, the new look, click through from a startup to its investors and on to their portfolio.

## Phase 4 — Search and filters (High) — partly built

Built: 4.1, 4.3, 4.4, 4.5, 4.6, with filtering done in the browser on the loaded layer data. Remaining: 4.2 (filters on the API, needed once data outgrows the browser and for filtered activity panels) and 4.7.

| # | Item | Track |
|---|------|-------|
| 4.1 | Shared filter schema in `packages/schema`: type, sector, stage, amount, founded year, geography, dates, status | Both |
| 4.2 | Every layer and stats endpoint accepts the filter set | Backend |
| 4.3 | Filter drawer; filters update markers, panels and status bar together; filters in share links | Frontend |
| 4.4 | Search across organisations, events, cities and sectors, grouped with counts | Backend |
| 4.5 | Search command palette with keyboard access and grouped results | Frontend |
| 4.6 | Structured query words: type, sector and place ("fintech investors in Nairobi") | Backend |
| 4.7 | Rate limits on the public API | Backend |

## Phase 5 — Intelligence panels (Medium) — built except 5.8

The panels describe the whole dataset; making them follow the filters depends on 4.2.

| # | Item | Track |
|---|------|-------|
| 5.1 | Period statistics: counts for this period and the previous one, by type, sector and city | Backend |
| 5.2 | Activity score per city, as a documented formula | Backend |
| 5.3 | Ecosystem activity with trend figures; top sectors with shares; market activity | Frontend |
| 5.4 | Funding by month endpoint and the capital activity line chart | Both |
| 5.5 | Emerging cities ranking | Both |
| 5.6 | Recent activity feed from record creation and the audit log | Both |
| 5.7 | Ecosystem signals as rules over the period statistics | Both |
| 5.8 | Currency conversion for rounds, so totals are comparable | Backend |

Trends need history. With a freshly imported dataset, period-over-period figures are only meaningful where records carry real dates (founded, round announced). Panels show "not enough history" instead of a made-up figure.

## Phase 6 — Pipeline to keep data fresh (Medium)

| # | Item | Track |
|---|------|-------|
| 6.1 | Labelled set: first 50, then 200 news items | People |
| 6.2 | Extraction results written to the review queue with per-field source and confidence | Backend |
| 6.3 | Match extracted companies to existing records: domain, name similarity, embeddings | Backend |
| 6.4 | Confidence scoring and the auto-approval rule; rounds above USD 1m always go to a person | Backend |
| 6.5 | Provider choice on the labelled set | Backend |
| 6.6 | Daily scheduler, run-health alerts, more crawlers, partner CSV import | Backend |
| 6.7 | Read each publisher's terms; set the crawler's contact address | People |
| 6.8 | Nightly hex aggregates; stale-record flagging at 12 months | Backend |

## Phase 7 — Advanced map (Medium)

| # | Item | Track |
|---|------|-------|
| 7.1 | Funding heatmap and startup density layers from hex aggregates | Both |
| 7.2 | Recent activity layer | Both |
| 7.3 | Terrain style; satellite once a tile source is chosen | Frontend |
| 7.4 | Polygon and radius selection feeding the filter set | Both |
| 7.5 | Country-level view with per-country summaries | Both |
| 7.6 | Time slider and deal-flow replay | Both |
| 7.7 | HQ-to-branch lines on selection | Frontend |

## Phase 8 — Accounts and contribution (Medium)

| # | Item | Track |
|---|------|-------|
| 8.1 | Sign-in (magic link, Google, LinkedIn) and roles on Supabase | Backend |
| 8.2 | Profile menu, saved locations, notifications | Both |
| 8.3 | Submit an organisation or event; claim a profile by work email | Both |
| 8.4 | Admin review queue: approve, reject, merge duplicates, edit; audit log writes | Both |
| 8.5 | Takedown and opt-out handling | Both |

## Phase 9 — Responsive, quality, launch (Medium, then Critical before launch)

| # | Item | Track |
|---|------|-------|
| 9.1 | Tablet and phone redesign: bottom sheets, floating search | Frontend |
| 9.2 | Accessibility pass; keyboard paths for search, filters and panels | Frontend |
| 9.3 | Playwright tests for the core loop; Lighthouse and filter-timing checks in CI | Frontend |
| 9.4 | Hosting: Supabase project, a free host for the API and workers, static hosting for the web app | Backend |
| 9.5 | Backups with a tested restore; uptime checks; error reporting | Backend |
| 9.6 | Security review, load test at 10 times launch scale | Backend |
| 9.7 | Legal: data residency, ODPC registration, privacy pages | People |
| 9.8 | Service worker caching | Frontend |

## Later (Low)

- 3D globe.
- Natural-language search parsed by a model.
- Private fund seats: portfolio and pipeline layers (the database isolation already exists).
- Watchlists, alerts, paid API.

## Order at a glance

| Order | Phase | Frontend | Backend | Urgency |
|-------|-------|----------|---------|---------|
| 0 | Unblock | Reference screenshot | Commit, push, CI, Groq key | Critical |
| 1 | Real data in | Check map at real volume | Schema additions, importer, geocoding, dedupe | Critical |
| 2 | Design system and shell | Tokens, header, panels, status bar, rebrand | Status bar counts | High |
| 3 | Markers, layers, details | Shapes, layer control, details, connections | New-type layers, detail, connections | High |
| 4 | Search and filters | Command palette, filter drawer | Filtered endpoints, grouped search | High |
| 5 | Intelligence panels | Activity, sectors, cities, chart, feed | Period stats, scores, feed | Medium |
| 6 | Pipeline | — | Review queue, matching, scheduler | Medium |
| 7 | Advanced map | Heatmaps, styles, selection, time | Aggregates, spatial filters | Medium |
| 8 | Accounts | Profile, saved, submit, admin | Auth, roles, review, audit | Medium |
| 9 | Launch | Responsive, accessibility, tests | Hosting, backups, security, legal | Medium, then Critical |

Phases 5 and 6 can run in parallel with each other, and phase 6 does not depend on any frontend work.
