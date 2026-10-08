# ecoSight — Final Plan

Updated Oct 8, 2026

What has been built, and everything still to build for the frontend and the backend, in the order it should be done. `frontend_plan.md` has the interface specification for the map app, the landing page and the graph explorer. `plan.md` keeps the original proposal-derived plan and its risk list.

Urgency:

- **Critical** — blocks other work, or blocks showing the product to anyone.
- **High** — needed for the first credible demo.
- **Medium** — needed for launch.
- **Low** — after launch, or only if time allows.

## 1. What is built

The code is public at <https://github.com/mindscope-world/ecosight>; the data is not in it. The repository's history was rewritten on Oct 7, 2026 to remove the curated data, so earlier commit ids no longer exist. `main` holds everything: the `beyond-kenya` and `map-polish-and-e2e` branches were merged into it on Oct 8, 2026.

Checks pass: 135 TypeScript tests, 105 Python tests, 38 end-to-end browser tests, typecheck, build, and first-load JavaScript of 124 KB for the landing page and 369 KB for the map app, each against a 600 KB budget. CI runs them on every pull request.

### Data

| | Count |
|---|---|
| Organisations published | 332 |
| Organisations on the map | 323, in 33 countries |
| Startups | 151, in 18 countries |
| Investors, accelerators, hubs and funders | 87 published |
| Universities | 35 |
| Public bodies | 29 |
| NGOs | 14 |
| Funding rounds | 95, for 67 organisations. 17 have no date (4.11) |
| Investor-to-company links | 64 |
| People named as founders | 251, of whom 72 have a LinkedIn profile link (4.13) |
| Organisations with a logo | 190 of the 261 published with a website (4.9) |
| Published organisations with no office | 9, all investors whose head office could not be settled (4.3). The hosted database has 5 more: startups a reviewer approved that have no public address |
| Waiting in the review queue | 61 locally: 53 draft organisations and 8 proposed relationships. On the hosted database, where the owner has been through the queue, 5 |
| Events | 0 |

- **Startups dataset** (`datasets/nairobi-startups-2026-10-06/`): 100 rows; the 69 marked verified are published, 31 are drafts.
- **Funding rounds** (`curation/nairobi_startups_funding_rounds.json`): read by hand from the startups dataset's funding notes, each with the words it was read from, plus 16 items deliberately not recorded as rounds.
- **Investors dataset** (`datasets/nairobi-investors-2026-10-07/`): 25 rows; 23 published, 2 drafts. Five were merged into investors already known from funding rounds.
- **East Africa dataset** (`datasets/east-africa-2026-10-07/`): 100 universities, public bodies, NGOs and innovation hubs in nine countries; 96 published, 4 drafts. Five were merged into organisations already on record. Each row's type, city, country code and sector tags were set by hand in `curation/east_africa_100_organizations.mapping.json`. 68 are placed on a building or street, 32 at their city's centre.
- **Health technology dataset** (`datasets/africa-health-sources-2026-10-07/`): 100 health technology organisations in 17 African countries, loaded on Oct 7, 2026, locally and on the hosted database. 84 published, 16 drafts: fourteen whose status the research calls unclear, one that ceased operating and one that is winding down. None was already on record. The dataset cites its sources by ID and lists the links in a file of their own, which the importer now reads. Each row's type, place, sector tags, confidence and address level were set by hand in `curation/African_Healthtech_100.mapping.json`. Of the published, 4 are placed at an address, 44 on a street or area and 36 at their city's centre.
- **Its funding rounds** (`curation/African_Healthtech_100_funding_rounds.json`): 59 rounds for 42 organisations, read by hand from the dataset's two funding columns, plus 22 items deliberately not recorded. 34 are dated. They name 22 investors, 19 of them new to the record and none yet placed.
- **Relationships stated in the health technology dataset** (`curation/African_Healthtech_100_relationships.csv`): 24 ties read by hand from its notes on Oct 8, 2026, each with the words it rests on and a source from the dataset's register. 19 are published. The other 5 name something that is not on record and wait in the review queue.
- **Organisations named in those relationships** (`datasets/relationship-organisations-2026-10-08/`): 16 parents, hosts, funders and programme runners that were not on record, such as Right to Care, Safaricom, Norad, Orange Ventures and the Stop TB Partnership. Each was looked up by web search and carries the page its head office was taken from, the organisation's own site for eleven. Type and sector tags are the curator's, set in `curation/organisations_named_in_relationships.mapping.json`. All are placed at city level. Five more were left out: no head office could be confirmed for Capsule Global and AXA Assurance Maroc, and the Digital Africa Bridge Fund, Google for Startups and the NCAIR–Google AI Fund are programmes, not organisations.
- **Stated relationships** (`curation/stated_relationships.csv`): 19 ties read by hand from the two datasets' own text, each with the words it rests on. 16 are published; 3 name an organisation that is not on record and wait in the review queue.
- **Investors abroad** (`curation/investor_headquarters.json`): 40 placed at their headquarters city, all looked up or checked by web search on Oct 8, 2026. 19 cite the organisation's own site, 16 a directory or news page, and 5 are still from the curator's general knowledge with no page. Renew Capital was moved from Addis Ababa to Denver, where its own site says its head office is. 9 are listed as not placed, each with the reason.
- **The data is private.** Datasets and the curated files are kept out of git and were purged from the repository's history on Oct 7, 2026. `datasets/README.md` indexes them. The synthetic sample lives only in the test database.

### Database (Postgres, PostGIS, pgvector, pg_trgm; sixteen migrations)

Organisations with eleven entity types, other names they go by, founded year, active status and funding note; offices at address, area or city precision in any country; funding rounds with date precision; round investors; programs; events; people in roles, each with a LinkedIn profile link where one was found published and the page it was found on; a small stored logo per organisation; relationships a reviewer has taken down for everyone, which the graph and the cards leave out while the records behind them stay; per-field sources with their stated basis; review queue; audit log; submissions; claims; private fund tables under row-level security; a view of per-organisation funding facts; full-text search; a rule that keeps angels at city level.

### API (Fastify)

Office and event layers; organisation detail with funding, connections, founders' profile links and the organisation's logo as an image the API itself supplies; a list of organisations as rows, with the dates the dashboard narrows by; event and round detail; search grouped into organisations, people, events, cities and sectors, which reads type, sector and city words; stats with period comparison, city scores, funding by month and a recent feed. Graph queries over the same records: neighbourhood, expand, shortest path, co-investment and most connected. Layers and stats accept the same filters as share links. Rate limits, a setting for which sites may call it, a container definition, and a job that writes the map's data as static files.

### Web (React, Tailwind, MapLibre)

Five pages.

**Landing page** at `/`. Hero over a live world map with figures from the product's own records, audience bar, the problem as a table beside the same records on a street map of their city, layer cards beside a map that shows one layer at a time, an explore preview from the world down to Nairobi, three use cases each with a map of its own, the relationship chain, example signals marked as demo data, a globe with connections, closing call to action and footer. Every visual on the page is a real map of the product's records, which can be dragged and zoomed; where the records cannot be loaded the maps show illustrative points and say so. The five that were static drawings were replaced on Oct 7, 2026.

**Map app** at `/map/`. Top navigation with six lenses; navy map with a marker shape per entity type; clustering that lists records sharing one spot; floating layer control; four heatmaps (funding, and startup, investor and accelerator density, each in its own colour); dark, light and terrain styles; collapsible intelligence panels that follow the filters; entity details with the organisation's logo or its initials, funding, sources, founders' names linked to their LinkedIn profiles where found, and one-click graph navigation; a white ring and a pulse round the selected record's marker; a small card with a record's kind, place and one figure while the pointer rests on its marker; beside each connection of the selected record a button that hides or shows the line to it, and one for all its lines; overview and activity figures that each lead to the rows they count on the dashboard; search command palette; filter drawer with ten kinds of filter; status bar; share links; bottom sheets on small screens.

**Graph page** at `/graph/`. Opens on the whole network of investments, programmes and organised events; any organisation can be made the starting point. Nodes use the map's shapes and colours and links are styled by kind. Click for details, double-click or a button to bring in a node's other connections, click a link for the rounds behind it. Six kinds of link can be switched on and off, with people, places and sectors off to begin with. Every line in view is listed with a tick that hides it or shows it again, and a record's details can hide all of its lines at once; hidden lines stay as faint dotted lines and are carried in the share link, and the records are not changed. A path finder, co-investor and shared-investor lists, a list of everything in view, and share links that restore the graph. Reached from "View connections" in the map's details panel, and leads back with "Show on map".

**Dashboard** at `/dashboard/`. One tab per kind of organisation: startups, investors, accelerators, NGOs, innovation hubs, universities, government and corporates. Each has headline figures, bar charts (by country and sector; by stage and most raised for startups; largest portfolios for investors) and a table that sorts, searches, narrows by country and pages. A row opens the record's details with links to the map and the graph. A "Not on the map" button on a tab lists only its organisations with no office on record, with their number; on the Investors tab these are the investors the map cannot draw. The list has its own address (`#v=1&t=investors&u=1`). The map's activity figures link to narrower lists the same way (`&w=added`, `rounds`, `active`, `programs`): startups added and rounds announced in the last 30 days, investors active in the last 12 months, programmes added. Each list shows a chip that removes it, and an empty one offers every row, so no link is a dead end.

**Review queue** at `/review/`, for reviewers. What the importers held back, with the reason for each; approve, reject with a note, or reopen. A tab lists the relationships taken down from the graph page, each with its reason, and puts one back. On the graph page a reviewer sees "Remove for everyone" in a link's details, which asks for a reason. The header of every page has an account menu: sign in by emailed link, see who is signed in, sign out.

### Pipeline (Python)

- `atlas convert-rounds`: US dollar figures for rounds reported in another currency, at published reference rates, with the basis recorded.
- `atlas import-links`: relationships between organisations from a CSV, published only when both organisations are on record and the row has a source; the rest go to the review queue.
- `atlas import-orgs`: dataset importer with a dry-run report, column mappings for other datasets, cached geocoding that refuses lookalike matches, merging into records already on file, values a curator sets for one row, address lookup in any city, and sources cited by ID read from a dataset's source register.
- `atlas import-rounds`: loads curated rounds and refuses any whose quote is not in the stored note. A date may also be read from the address of the round's source, when that source is on record and its address carries the date it was published. The note is both funding cells of the row, the level and the details; a round whose amount is in one and date in the other carries a second quote for the date.
- `atlas import-locations`: places organisations that have no office at a named city.
- `atlas find-profiles`: finds people's LinkedIn profile links without visiting LinkedIn, whose terms forbid automated collection. It reads links already published elsewhere: the organisation's sources on record, its own team and about pages (`--web`, within robots.txt), and a web search through SerpAPI on Google and then DuckDuckGo (`--search`, which needs `SERPAPI_API_KEY`). A link is kept only when its address carries the person's first and last name and it is the only match; a search result must also name the organisation. Search answers are cached, and a run stops at a set number of requests because the free plan allows 250 a month.
- `atlas fetch-logos`: fetches each organisation's logo from its own website, the icon the site declares for itself, within robots.txt, and stores it (up to 64 KB) so the app never loads it from another site.
- `atlas crawl`: raw document store and two RSS crawlers (TechCabal, Disrupt Africa).
- `atlas extract` and `atlas eval`: extraction with a rule-based baseline and a Groq model through LangChain, and an accuracy harness.

### Deployment

Online since Oct 7, 2026, on free tiers, and private: the landing page at <https://mindscope-world.github.io/ecosight/> and the map app under `/map/`, which opens only with the access key in `.env`. The database is on Supabase with all the data loaded and its public REST interface closed. The API runs as a Supabase Edge Function. The web app is on GitHub Pages and holds code only. `docs/deploy.md` has the commands. Deploying is done by hand. The API connects through Supabase's transaction pooler and gives back idle connections: on the session pooler a few page loads used up its 15 places and the API answered 500 (fixed Oct 7, 2026). Every page checks which build is live when it opens and when its tab is returned to, and reloads itself once if it has been replaced, so a cached page does not outlive a deployment.

### Decisions taken

Build clean, no fork. React and Tailwind for the interface, vanilla TypeScript for the map engine. Fastify kept, not FastAPI. UI named ecoSight; internal package names unchanged. Dark theme only, with light as a map style. Free components throughout, with no paid hosting until there is revenue (`docs/adr/0002-zero-cost-stack.md`). Postgres is the system of record; Memgraph is deferred (`docs/adr/0003-graph-engine.md`). The data may not be published: a deployed copy opens only with an access key. Only verified rows are published. Funding is recorded by a person reading the notes, not by rules. Only people named as founders are loaded. Emails and phone numbers are not loaded. A person's LinkedIn profile is linked only where the link is already published and plainly theirs; LinkedIn itself is never scraped. Logos are kept in the database and served by the API, not loaded from other sites, so no outside service learns which records are opened.

## 2. What is left, in order

### Step 1 — Owner checks (Critical)

No code. These make what exists trustworthy, and 1.1 blocks any public deployment.

| # | Item | Notes |
|---|------|-------|
| 1.1 | ~~Confirm whether the data may be published~~ | **Decided: it may not.** The datasets and everything curated from them are out of git and purged from the repository's history. A deployed API requires an access key, and the map data is never put on a public host as files. See 1.9 for what is left of the purge |
| 1.2 | Check the investors placed abroad | `curation/investor_headquarters.json`: 17 placements from general knowledge, and 13 not placed that the owner may know |
| 1.3 | Check the 36 curated Nairobi rounds | Investor types are the curator's classification; a bare "$" is read as US dollars; one round is dated by its announcement, not its close; one round counts equity and debt together |
| 1.4 | Check the investors import | One investor in the dataset is treated as the same organisation as a differently named investor in a funding round; two rows are held as drafts. Both judgments are in the mapping file under `curation/` |
| 1.5 | Review the 53 drafts | 16 are from the health technology dataset. In particular the 6 startups marked inactive or unclear, and the 4 East African bodies held back: two replaced by successor agencies, one the research calls historical, one whose status is unclear |
| 1.5b | Check the East Africa import | `curation/east_africa_100_organizations.mapping.json`: the type and sector tags given to each of the 100 rows are the curator's reading of the dataset's descriptions. Leadership was loaded only where a person is named as a founder (11 people at 6 organisations) |
| 1.5f | Check the health technology import | `curation/African_Healthtech_100.mapping.json` and `curation/African_Healthtech_100_funding_rounds.json`. Judgments to confirm: which 16 rows are held as drafts; Baobab Circle placed in Nairobi and RxAll in New Haven in the United States, where their offices are, not in the market the dataset files them under; confidence read from the word each cell opens with, "Medium-High" as medium; three organisations typed as NGOs and the rest as startups; founders restated by hand for ten rows; investor types in the rounds file; a Series D, an angel round and unlabelled investments recorded with no stage |
| 1.5c | Check the stated relationships | `curation/stated_relationships.csv`: 16 ties published from the datasets' own wording. Judgments to confirm: a campus inside an innovation district is recorded as "hosted by" it; a startup with an office in a hub's building as "hosted by" the hub; a portfolio listing with no round as "backed by". Three rows wait in the queue because the other organisation is not on record |
| 1.5d | Settle the review queue | 53 draft organisations and 3 proposed relationships are waiting at `/review/`. Sign in with the owner's address, which is on the list as admin |
| 1.5e | Set up a mail service for sign-in | Until then Supabase emails sign-in links only to the project's own members, a couple an hour. Needed before anyone else is given an account |
| 1.6 | ~~Merge the open branches~~ | Done Oct 8, 2026: `beyond-kenya` and `map-polish-and-e2e` are in `main` |
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
| 2.5 | Turn on the uptime check | Owner | The branches are merged, so the workflow on `main` no longer looks for static map data. What is left is to set the site and API addresses as repository variables (`WEB_URL`, `API_URL`) |
| 2.6 | Error reporting | Owner + backend | Needs an account with a reporting service |
| 2.7 | Contact address for the crawler and geocoder | Owner | Required by the services' usage policies before regular use |
| 2.8 | ~~Replace the Supabase access token~~ | Done | The owner replaced it on Oct 8, 2026; the new one in `.env` was checked against the hosted database's migration record. It is needed only for migrations and deploys |
| 2.9 | Keep the free database awake | Backend | Supabase pauses a free project after a week idle. The uptime check does not reach the database yet |
| 2.10 | Deploy from CI | Backend | By hand today. Needs the access token and access key as repository secrets |
| 2.11 | ~~Pages that update themselves after a deploy~~ | Done | Each build names itself in `version.json`; an open or cached page reloads once when a newer build is live |

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
| 3.8c | Relationship data | Data | **The graph is still thin**, though less so: 64 investment links, 3 programme places and 13 other ties (part of, hosted by, member of, founded by, backed by), on 79 organisations. Most of the East African institutions still have no links. The health technology dataset's funding and founder notes name programmes, hosts and parent organisations that have not been read into a relationships file yet (4.12). Needs relationship datasets from the owner: programme cohorts, partnerships, grants. The file format is in `datasets/README.md` |
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
| 4.2 | ~~Startups outside Kenya~~ | Done for health | The health technology dataset put 84 published organisations in 17 countries on the map. Other sectors outside Kenya still have no dataset |
| 4.3 | Place the investors with no office, and source the ones placed | Data | **Mostly done, Oct 8, 2026.** 23 of the 32 organisations with no office were given a city, looked up by web search, each with the page it was taken from and a statement of basis (`curation/investor_headquarters.json`, loaded with `atlas import-locations`, which now stores that page as the placement's source). A fund with no office of its own is placed at its manager's or parent's head office and says so. **Not placed, 9:** the sources disagree or give no city for 3IF Ventures, Afrishela, DFS Lab, the Egyptian-American Enterprise Fund, FP Capital, Madiro and Waarde Capital; Bolt by QED Investors and the Google Africa Investment Fund are programmes with no head office. The owner may know these. **Still to do:** 19 of the 40 placements now cite the organisation's own site; the other 21 rest on a directory page or on memory and still need one. On the hosted database 5 startups a reviewer approved (AutoVest AI, MPost Pay, Peton Labs, Workpay Wallet, Ziada Credit Solutions) have no office because the research found no public address; they need one before the map can draw them |
| 4.4 | ~~Keep city-level records out of the density layers~~ | Done | The four heatmaps count only records whose position means something; the layer list says so |
| 4.5 | ~~Street-level address lookup outside Nairobi~~ | Done | An address is looked up within about 30 km of its city's centre, with the same refusal of lookalike matches. A university or public body whose address is not found is placed where the map names it. Otherwise the city's centre |
| 4.6 | ~~Per-country summary~~ | Done | A "By country" tab on the dashboard: one row per country with organisations, cities, each kind, rounds and money raised, counted where each organisation is based, with bars for organisations and money by country. A country's name opens the map filtered to it. Worked out in the browser from the rows the dashboard already loads |
| 4.7 | ~~Currency conversion~~ | Done | `atlas convert-rounds` gives rounds in another currency a US dollar figure at the European Central Bank reference rate (through the free Frankfurter service): the day's rate for a round dated to a day, the period's average for one dated to a month or year. The original amount is kept and the rate and its basis are stored with the round. The one Canadian-dollar round is converted. **Limits:** currencies the ECB does not publish, the Kenyan shilling and the Nigerian naira among them, are left unconverted, as is any round with no date; and `import-rounds` rebuilds rounds, so run `convert-rounds` after it |
| 4.8 | Founded year | Data | The filter and the card support it; no dataset has the column |
| 4.9 | Business contacts and logos | Owner + backend | **Logos: built.** (A second fetch on Oct 8 found none of the 71 missing.) A card shows the organisation's logo, or its initials where none is held (migration 0014, `atlas fetch-logos`). Fetched Oct 8, 2026: 190 of the 261 published organisations with a website have a logo. An icon over the 64 KB kept is drawn smaller and stored as a PNG. Of the 71 without, 40 sites could not be reached, 28 declare no usable icon, 2 forbid it in robots.txt and 1 has an icon that could not be redrawn. Many sites offer only a small favicon, which looks soft at card size; an organisation with no website has no logo. **Still to decide:** whether public business emails and phones are stored and shown |
| 4.11 | Dates for undated rounds | Data | **Partly done, Oct 8, 2026.** 11 rounds were dated from the address of their source in the dataset's register, a news report's publication date or a grant listing's month, which the loader now accepts and checks. 17 remain undated: their sources' addresses carry no date, and the notes give none. Dating those means reading the sources themselves, and a way to record a date that rests on a page and not on the dataset's words |
| 4.12 | ~~Relationships from the health technology dataset~~ | Done Oct 8, 2026 | 24 ties read; 19 published after the 16 organisations they name were put on record, which took the graph from 82 to 99 links between organisations. 5 wait in the review queue: the reviewer can say which record each means, or leave it. **To check (owner):** the 16 organisations' types and sectors, and the five left out |
| 4.13 | LinkedIn profiles for the remaining founders | Data | 72 of 251 have a link: 17 from sources on record, 23 from organisations' own sites, 20 from a Google search through SerpAPI and 12 from DuckDuckGo through the same service. Google found a profile for about one founder in ten; DuckDuckGo, tried on the last 34 searches of the month's allowance, found one in three. The other 179 should be tried on DuckDuckGo (`--engine duckduckgo`) when the allowance renews; the saved answers mean nothing is asked twice. Nothing is guessed: a founder with no plain match stays unlinked |
| 4.10 | Partners and directors of investors | Owner | The investors dataset lists them; only founders are loaded today |

### Step 5 — Review and accounts (Medium, High for 5.1 and 5.2)

The drafts, and the output of the pipeline and the importers, are approved on the review page.

| # | Item | Track | Notes |
|---|------|-------|-------|
| 5.1 | Sign-in and roles | Backend | **Magic link: done.** Sign-in by emailed link through Supabase, with no library: the session is kept in the browser and sent with each request, and the API checks it with the project. Signing in proves an address; the `app_user` table (migration 0010, kept with `pnpm users`) says whether it is let in and as viewer, reviewer or admin. The shared access key still opens the app for reading. Proved on the live API with a temporary account in each role. **Not done:** Google and LinkedIn, which need OAuth apps only the owner can create; and a mail service, without which Supabase emails only the project's own members |
| 5.2 | Review queue screen | Both | **Approve, reject, archive and reopen: done.** `/review/`, for reviewers only. Draft organisations and proposed relationships are listed with why each was held. Approving publishes; rejecting keeps it out, with a note; archiving sets aside what is incomplete or unverified, in a list of its own, until more is known. Any of the three can be reopened. For a relationship naming an organisation that is not on record, the reviewer chooses the record it means. Every decision is recorded with who made it and written to the audit log, and reloading a dataset keeps it. **Also done, Oct 8, 2026:** a reviewer can take any published relationship between two organisations down for everyone, with a reason, and put it back (migration 0015; every such act is in the audit log). **Not done:** editing a record's fields, merging duplicates, and reopening an approved relationship. An investor's portfolio, led rounds and last investment are counted without what has been taken down (migration 0016) |
| 5.3 | ~~Profile menu, saved locations, notifications~~ | Done | The header's three icons work on every page. **Account:** sign in, who is signed in, sign out. **Saved views:** the page as it stands, under a name, to open again; kept with the account (migration 0012), or in the browser for someone who came in with the access key. **What is new:** what has been published since the reader last opened the list, and for reviewers how many items are waiting. Not built: notifications by email, and alerts on a saved view |
| 5.4 | Submit an organisation or event; claim a profile by work email | Both | Tables exist |
| 5.5 | Takedown and opt-out handling | Both | People named as founders must be able to ask for removal. More pressing now that names link to LinkedIn profiles: a person who has opted out is never looked up, but there is no way to ask yet |
| 5.6 | Sign in and sign up from the landing page | Frontend | **Sign in: done.** The landing page's "Sign in" opens the map with the sign-in form showing. **Sign up** is not open: an address is let in only when it is on the list, so "Join the ecosystem" still opens the repository. That changes with 5.4 |

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
| 8.1 | End-to-end tests for the core loop | Frontend | **Mostly done.** 38 browser tests run in CI on the five pages: loading and counts, search, following connections, filters, share links, minimising panels, the phone layout, and the landing page with and without the API. What the map draws is covered too: four tests answer the basemap with an empty style of their own and ask the map what it has drawn (markers and clusters, the ring round the selected record, the hover card, the lines and hiding them, the landing page's maps). Not covered: the heatmaps, and how any of it looks |
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

Step 2 is done apart from small follow-ups. The graph API, the graph page and the dashboard are built and deployed (3.5 to 3.8b); the relationship importer is built and the first ties are loaded (3.9). What comes next: the DuckDuckGo search for the remaining founders when the allowance renews (4.13); a page from its own site for the 21 investor placements that still rest on a directory or on memory (4.3); and, the largest step not started, running the news extractor and sending its results to the review queue (step 6). The graph still needs more relationship data from the owner (3.8c). Step 6 does not depend on any frontend work. Step 8.7 has the longest lead time and should start during step 2.

## 4. Waiting on the owner

These block other items and cannot be done from the code:

1. ~~Revoke the Supabase access token and put a new one in `.env` (2.8).~~ Done.
2. Decide who gets the access key. The branches are merged (1.6), so the uptime check can now be turned on: set the site and API addresses as repository variables (2.5).
3. What to do about the old commits GitHub still holds (1.9): ask GitHub Support to remove them, or delete and recreate the repository.
4. Checks of the investors placed abroad, the rounds, the investors import and the drafts (1.2 to 1.5).
5. For the graph: whether pitch decks may be used and sent to a hosted model, whether founders' universities are recorded, and which external APIs and databases to connect (3.9, 3.10, 3.12).
5b. Check the founder profile links and the logos once loaded: both are found by rule, not by a person (4.9, 4.13).
6. An events source, and datasets of startups outside Kenya in sectors other than health (4.1, 4.2). Also checks of the health technology import and its rounds (1.5f), and the cities of the 32 organisations with no office where the owner knows them (4.3).
7. ~~A Groq API key in `.env`~~ Supplied; the extractor has not been run with it yet (6.1).
8. A contact address for the crawler and geocoder (2.7).
9. Whether to store and show business emails and phones, and investors' partners (4.9, 4.10).
10. The reference screenshot inside the repo (1.8).

## 5. Sending more data

The importer reads a CSV; a mapping file handles different column headings. Most useful now:

| Data | Why |
|------|-----|
| Events: name, venue, city, start and end, link | The Events layer is empty |
| Startups in other cities, with `City` and `Country` | Outside Nairobi only health technology startups are on record |
| Cities and sourced addresses for investors | 9 have no office and are not on the map; 17 are placed from general knowledge and 23 from directory pages |
| Relationships: who invested in whom, who went through which programme, with dates | These are the links the graph is made of; only 64 investment links exist today |
| Founded year | The filter and the card are ready for it |
| Latitude and longitude, where known | Places a record exactly, in any country |

Three rules stay in force: individual angels are placed at city level only, people appear only as a role at an organisation, and data whose terms forbid publishing is not displayed.
