# Capital Atlas — Implementation Plan

Oct 6, 2026 · derived from the Technical Proposal (@Kakumi)

> **Status, Oct 6, 2026.** The fork audit is done and the answer is no-go on a wholesale fork (risk R3): upstream is about 195,000 lines with 215 Cesium-coupled modules. The web app is a clean MapLibre build that reuses upstream's patterns. See `docs/fork-audit.md`. The buildable parts of sprints 1 and 2 are done across all three tracks, with some sprint 3 to 5 map work pulled forward. Every component uses a free tier or a free self-run option, see `docs/adr/0002-zero-cost-stack.md`. Section 8 lists what is done and what is pending.

This plan turns the technical proposal into an ordered build: what to resolve first, how the repo is laid out, what ships in each sprint, and how we know each piece is done. Scope is the MVP (Nairobi, four views, 21 weeks). Phase 2 and 3 items (watchlists, alerts, voice, paid API) are out of scope except where the MVP must leave room for them.

## 1. Before any code: things to resolve

These block or reshape the work below. The first three are needed in week 1.

| # | Item | Why it matters | Proposed answer |
|---|------|----------------|-----------------|
| 1 | Fork God's Eye View or build clean | **Resolved: build clean.** Audited at commit `9542a5e`. The proposal's module table no longer matches the code, and the layer contract takes a Cesium viewer. | Clean MapLibre app; port small Cesium-free pieces (coordinate parser, Nominatim client) with attribution when search is built. |
| 2 | Supabase vs RDS + Clerk | Decides auth, RLS shape, local dev setup. | Supabase (proposal's leaning). Plan below assumes it. |
| 3 | React for non-map screens | Decides app structure. | React for accounts and admin; map code stays vanilla TS. |
| 4 | How filtered clusters work on public layers | **Resolved: GeoJSON per layer, clustered in the browser.** See risk R1 and ADR 0002. Pre-clustered PMTiles cannot recount under client-side filters, and MapLibre only clusters GeoJSON sources. | Static GeoJSON per layer at MVP scale. The basemap is OpenFreeMap's free hosted style. Revisit PMTiles or Martin once a layer passes ~50k points. |
| 5 | Private tiles and row-level security | **Resolved and built.** See risk R2. A tile server connects as one database role, so RLS does not apply per fund by default. | Private rows go through the API, which switches to the `atlas_app` role and sets the fund on the transaction (`withFund` in `apps/api/src/db.ts`). Tested in CI. |
| 6 | Keep Cesium 3D in MVP | Costs front-end time in a 1-engineer track, and with no fork there is no globe code to reuse. | Recommend dropping 3D from the MVP. If kept, it is built last (sprint 9) behind the map adapter and cut first if the schedule slips. |
| 7 | Data residency, ODPC registration | Legal lead time. | Start legal advice in week 1; region must be fixed before production data is loaded (sprint 8). |
| 8 | LLM provider, licensed data | Per proposal, decided in month 2 on the labelled set. | Extraction is provider-agnostic: a free rule-based baseline and a LangChain chat model, defaulting to Groq's free tier. |

## 2. Repository layout

One monorepo, pnpm workspaces for TypeScript, uv for Python.

```
capital-atlas/
  apps/
    web/            Vite app: map code (vanilla TS, MapLibre) + React account/admin screens
    api/            Fastify + TypeScript, OpenAPI generated from route schemas
  workers/          Python pipeline: ingest, extract, match, geocode, score, publish, tile build
  packages/
    schema/         Shared types generated from OpenAPI; filter and URL-state definitions
  db/
    migrations/     SQL migrations (PostGIS, pgvector, pg_trgm), RLS policies
    seed/           Sample Nairobi dataset for local and test
  infra/            Terraform / platform config, Docker Compose for local
  eval/             200 hand-labelled announcements and the accuracy harness
  docs/             ADRs, fork audit, runbooks
  NOTICE            Upstream MIT copyright notice (added with the first ported file)
```

`NOTICE` is created when the first ported file lands, not before. `data/` (git-ignored) holds the local raw document store.

Conventions: TypeScript strict; H3 cells are computed in the Python workers, since Supabase does not offer the h3 extension; SQL migrations are forward-only; every decision in section 1 gets a one-page ADR in `docs/`.

## 3. Data model (first migration)

Core tables, all with `created_at`, `updated_at`:

- `organisation` — id, name, slug, `types` (array: startup, fund, angel_network, ngo, accelerator, corporate), sectors, stage, website_domain, description, name embedding (pgvector), claimed_by, status (draft, published, removed)
- `office` — organisation_id, is_hq, address, city, country, `geom` (geography point), precision (address, city), valid_from, valid_to
- `funding_round` — organisation_id, stage, amount_original, currency, amount_usd, fx_rate, announced_on, valid_from
- `round_investor` — round_id, investor organisation_id, is_lead
- `program` — accelerator organisation_id, name, valid_from, valid_to; `program_participant` links startups
- `event` — name, organiser organisation_id, venue, geom, starts_at, ends_at, url
- `person_role` — organisation_id, name, role, opted_out (people appear only in a role)
- `field_source` — record type and id, field name, source_url, method (manual, partner, ai), quote, confidence, verified_at
- `raw_document` — url, fetched_at, content hash, storage key
- `submission`, `claim`, `review_item` — the single queue everything passes through
- `audit_log` — actor, record, field, previous value, new value, at
- `fund_private_*` — private portfolio and pipeline rows, RLS keyed to fund_id (schema only at MVP; the paid seat ships later but the isolation is designed now)
- `hex_aggregate` — h3 cell, resolution, layer, counts and totals, built nightly

Angels are stored with `precision = city` and the geometry snapped to the city centroid at write time, so an address can never leak through a tile. A database trigger enforces this, using centroids from a `city` table; a city-precision office in a city with no centroid is refused.

## 4. Sprint plan

Eleven sprints: ten of 2 weeks, plus a final launch week. Three tracks run in parallel, one per engineer. Data seeding by the researchers runs throughout.

| Sprint | Weeks | Front end and map | API and platform | Data pipeline |
|--------|-------|-------------------|------------------|---------------|
| 1 | 1–2 | Fork audit (done: no-go); clean Vite + TS + MapLibre app with the layer interface and map adapter | Monorepo, CI, Docker Compose, Supabase project, first migration, seed script | Raw document store; first 2 crawlers; labelled set started (50 of 200) |
| 2 | 3–4 | MapLibre 2D with the OpenFreeMap basemap; layer interface defined; clustering decided (item 4) | Fastify skeleton, OpenAPI, `/orgs/{id}`, `/events/{id}`, `/rounds/{id}` on seed data | Extraction schema and prompt v1; eval harness reporting per-field accuracy |
| 3 | 5–6 | Startups and offices layers; detail card; layer panel restyled. **First demo, week 6** | `/search` (full-text + trigram); public layer build job to CDN | Match and dedupe (domain, trigram, embeddings); geocoding through public Nominatim with a cache |
| 4 | 7–8 | Investors, NGOs, accelerators, events layers; filters combining across layers | Filter parsing shared with the web app through `packages/schema`; rate limits | Confidence scoring; review-queue writes; labelled set complete (200); provider chosen |
| 5 | 9–10 | Share links with filters and time range; search with fly-to; HQ-to-branch lines on select | Auth (magic link, Google, LinkedIn); roles; audit log | Daily scheduler; remaining crawlers; partner CSV import |
| 6 | 11–12 | React shell: sign up, submit organisation and event | `POST /submissions`, `POST /claims` (work-email domain check) | Run-health alerts (failed run, 20% record drop); FX conversion for rounds |
| 7 | 13–14 | Claim and edit-profile flow; admin review queue UI | `/admin/*`: approve, reject, merge duplicates, edit; RLS policies and tests | Publish step: approved records live on cards at once, tile rebuild within minutes for urgent fixes |
| 8 | 15–16 | Time slider and deal-flow replay; sortable list view beside the map | `/aggregates/hex`; staging hardened; production environment created in the chosen region | Nightly H3 aggregates; stale-record flagging (12 months) |
| 9 | 17–18 | Heatmap and gaps views; service worker caching; Cesium opt-in via adapter (cut line) | Backups with point-in-time recovery, first restore test; uptime checks; Sentry | Weekly 50-record audit tooling; takedown and opt-out handling |
| 10 | 19–20 | Performance pass on a real mid-range Android over throttled 4G; accessibility pass | Security review, load test, privacy pages, takedown form | Full Nairobi backfill and review-queue burn-down |
| 11 | 21 | Launch fixes only | Production cutover, monitoring watch | Coverage sign-off against launch targets |

### Milestones and exit criteria

- **M0, end of week 2 — Foundations.** The clean app builds and shows seeded data on the map; `docs/fork-audit.md` records the fork decision and what is reused; `pnpm db:up` gives a seeded database; CI runs typecheck, tests, build and the bundle budget.
- **M1, end of week 6 — Clickable Nairobi.** Startups and offices on a 2D map from real seeded data, cards with sources and verified date, deployed to staging. First founder and investor demo.
- **M2, end of week 10 — Four views.** All layers, cross-layer filters, search, share links. Pipeline runs daily end to end into the review queue. Extraction accuracy is measured on the full labelled set.
- **M3, end of week 14 — Contribution loop.** A member can sign up, submit, claim and edit; a reviewer can approve, reject and merge; every change is in the audit log; RLS tests prove one fund cannot read another's rows.
- **M4, end of week 18 — Feature complete.** Time slider, heatmap and gaps, list view, offline caching, 3D if it survived the cut line.
- **M5, end of week 21 — Launch.** All non-functional targets met (section 6), data coverage targets met, restore tested, legal items closed.

## 5. Key design points to settle early

**Layer interface (sprint 2).** Every view implements `load(filters)`, `render(map)`, `onSelect(feature)`, `toUrl()`, `fromUrl()` against a small `MapAdapter` (add source, add layer, set filter, fly to, on click). Only the MapLibre adapter is written until sprint 9. Layers must not call MapLibre directly, which is what keeps the Cesium adapter a contained piece of work.

**URL state (sprint 2, used from sprint 5).** One versioned schema in `packages/schema` for camera, layers, filters, time range and selection, shared by the share-link code and the API's filter parsing so the two cannot drift.

**One path for all records (sprint 4).** Crawled, partner and user-submitted data all become `review_item` rows with per-field source and confidence. Auto-approval is a rule over that queue, never a separate write path. Rounds above USD 1m always go to a person.

**Provider-agnostic extraction (sprint 2).** `extract(document) -> ExtractionResult` behind one interface with a fixed JSON schema and a quote per value. The eval harness runs on every prompt or model change and its result is recorded in the PR.

**Performance budget in CI (sprint 1).** The build fails if first-load JavaScript exceeds 600 KB compressed. Cesium and the React admin screens are separate lazy chunks from the first day so the budget is never retrofitted.

## 6. Verification

| Target | How it is checked | From |
|--------|-------------------|------|
| First map under 3 s on mid-range Android, 4G | Lighthouse CI with throttling on every PR; real-device check each release | Sprint 3 |
| Under 600 KB JS before map | Bundle-size check in CI | Sprint 1 |
| Filter change under 300 ms | Playwright timing test on the seeded dataset at 10 times launch scale | Sprint 4 |
| 10 times scale without architecture change | Synthetic dataset generator; tile build and search timed against it | Sprint 8 |
| 99.5% availability | Uptime checks on map, API and CDN | Sprint 9 |
| Extraction accuracy | Eval harness on the 200-item labelled set | Sprint 2 |
| Published error rate | Weekly 50-record audit | Sprint 9 |
| No cross-fund leakage | RLS tests run as two different fund users in CI | Sprint 7 |

Tests by layer: unit tests for layer modules, filters and URL encoding; API tests against the seeded database; Playwright for open map, filter, select pin, share link, submit and claim.

## 7. Risks

| # | Risk | Mitigation |
|---|------|------------|
| R1 | Clustering, client-side date filtering and pre-built PMTiles conflict: cluster counts baked into tiles are wrong once a filter or the time slider is applied. | Sprint 2 spike. At launch scale (10,000 offices) a static GeoJSON per layer with MapLibre's own clustering meets the 300 ms target and recounts correctly. Revisit at 50k points. |
| R2 | A shared database role bypasses per-fund RLS. | **Mitigated.** RLS is forced on `fund_private_*`; the API reaches them only as the `atlas_app` role with the fund set per transaction. A test proves one fund cannot read or write another's rows and that the setting does not outlive its transaction. |
| R3 | **Happened.** The fork is not reusable as assumed. | Clean MapLibre app that borrows the layer and share-link patterns. The proposal's 4 to 6 weeks of saved map work does not materialise; the 2D map basics were rebuilt in sprint 1, so the schedule impact falls mainly on search and on 3D. |
| R4 | One adapter for both MapLibre and Cesium leaks abstractions (clustering, styling and picking differ). | 2D is built first and alone; Cesium supports pins and selection only at MVP; cut line in sprint 9. |
| R5 | Data coverage, not code, decides launch quality. | Coverage targets per layer agreed by week 4 and tracked weekly; researchers seed from week 1; review-queue size is a sprint metric. |
| R6 | Crawling terms and licensed-data terms. | Per-source record of robots and terms in `docs/sources.md`; no licensed data displayed at MVP. |
| R7 | Self-hosted Nominatim is heavy for one city. | Use the public Nominatim service at 1 request per second with cached results (ADR 0002). Self-host a Kenya-only extract only if a backfill outgrows that. |
| R8 | Legal lead time on ODPC registration and residency. | Started week 1; production region blocked on it in sprint 8. |

## 8. Status: done and pending

As of Oct 6, 2026 (sprint 1, week 1). Checked on this date: `pnpm typecheck`, `pnpm test` (19 API tests against the seeded database, 6 schema tests, 2 web tests), `pnpm build`, `pnpm check:bundle` and `uv run pytest` in `workers/` (26 tests) all pass locally. First-load JavaScript is 276.6 KB against the 600 KB budget. The work after the first commit is on the `sprint-2-foundations` branch, not yet committed.

### Done

Decisions (section 1):

- Item 1, fork or build clean: build clean (`docs/fork-audit.md`).
- Item 4, clustering: GeoJSON per layer, clustered in the browser.
- Item 5, private rows and RLS: through the API as a restricted role.
- Cost: every component is free at MVP scale (`docs/adr/0002-zero-cost-stack.md`).

Platform and database:

- Monorepo with pnpm workspaces (`apps/web`, `apps/api`, `packages/schema`, `db`) and a uv project (`workers`).
- CI workflow: database, migrate, seed, typecheck, tests, build, bundle budget, worker tests. Never run, see pending.
- Local Postgres through Docker Compose with PostGIS, pgvector and pg_trgm, on port 5433.
- Migration 0001: `organisation`, `office`, `funding_round`, `round_investor`, `program`, `program_participant`, `event`, `person_role`, `raw_document`, `field_source`, `review_item`, `audit_log`, the `public_office` view.
- Migration 0002: full-text search column, 384-dimension name embedding column, `city` centroids, the angel snapping trigger, `submission`, `claim`, `fund_private_portfolio`, `fund_private_pipeline` with forced RLS, the `atlas_app` role, `hex_aggregate`, the `public_event` view.
- Synthetic Nairobi seed: 48 invented organisations (30 startups, 8 funds, 4 NGOs, 4 accelerators, 2 angel networks), 6 rounds, 6 events.

API (`apps/api`, Fastify):

- `/layers/offices.geojson`, `/layers/events.geojson`, `/orgs/{id}` (with funding rounds), `/events/{id}`, `/rounds/{id}`, `/search` (full-text plus trigram, tolerant of typos), `/stats`, `/health`, `/openapi.json`.
- `withFund` helper for per-fund queries under RLS.

Shared schema (`packages/schema`):

- Versioned share-link state (`v=1`) for camera, layers and a selected organisation or event. Links made before versioning still open.

Web (`apps/web`, Vite, vanilla TypeScript, MapLibre):

- `MapAdapter` and the MapLibre adapter; layers reach the map only through the adapter.
- Six layers with clustering: startups, investors, NGOs, accelerators, angel networks, events.
- Top menu with three screens: Map, Dashboard (totals, organisations by type, top sectors, recent rounds, from `/stats`) and Settings (theme, restore panels). Dashboard and settings load on first use.
- Four minimisable windows docked beside the map: Layers and Overview on the left, Details and Upcoming events on the right. Minimised state is remembered.
- Search box with fly-to; details for organisations (offices, funding, sources, verified date) and events.
- Share links, including the open screen; light and dark themes with matching basemaps; phone layout; a gutter between the map and the right edge.

Data pipeline (`workers`, Python):

- Raw document store: content-addressed files under `data/raw` plus `raw_document` rows; the same content at the same URL is stored once.
- Two feed crawlers, TechCabal and Disrupt Africa: RSS only, robots.txt checked on every run. Run against the live feeds on Oct 6: 20 articles stored, a second run added none. Terms noted in `docs/sources.md`.
- Extraction behind one interface with a fixed schema and a quote per value; any value whose quote is not in the article is dropped. Two providers: a rule-based baseline, and a model on Groq called through LangChain. The Groq path is unit-tested with a stand-in model but has not been run against Groq yet: it needs `GROQ_API_KEY` in `.env`.
- Eval harness reporting per-field accuracy (`uv run atlas eval`), and the labelled-set format (`eval/README.md`).

### Pending in sprint 1 and 2

Needs a person or an account, so not started:

1. Commit the branch and push to a remote. There is still no remote, so CI has never run.
2. Labelled set: 50 of 200 announcements. `eval/labelled.jsonl` does not exist; only four invented examples do. No accuracy figure exists until it does.
3. Real seed data: about 50 Nairobi organisations from the researchers, to replace the synthetic sample.
4. Supabase project (free tier). The migrations use only extensions Supabase offers.
5. Read each publisher's terms of use and record the result in `docs/sources.md` before the crawler runs daily. Set `CRAWLER_USER_AGENT` to a string with a contact address.
6. Open the legal conversation on data residency and ODPC registration.
7. Agree the non-functional targets and the per-layer coverage targets as a team (coverage targets are due by week 4, risk R5).
8. Agree items 2, 3 and 6 in section 1 and ADR 0002, which are still proposals. Items 2, 3, 6 and 7 have no ADR yet.
9. Choose a free host for the API and the daily workers (open question in ADR 0002). M1 needs staging by week 6.

Buildable next:

10. Public layer build job: write the layer GeoJSON to static files for the CDN (sprint 3). Layers are served live by the API with a 60 second cache for now.
11. Layer interface: `load(filters)`, `toUrl()`, `fromUrl()` and cross-layer filters (sprint 4).
12. Pipeline: match and dedupe, geocoding, review-queue writes, confidence scoring (sprints 3 and 4). Extraction results are printed, not yet written to `review_item`.
13. Name embeddings: the column exists, nothing fills it.

### What the first real run showed

Both extractors were run on the 20 crawled articles as a smoke test. This is not an accuracy measurement.

- Three of the 20 reported a funding amount in the headline. The rule-based baseline read the two single-company rounds correctly and skipped the market summary.
- The model run used `gemma3:4b` through Ollama, before the switch to Groq. On this laptop's CPU it took 80 to 160 seconds per article. It found more investors than the rules did, and it wrongly treated the market summary ("58 African tech startups raise $583m") as one company's round.
- The comparison between providers has to wait for the labelled set.

### Remaining sprints

The sprint table in section 4 still stands. What is already done from later sprints:

| Sprint | Already done | Still to do |
|--------|--------------|-------------|
| 3 | Startups and offices layers, detail card, `/search` | Layer panel restyle, public layer build job, match and dedupe, geocoding, staging deploy for the week 6 demo |
| 4 | Investors, NGOs, accelerators and events layers | Cross-layer filters, rate limits, confidence scoring, review-queue writes, labelled set to 200, provider choice |
| 5 | Share links for camera, layers and selection; search with fly-to | Filters and time range in share links, HQ-to-branch lines, auth, roles, audit log writes, scheduler, remaining crawlers, CSV import |
| 7 | RLS policies and the cross-fund test | Everything else in the sprint |
| 6, 8 to 11 | Nothing | Everything as planned |

Verification (section 6): the bundle-size check, the cross-fund RLS test and the eval harness exist. Lighthouse CI, Playwright, the filter timing test, the synthetic 10 times dataset and uptime checks are still to build in their listed sprints.
