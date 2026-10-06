# Capital Atlas — Implementation Plan

Oct 6, 2026 · derived from the Technical Proposal (@Kakumi)

> **Status, Oct 6, 2026.** The fork audit is done and the answer is no-go on a wholesale fork (risk R3): upstream is about 195,000 lines with 215 Cesium-coupled modules. The web app is a clean MapLibre build that reuses upstream's patterns. See `docs/fork-audit.md`. The front-end and API tracks of sprint 1 are built and pass their checks locally, with some sprint 3 to 5 map work pulled forward; the data pipeline track has not started and nothing is committed yet. Section 8 lists what is done and what is pending.

This plan turns the technical proposal into an ordered build: what to resolve first, how the repo is laid out, what ships in each sprint, and how we know each piece is done. Scope is the MVP (Nairobi, four views, 21 weeks). Phase 2 and 3 items (watchlists, alerts, voice, paid API) are out of scope except where the MVP must leave room for them.

## 1. Before any code: things to resolve

These block or reshape the work below. The first three are needed in week 1.

| # | Item | Why it matters | Proposed answer |
|---|------|----------------|-----------------|
| 1 | Fork God's Eye View or build clean | **Resolved: build clean.** Audited at commit `9542a5e`. The proposal's module table no longer matches the code, and the layer contract takes a Cesium viewer. | Clean MapLibre app; port small Cesium-free pieces (coordinate parser, Nominatim client) with attribution when search is built. |
| 2 | Supabase vs RDS + Clerk | Decides auth, RLS shape, local dev setup. | Supabase (proposal's leaning). Plan below assumes it. |
| 3 | React for non-map screens | Decides app structure. | React for accounts and admin; map code stays vanilla TS. |
| 4 | How filtered clusters work on public layers | See risk R1. Pre-clustered PMTiles cannot recount under client-side filters, and MapLibre only clusters GeoJSON sources. | Spike in sprint 2; leaning: static GeoJSON per layer from the CDN at MVP scale, PMTiles for the basemap and for data once a layer passes ~50k points. |
| 5 | Private tiles and row-level security | See risk R2. Martin connects as one database role, so RLS does not apply per fund by default. | Private layers go through the API, which sets the fund claim on the connection before calling a tile function. Martin serves non-private filtered layers only. |
| 6 | Keep Cesium 3D in MVP | Costs front-end time in a 1-engineer track, and with no fork there is no globe code to reuse. | Recommend dropping 3D from the MVP. If kept, it is built last (sprint 9) behind the map adapter and cut first if the schedule slips. |
| 7 | Data residency, ODPC registration | Legal lead time. | Start legal advice in week 1; region must be fixed before production data is loaded (sprint 8). |
| 8 | LLM provider, licensed data | Per proposal, decided in month 2 on the labelled set. | Extraction step is written provider-agnostic from the start. |

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

`workers/`, `packages/schema/`, `eval/` and `NOTICE` are created when their first code lands, not before.

Conventions: TypeScript strict; H3 cells are computed in the Python workers, since Supabase does not offer the h3 extension; SQL migrations are forward-only; every decision in section 1 gets a one-page ADR in `docs/`.

## 3. Data model (first migration)

Core tables, all with `created_at`, `updated_at`:

- `organisation` — id, name, slug, `types` (array: startup, fund, angel_network, ngo, accelerator, corporate), sectors, stage, website_domain, description, name embedding (pgvector), claimed_by, status (draft, published, removed)
- `office` — organisation_id, is_hq, address, city, country, `geom` (geography point), precision (address, city), valid_from, valid_to
- `round` — organisation_id, stage, amount_original, currency, amount_usd, fx_rate, announced_on, valid_from
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

Angels are stored with `precision = city` and the geometry snapped to the city centroid at write time, so an address can never leak through a tile.

## 4. Sprint plan

Eleven sprints: ten of 2 weeks, plus a final launch week. Three tracks run in parallel, one per engineer. Data seeding by the researchers runs throughout.

| Sprint | Weeks | Front end and map | API and platform | Data pipeline |
|--------|-------|-------------------|------------------|---------------|
| 1 | 1–2 | Fork audit (done: no-go); clean Vite + TS + MapLibre app with the layer interface and map adapter | Monorepo, CI, Docker Compose, Supabase project, first migration, seed script | Raw document store; first 2 crawlers; labelled set started (50 of 200) |
| 2 | 3–4 | MapLibre 2D with Protomaps PMTiles basemap on R2; layer interface defined; clustering spike (item 4) | Fastify skeleton, OpenAPI, `/orgs/{id}`, `/events/{id}`, `/rounds/{id}` on seed data | Extraction schema and prompt v1; eval harness reporting per-field accuracy |
| 3 | 5–6 | Startups and offices layers; detail card; layer panel restyled. **First demo, week 6** | `/search` (full-text + trigram); public layer build job to CDN | Match and dedupe (domain, trigram, embeddings); Nominatim geocoding |
| 4 | 7–8 | Investors, NGOs, accelerators, events layers; filters combining across layers | Martin for live filtered tiles with per-filter caching; rate limits | Confidence scoring; review-queue writes; labelled set complete (200); provider chosen |
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
| R2 | Martin bypasses per-fund RLS because it uses one database role. | Private layers are served by an API route that sets the fund claim and calls a PostGIS tile function; a CI test asserts Martin's role cannot select from `fund_private_*`. |
| R3 | **Happened.** The fork is not reusable as assumed. | Clean MapLibre app that borrows the layer and share-link patterns. The proposal's 4 to 6 weeks of saved map work does not materialise; the 2D map basics were rebuilt in sprint 1, so the schedule impact falls mainly on search and on 3D. |
| R4 | One adapter for both MapLibre and Cesium leaks abstractions (clustering, styling and picking differ). | 2D is built first and alone; Cesium supports pins and selection only at MVP; cut line in sprint 9. |
| R5 | Data coverage, not code, decides launch quality. | Coverage targets per layer agreed by week 4 and tracked weekly; researchers seed from week 1; review-queue size is a sprint metric. |
| R6 | Crawling terms and licensed-data terms. | Per-source record of robots and terms in `docs/sources.md`; no licensed data displayed at MVP. |
| R7 | Self-hosted Nominatim is heavy for one city. | Start with a Kenya-only extract or a paid geocoder within the USD 0 to 50 line; decide in sprint 3. |
| R8 | Legal lead time on ODPC registration and residency. | Started week 1; production region blocked on it in sprint 8. |

## 8. Status: done and pending

As of Oct 6, 2026 (sprint 1, week 1). Checked against the repo on this date: `pnpm typecheck`, `pnpm test` (7 API tests against the seeded database, 3 web tests), `pnpm build` and `pnpm check:bundle` all pass locally. First-load JavaScript is 272.6 KB against the 600 KB budget.

### Done

Decisions (section 1):

- Item 1, fork or build clean: resolved, build clean. Recorded in `docs/fork-audit.md`.

Platform and database:

- Monorepo with pnpm workspaces (`apps/web`, `apps/api`, `db`), strict TypeScript, root scripts for database, dev, typecheck, test, build and bundle check.
- CI workflow (`.github/workflows/ci.yml`): install, database up, migrate, seed, typecheck, test, build, bundle budget. Written but never run, see pending.
- Local Postgres through Docker Compose with PostGIS, pgvector and pg_trgm, on port 5433.
- Forward-only migration runner and seed runner.
- First migration (`db/migrations/0001_core.sql`): `organisation`, `office`, `funding_round`, `round_investor`, `program`, `program_participant`, `event`, `person_role`, `raw_document`, `field_source`, `review_item`, `audit_log`, the `public_office` view, and `updated_at` triggers.
- Synthetic Nairobi seed: 46 invented organisations (30 startups, 8 funds, 4 NGOs, 4 accelerators) across 8 real neighbourhoods.

API (`apps/api`, Fastify):

- `/layers/offices.geojson` with a type filter, `/orgs/{id}` with offices, sources and last verified date, `/health`, `/openapi.json` generated from route schemas.
- Tests against the seeded database, including that draft organisations stay out of the public layer.

Web (`apps/web`, Vite, vanilla TypeScript, MapLibre):

- `MapAdapter` interface and the MapLibre adapter; layers reach the map only through the adapter.
- Layer interface and four organisation layers (startups, investors, NGOs, accelerators) with clustering. Pulled forward from sprints 3 and 4.
- Layer panel and detail card with sources and verified date. Pulled forward from sprint 3.
- Share links for camera, enabled layers and selected organisation, with unit tests. Pulled forward from sprint 5; filters and time range are not in the link yet.

### Pending in sprint 1

1. First commit and push to a remote. The repo has no commits and no remote, so CI has never run.
2. Real seed data: about 50 Nairobi organisations from the researchers, to replace the synthetic sample.
3. Pipeline track, none of it started: `workers/`, raw document store, first two crawlers, first 50 labelled announcements (`eval/`).
4. Supabase project and local Supabase stack. The local database is plain Postgres for now.
5. Schema gaps against section 3: `submission`, `claim`, `fund_private_*` and `hex_aggregate` tables; RLS policies; the name embedding column on `organisation`; snapping angel offices to the city centroid at write time. The rounds table is named `funding_round`, not `round`.
6. ADRs: only the fork decision is written up. Items 2 to 8 in section 1 each still need a one-page ADR; items 2, 3 and 6 are proposed answers, not yet agreed.
7. Open the legal conversation on data residency and ODPC registration.
8. Agree the non-functional targets and the per-layer coverage targets as a team (coverage targets are due by week 4, risk R5).
9. Deploy target for staging. Nothing is deployed; M1 needs staging by week 6.

M0 exit criteria: the first three are met locally (app builds and shows seeded data, fork audit recorded, `pnpm db:up` plus migrate and seed gives a seeded database). The fourth, CI running, waits on item 1.

### Gaps between what is built and the design in section 5

These are known shortcuts in the sprint 1 code, to close in the sprint where the plan places the work.

- **Layer interface.** Built as `render(map)`, `setEnabled()`, `isEnabled()`. The planned `load(filters)`, `toUrl()` and `fromUrl()` come with filters in sprint 4.
- **URL state.** Lives in `apps/web/src/state/urlState.ts`, unversioned. It moves to `packages/schema` with a version field before the API parses filters (sprint 2).
- **Basemap.** Uses the hosted OpenFreeMap style. Protomaps PMTiles on R2 is sprint 2.
- **Lazy chunks.** The budget check is in place, but there is no React or Cesium code yet, so the separate-chunk rule is untested.
- **Public layers.** Served live by the API with a 60 second cache. The build job to the CDN is sprint 3.

### Pending after sprint 1

The sprint table in section 4 still stands for sprints 2 to 11. What the early start changes:

| Sprint | Already done | Still to do |
|--------|--------------|-------------|
| 2 | Layer interface, MapLibre 2D map, Fastify skeleton, OpenAPI, `/orgs/{id}` | PMTiles basemap on R2, clustering spike (item 4), `/events/{id}`, `/rounds/{id}`, `packages/schema`, extraction schema and prompt v1, eval harness |
| 3 | Startups and offices layers, detail card, layer panel | Layer panel restyle, `/search`, public layer build job to CDN, match and dedupe, geocoding, staging deploy for the week 6 demo |
| 4 | Investors, NGOs and accelerators layers | Events layer, cross-layer filters, Martin, rate limits, confidence scoring, review-queue writes, labelled set to 200, provider choice |
| 5 | Share links for camera, layers and selection | Filters and time range in share links, search with fly-to, HQ-to-branch lines, auth, roles, audit log writes, scheduler, remaining crawlers, CSV import |
| 6 to 11 | Nothing | Everything as planned |

Verification (section 6): only the bundle-size check exists. Lighthouse CI, Playwright, the filter timing test, the synthetic 10 times dataset, the eval harness, uptime checks and RLS tests are all still to build in their listed sprints.
