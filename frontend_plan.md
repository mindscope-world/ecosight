# ecoSight — Frontend Plan

Oct 6, 2026 · drafted from the UI/UX brief

**ecoSight** — *See where innovation happens.*

This document turns the UI/UX brief into a build plan for the web app in `apps/web`. Sections 1 to 8 restate the brief as a specification. Sections 9 to 12 say how it maps onto the code that exists, what each panel needs from the API, the order to build it in, and the decisions that are still open. The combined frontend and backend order is in `final_plan.md`.

> **Status, Oct 7, 2026.** The map app (sections 1 to 13) and the landing page (section 14) are both built and run on real data. The graph explorer (section 15) is specified and not yet built. Section 13 and the end of section 14 list what is built and what is not. Sections 9 to 11 describe the state and the build order before this work and are kept for reference; `final_plan.md` has the current order.

> **Reference screenshot.** The brief refers to an attached reference screenshot. It has not been seen while writing this plan: it sits outside the project folder, which the session could not read. The design language below comes from the brief's written description only. Copy the image into `docs/reference/` before the design-system work starts.

## 1. Product

ecoSight is a map-first intelligence platform. It places startups, VC firms, angel investors, accelerators, incubators, NGOs, development organisations, startup hubs, events, universities, government programs and branch offices at their real locations.

The map is the primary experience. The interface should read as a professional geospatial intelligence product, not a conventional SaaS dashboard: Google Maps, a Bloomberg terminal, Palantir-style geospatial intelligence and Crunchbase, with a clean modern startup aesthetic.

The intended flow is one continuous loop, not page-to-page navigation:

**Search → filter → map → select → investigate → discover connections**

Every entity links to other entities (startup → investors → their portfolio → other startups → cities → events → accelerators), so the product becomes an interactive graph of the ecosystem.

Audience the result must be credible to: venture capital firms, founders, accelerators, development finance institutions, NGOs, governments, research institutions, ecosystem builders.

### Entity types

Startup, investor / VC, angel investor, accelerator, incubator, NGO, development funder, event, coworking / innovation hub, university, government program.

### Filter dimensions

Entity type, sector, funding stage, funding amount, founded year, location, active / inactive, portfolio relationship.

## 2. Design language

Borrowed from the reference, by description: dark command-center look, full-screen map, dense but organised panels, thin borders, small uppercase section labels, compact typography, status indicators, small data visualisations, subtle cyan and blue highlights.

Not borrowed: the reference's fire-management content, branding, terminology, graphics or exact layout.

### Colour tokens

| Token | Value | Use |
|-------|-------|-----|
| Background | `#071018` | App background, map surround |
| Panel | `#0B151E` | Panels, header, status bar |
| Border | `#1A2A35` | Thin 1px panel and divider lines |
| Primary accent | `#22D3EE` | Active state, selection, key figures |
| Secondary accent | `#3B82F6` | Links, secondary highlights |
| Primary text | `#E6EDF3` | Headings, values |
| Secondary text | `#8B9AA7` | Labels, metadata |
| Positive | subtle green | Upward trends |
| Warning | amber | Warnings |
| Critical | red | Critical or high-priority only |

Rules: not overly neon; one primary accent; a restrained set of categorical colours for entity types, validated for colour-blind separation on the dark surface before use. Entity type is carried by marker shape as well as colour, so colour is never the only signal.

### Typography

Inter, Geist or IBM Plex Sans. Uppercase micro-labels, compact headings, small metadata, and strong numeric hierarchy with tabular figures.

## 3. Screen anatomy

One screen, the **Ecosystem Intelligence Map**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopNavigation: logo · MAP DISCOVER ECOSYSTEMS INVESTORS STARTUPS     │
│                EVENTS · search · notifications · saved · profile     │
├────────────┬───────────────────────────────────────────┬─────────────┤
│ Left       │                                           │ Right       │
│ intelligence│                 MapView                  │ intelligence│
│ panel      │   LayerControl (floating)   MapLegend     │ panel /     │
│ (collaps.) │                                           │ EntityDetails│
├────────────┴───────────────────────────────────────────┴─────────────┤
│ StatusBar: data status · entities · locations · countries · updated  │
└──────────────────────────────────────────────────────────────────────┘
```

Overlays: `SearchCommand` (command palette) and `FilterPanel` (drawer).

## 4. Components

### 4.1 TopNavigation

Compact dark bar, so the map keeps the space.

- Left: ecoSight logo.
- Navigation: MAP, DISCOVER, ECOSYSTEMS, INVESTORS, STARTUPS, EVENTS.
- Right: search, notifications, saved locations, user profile.
- Global search field, placeholder "Startups, investors, cities, sectors...".

The navigation items change what the map and panels focus on (for example INVESTORS turns on the investor layer and investor-centred panels). They are not separate pages.

### 4.2 MapView

Zoom, pan, search, marker clustering that separates progressively on zoom, heatmaps, several map styles, satellite / terrain toggle, layer visibility, location selection, polygon / region selection, city-level and country-level exploration, legend.

Markers by shape (`EntityMarker`, `ClusterMarker`):

| Entity | Marker |
|--------|--------|
| Startup | Circle |
| VC firm | Diamond |
| Accelerator | Square |
| Event | Pin |
| NGO | Cross |
| University | Building |
| Innovation hub | Hub |

No fictional companies in the product. Until the real dataset is connected, placeholder data is clearly marked as demo data.

### 4.3 LayerControl

Compact floating selector in the style of GIS software, titled **MAP LAYERS**. A defining feature of the product.

- On by default: Startups, Investors, Accelerators, Events, NGOs, Innovation Hubs.
- Off by default: Universities, Government, Funding Heatmap, Startup Density, Recent Activity.
- **MAP STYLE**: Dark, Light, Satellite, Terrain.

### 4.4 Left intelligence panel

Collapsible, compact, scrollable.

- **ECOSYSTEM OVERVIEW** (`EcosystemOverview`): counts of startups, investors, accelerators, events and programs.
- **ECOSYSTEM ACTIVITY** (`ActivityPanel`): new startups this month, new funding rounds, active investors, new programs, upcoming events, each with a small trend figure such as `+14.2%`.
- **TOP SECTORS**: ranked list with share, for example Fintech 28%.
- **MARKET ACTIVITY**: cities with activity scores.

### 4.5 EntityDetails

Opens when an entity is clicked.

- Header: name, sectors, city and country, founded year, total funding, status.
- **COMPANY**: description.
- **FUNDING**: total raised, latest round, latest amount.
- **ECOSYSTEM**: investors, locations.
- **CONNECTIONS**: portfolio relationships, investors, accelerators, events, founders. Each item is a link that selects that entity and moves the map, which is how the user walks the graph.

Existing provenance (sources and last-verified date per record) stays on this panel.

### 4.6 Right intelligence panel (`AnalyticsPanel`)

- **ECOSYSTEM SIGNAL**: generated statements such as "Nairobi FinTech activity: HIGH", "12 new startups detected this quarter", "VC activity +18%".
- **CAPITAL ACTIVITY**: clean line chart of funding over time, by month.
- **EMERGING CITIES**: cities ranked by activity score.
- **RECENT ACTIVITY**: compact feed with relative times ("12 min ago: New startup added").

### 4.7 StatusBar

Thin bottom bar: data status (Live / Updated), entity count, location count, country count, last updated; on the far right the wordmark and "ECOSYSTEM INTELLIGENCE PLATFORM".

### 4.8 SearchCommand

Search is a first-class interaction. Clicking search opens a command palette.

- Placeholder: "Search startups, investors, cities, sectors...".
- Handles queries such as "fintech investors in Nairobi", "healthtech startups Lagos", "accelerators in Kenya", "startups founded after 2023".
- Results grouped with counts: STARTUPS, INVESTORS, EVENTS, LOCATIONS.
- Selecting a result moves the map to it.

### 4.9 FilterPanel

Advanced filter drawer. Filters update the map and the statistics together.

| Group | Options |
|-------|---------|
| Entity type | Startup, Investor, Accelerator, NGO, Event (and the remaining types) |
| Sector | FinTech, HealthTech, ClimateTech, AgriTech, EdTech, SaaS, AI, Logistics, Mobility, Energy, Biotech |
| Funding stage | Pre-seed, Seed, Series A, Series B, Series C+, Growth, Bootstrapped |
| Geography | Country, region, city, radius |
| Date | Founded, funding, event date |
| Investor activity | Active, recently active, portfolio, lead investor |

## 5. Responsive behaviour

Desktop is the primary experience. Tablet and phone are redesigned, not shrunk:

- Left and right panels collapse; the map is full screen.
- Filters become a bottom sheet.
- Search becomes a floating button.
- Entity details open as a bottom sheet.

## 6. Technical direction in the brief

React, TypeScript, Tailwind CSS, MapLibre GL JS or Mapbox GL, Recharts or a lightweight chart library, PostgreSQL / PostGIS, FastAPI backend.

Component list: `MapView`, `TopNavigation`, `LayerControl`, `FilterPanel`, `EcosystemOverview`, `ActivityPanel`, `EntityDetails`, `SearchCommand`, `AnalyticsPanel`, `StatusBar`, `MapLegend`, `EntityMarker`, `ClusterMarker`.

Several of these differ from what is built. See section 12.

## 7. The defining requirement

A dark, cinematic, highly detailed interactive map surrounded by compact intelligence panels. A first-time viewer should understand at once that they are looking at the startup ecosystem as a geographic intelligence system, and it should feel like an intelligence product, not a startup directory or an admin dashboard.

## 8. Acceptance checks

- The map fills the viewport; header and status bar together take no more than about 80px of height on desktop.
- Every panel can be collapsed, and the map remains usable with all panels open at 1280 × 720.
- Entity type is distinguishable by shape with colour removed.
- Clusters split into individual markers as the user zooms into a city.
- Any filter change updates markers, panel statistics and the status bar counts together.
- From any entity, the user can reach a connected entity in one click, and the map follows.
- Search can be opened from the keyboard, groups its results, and moves the map on selection.
- No number on screen is invented: every figure comes from the API, or the panel is labelled as demo data.
- First-load JavaScript stays under the 600 KB budget already enforced in CI.

## 9. Where the code stands

The app today is a light-and-dark themed MapLibre map branded "Capital Atlas", written in vanilla TypeScript.

| Brief | Built today | Gap |
|-------|-------------|-----|
| TopNavigation | Top bar with Map, Dashboard, Settings, a search box, theme button | New nav items, logo, notifications, saved locations, profile; rebrand |
| MapView | MapLibre behind a `MapAdapter`; clustering; light and dark basemaps | Marker shapes, heatmaps, satellite and terrain, polygon selection, country-level view, legend |
| LayerControl | "Layers" window with six checkboxes | Floating GIS-style control, new layers, map style switcher |
| Left panel | "Overview" window with counts by type and totals | Activity with trends, top sectors, market activity |
| EntityDetails | "Details" window: offices, funding rounds, sources, verified date | Header facts, investors, connections and graph navigation |
| Right panel | "Upcoming events" window | Signals, capital activity chart, emerging cities, recent activity feed |
| StatusBar | Not built | All of it |
| SearchCommand | Search box for organisations with fly-to | Command palette, grouped results, cities and sectors, query understanding |
| FilterPanel | Not built | All of it |
| Dashboard screen | Totals, by type, top sectors, recent rounds | Folded into the map panels; the brief has no separate dashboard page |
| Responsive | Panels minimise on phones | Bottom sheets, floating search |
| Share links | Camera, layers, selection, open screen in the URL | Add filters, map style and time range |

Kept as is: the `MapAdapter` boundary (layers never call MapLibre directly), versioned share links in `packages/schema`, the minimisable window mechanism, lazy loading of secondary screens, and the bundle budget.

## 10. What each panel needs from the API

| Panel | Data | Exists today |
|-------|------|--------------|
| Ecosystem overview | Counts by entity type | Yes, `/stats` |
| Ecosystem activity | Counts for this period and the previous one | No |
| Top sectors | Sector counts and shares | Counts yes, shares no |
| Market activity, emerging cities | Per-city counts and an activity score | No. The score needs a definition |
| Entity details | Founded year, status, total raised, latest round, investors | Partly. No founded year or active flag in the schema |
| Connections | Investors, portfolio, programs, events, founders of an entity | No endpoint. Tables exist for rounds, investors, programs, roles |
| Ecosystem signal | Generated statements | No. Needs rules over period counts |
| Capital activity | Funding by month | No |
| Recent activity | Feed of additions and changes | No endpoint. `audit_log` and `created_at` can supply it |
| Status bar | Entity, location and country counts; last update time | Partly |
| Search | Organisations, events, cities, sectors, grouped | Organisations only |
| Filters | Every layer and stat endpoint accepting the same filter set | No |
| Heatmap, density | Hex aggregates | Table exists, nothing fills it |
| Notifications, saved locations, profile | Accounts | No. Needs sign-in |

## 11. Build order

Each phase leaves a working app. Details and the matching backend work are in `final_plan.md`.

1. **Design system and shell.** Tokens, typography, dark map style, header, status bar, left and right panel frames, rebrand to ecoSight. Existing data only.
2. **Markers and layers.** Shapes per entity type, legend, floating layer control, map style switcher, new entity types.
3. **Entity details and connections.** Full detail panel and one-click graph navigation.
4. **Search command palette.** Grouped results across entities, cities and sectors.
5. **Filter drawer.** Shared filter state driving map, panels, status bar and share links.
6. **Intelligence panels.** Activity, sectors, cities, capital chart, feed, signals.
7. **Advanced map.** Heatmap and density layers, satellite and terrain, polygon and radius selection, country-level view.
8. **Responsive redesign.** Bottom sheets, floating search.
9. **Accounts in the header.** Profile, saved locations, notifications.

## 12. Open decisions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | **React and Tailwind.** The app is vanilla TypeScript with hand-written CSS; the brief asks for React and Tailwind. | Move the UI shell and panels to React and Tailwind in phase 1, while the code is small. Keep the map adapter and layers in vanilla TypeScript, as `plan.md` already intends. |
| 2 | **FastAPI.** The API is Fastify in TypeScript with 19 tests; the brief prefers FastAPI. | Keep Fastify. A rewrite buys nothing the product needs. Python stays in the workers. |
| 3 | **Name.** The repo and UI say Capital Atlas. | Rebrand the UI to ecoSight in phase 1. Leave internal package names alone. |
| 4 | **Scope.** The brief shows 72 countries and 18,421 entities; the MVP plan is Nairobi. | Design for global, launch with the real dataset's coverage. Never show the brief's sample figures. |
| 5 | **Light theme.** The brief is dark-only, with "Light" as a map style. | Dark is the default and the only fully designed theme. Keep light as a map style choice. |
| 6 | **Satellite and terrain tiles.** No free source is chosen. | Terrain from open elevation tiles. Satellite needs a source whose licence allows this use; decide before phase 7. |
| 7 | **Chart library.** Recharts is large against the 600 KB budget. | Hand-built SVG for the one line chart and the bar lists, or a small library loaded lazily. |
| 8 | **Activity score and signals.** The brief shows them but does not define them. | Define the score as a documented formula over counts in a period; write signals as rules over the same counts. No model-generated claims. |
| 9 | **Natural-language search.** "VCs investing in climate Africa" needs query parsing. | Structured search first (type, sector and place words). Add model-parsed queries later through the existing Groq setup. |
| 10 | **Individual angels.** The brief lists angel investors as map entities. | Keep the existing privacy rule: angels are placed at city level only, never at an address. |
| 11 | **Dashboard and Settings screens** built today are not in the brief. | Fold the dashboard into the panels and remove the screen. Move settings behind the profile menu. |

## 13. Implementation status

Updated Oct 7, 2026. The map app is built in `apps/web` (React, Tailwind, MapLibre) and lives at `/map/`. It was checked in a headless browser at desktop and phone sizes. Its first-load JavaScript is 356 KB of the 600 KB budget. It runs on real data: 109 organisations on the map in 10 countries.

Decisions taken from section 12: React and Tailwind for the interface (1), Fastify kept (2), UI renamed to ecoSight (3), dark only with light as a map style (5), hand-built SVG chart (7), score and signals as fixed rules (8), structured search words (9), dashboard and settings screens removed (11).

### Built

| Component | What it does |
|-----------|--------------|
| TopNavigation | Logo and wordmark linking to the landing page, six lenses (MAP, DISCOVER, ECOSYSTEMS, INVESTORS, STARTUPS, EVENTS) that switch layers on one map, search trigger, filters button with a count |
| MapView | Navy-tinted dark basemap, marker shapes per entity type, clustering at every zoom, light and terrain styles, scale bar |
| Stacked records | Records on one spot keep a counted marker; clicking it lists them, and each opens with a link back to the list |
| LayerControl | Floating, minimisable; eight entity layers with counts; four heatmaps (funding, and startup, investor and accelerator density, each in its own colour); map style switcher |
| MapLegend | HQ and branch size, cluster, and a named ramp for each heatmap that is on |
| Left panel | Ecosystem overview, ecosystem activity with period comparison, top sectors with shares, market activity with a documented score, across every city with records |
| AnalyticsPanel | Ecosystem signal (rules over counted figures), capital activity line chart with hover readout, emerging cities, recent activity feed |
| EntityDetails | Header facts, company, funding rounds in their own currency with dates as precise as known, or the research's funding note; investors shown by portfolio and capital; locations with their precision; connections; sources with their stated basis |
| Graph navigation | Any connection opens that record and moves the map to it. Arcs join the selected organisation to its investors, its portfolio and its branches |
| SearchCommand | Ctrl or Cmd + K, or `/`; results grouped into organisations, people, events, locations and sectors; reads type, sector and city words; arrow keys and Enter |
| FilterPanel | Entity type, sector, funding stage, funding raised, country, city, founded range, year of a funding round, investor activity, event dates, status |
| Filters everywhere | Markers, layer counts, every panel and the status bar follow the filters. The API applies the same rules as the browser |
| StatusBar | Data status, entities, locations, countries, last updated, wordmark |
| Share links | Lens, map style, filters, camera, layers and selection. Links made before the app moved to `/map/` are forwarded |
| Responsive | Below 1024px: full-screen map, floating search button, bottom sheets for overview, layers, insights, filters and details |

Every panel has a minimise control, and both side columns collapse to a rail.

### Not built yet

| Item | Why |
|------|-----|
| Satellite style | No imagery source with a suitable licence is chosen. The option is shown disabled |
| Polygon and radius selection, region and radius filters | Step 7 of `final_plan.md` |
| Per-country summary | Records in any country are drawn and can be filtered by country; a summary per country is step 4 |
| Recent Activity map layer, time slider | Step 7 |
| Notifications, saved locations, profile | Need sign-in. The icons are shown disabled |
| Model-parsed search queries | Structured words only for now |
| Events, universities and government layers | The layers exist and are empty until such records are loaded |

### Things to know

- Trend percentages show a dash when the earlier period is empty, which is most of them on freshly loaded data.
- Organisations with no public address sit on one point at their city's centre. They open as a list, and the heatmaps leave them out.
- If the API cannot be reached, the map keeps filtering by itself and the panels keep the all-records figures and say so.
- The colour palette for entity types passes colour-blind checks for neighbouring pairs but not for every pair, so shape carries identity alongside colour.
- The interface has not been compared with the reference screenshot, which was never available in the repository.

## 14. Landing page

Added Oct 7, 2026 from the landing page brief. The landing page is the site's front door at `/`; the map app from sections 1 to 13 now lives at `/map/`.

### The task

A premium landing page that makes one idea clear within five seconds: ecoSight turns the startup ecosystem from disconnected lists into a living, explorable map. The map is the hero, not an illustration beside it.

The page tells the story in order:

1. The ecosystem is fragmented.
2. ecoSight maps it.
3. Every company, investor, program and event becomes a point on the map.
4. Connections become visible.
5. Hidden opportunities become discoverable.

Design direction: clean, sophisticated, confident and inviting; a dark and light hybrid in deep navy, midnight, electric cyan and blue; large type, generous space, subtle motion, uppercase micro-labels. Not a generic SaaS page, a directory, a crypto site or a neon dashboard. No stock photographs, invented customer logos, invented testimonials or claimed partnerships.

### Sections and their components

| Section | Component | What it shows |
|---------|-----------|---------------|
| Navigation | `Navbar` | Wordmark, Explore, Ecosystems, Startups, Investors, Insights, Sign in, Explore the Map. Clear over the hero, blurred surface once scrolled, collapses to a menu on phones |
| Hero | `Hero`, `HeroMap` | "See where innovation happens." over a live world map with clusters at innovation hubs, pulsing hubs, slow drift, and floating product cards |
| Trust | `TrustBar` | "Built for the people shaping the ecosystem." with audience categories, no logos |
| Problem | `ProblemSection` | "The ecosystem is everywhere. The data isn't." A table beside the same records on a map, then Lists → Places → Connections → Opportunity |
| Layers | `EcosystemLayers` | "One ecosystem. Every layer." Five cards; pointing at one lights that layer on a miniature map |
| Explore | `InteractiveMapPreview` | "Explore ecosystems at every scale." World, Africa, East Africa, Kenya, Nairobi, with layer toggles |
| Use cases | `FounderSection`, `InvestorSection`, `EcosystemBuilderSection` | One heading, one paragraph, one link and one visual each |
| Intelligence | `IntelligenceSection` | "A map that becomes smarter over time." The chain from startup to sector as linked nodes |
| Signals | `SignalsSection` | Example signal cards, each marked as demo data |
| Global | `GlobalSection` | "Innovation doesn't happen in one place." A globe centred on Africa with connections between cities |
| Close | `FinalCTA`, `Footer` | Closing call to action; product, use case, company and legal columns |

Motion: text rises on load, the map fades in, sections reveal on scroll, numbers count up, buttons nudge on hover. Everything stops for people who ask their system for reduced motion.

### Status: built

Built in `apps/web/src/landing/` with React, Tailwind, Motion, Lucide icons and MapLibre. Checked in a headless browser at desktop and phone widths with no console errors. First-load JavaScript is 122 KB; the map library is fetched only when a map is about to scroll into view.

How the brief's open points were settled:

- **Real figures where they exist.** The hero cards, the problem section's table and its map, and the Nairobi view of the explore preview read the product's own records. Today that means 92 organisations in Nairobi, 36 funding rounds, the largest sector, and investors in 10 countries.
- **Everything else is marked.** Apart from Nairobi and the investors placed in other cities, points on the maps are illustrative, as are the connections between cities and the small schematic maps, and each says so in a caption. A city's illustrative points give way to real ones once it has ten real records. The signals cards carry a "Demo data" tag, as the brief requires. If the product's records cannot be loaded, the hero falls back to the brief's example figures, tagged as demo data.
- **Nothing links nowhere.** "Sign in" is shown but inactive, since there are no accounts yet. "Join the ecosystem" opens the public repository. Footer entries for pages that do not exist (About, Methodology, Contact, Privacy, Terms, Data Policy) are plain text, not links.
- **Old share links still work.** A link to the map made before the move is forwarded from `/` to `/map/` with its state.
- **Recharts is not used.** The page has no chart that needs it.

### Not done

| Item | Why |
|------|-----|
| Pages behind the footer: About, Methodology, Contact, Privacy, Terms, Data Policy | Content and legal text need the owner; Privacy and Terms are required before a public launch |
| Sign in, and "Join the ecosystem" as a sign-up | Needs accounts (step 5 of `final_plan.md`) |
| Hoverable city labels on the hero map | The preview maps are non-interactive by design; the explore section's controls are the interaction |
| Real points for events | Investors and programs in Nairobi are now real records; there are no events yet |
| A social preview image and page metadata for sharing | Small; best done once the copy is final |
| A design review against a reference | The page follows the written brief; no visual reference was supplied for it |

## 15. Graph explorer page

Added Oct 7, 2026. Not built. This is the interface for step 3 of `final_plan.md`; the engine behind it is described in `docs/adr/0003-graph-engine.md`.

### What it is for

The map answers "what is where". This page answers "who is connected to whom": which investors back a company, what else they back, who they invest alongside, and how two organisations are linked. A visitor starts from one organisation and walks outward.

It is a third page, at `/graph/`, beside the landing page and the map app, and it shares their look: the same navy surfaces, micro-labels, marker shapes and colours per kind of organisation.

### Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ TopNavigation: logo · MAP … GRAPH · search · filters                  │
├──────────────┬─────────────────────────────────────────┬──────────────┤
│ Controls     │                                         │ Details      │
│ (collapsible)│              Graph canvas               │ (the map     │
│              │                                         │  app's panel)│
├──────────────┴─────────────────────────────────────────┴──────────────┤
│ StatusBar: nodes shown · relationships shown · depth · last updated   │
└───────────────────────────────────────────────────────────────────────┘
```

`GRAPH` joins the lenses in the top navigation of the map app, and the landing page's navigation and footer link to it.

### Components

| Component | What it does |
|-----------|--------------|
| `GraphCanvas` | Nodes and links, drawn with the map's shapes and colours so a startup, an investor and an accelerator look the same on both pages. Pan, zoom, drag a node, hover for a name and one line of facts |
| `GraphStart` | What the page shows before anything is chosen: a search box, and the most connected organisations as starting points |
| `GraphSearch` | The existing command palette. Picking a result centres the graph on it |
| `ExpandControl` | Click a node to select it; double-click, or a button, to bring in its neighbours. A node shows how many more connections it has before it is expanded |
| `RelationshipFilter` | Switch kinds of link on and off: invested in, went through a programme at, organised, founded or leads, located in, works in a sector |
| `GraphFilters` | The map app's filters, applied to nodes: sector, stage, country, year of a round, investor activity |
| `PathFinder` | Choose two organisations and see the shortest chain of links between them, or be told there is none |
| `InsightList` | Lists read from the graph: co-investors of the selected investor, companies that share an investor with the selected company, the most connected organisations in view |
| `EntityDetails` | The map app's details panel, unchanged, with one addition: "Show on map" |
| `GraphLegend` | Shapes for kinds of organisation and line styles for kinds of link |
| `LinkDetails` | Selecting a link shows what it stands for: for an investment, the round's stage, amount, date and source |

### Interactions

- **Start anywhere.** From search on this page, from "View connections" in the map app's details panel, or from a share link.
- **Expand by choice.** The graph grows only where the visitor asks. Nothing loads a whole network at once.
- **Follow money.** From a company to its investors, to their other companies, to those companies' investors, each step one click.
- **Find a path.** Two organisations in, the chain between them out.
- **Go to the map.** Any node can be opened on the map, and any organisation on the map can be opened here.
- **Share.** The address holds the starting organisation, what has been expanded, the filters and the selection, in the same versioned form as the map app's links.

### What it needs from the API

| Need | Request |
|------|---------|
| An organisation's neighbours, to a depth, by kind of link | `GET /graph/neighbourhood?id=&depth=&limit=` |
| More neighbours of one node already on screen | `POST /graph/expand` with the node and the ids already on screen; paged |
| The chain between two organisations | `GET /graph/path?from=&to=&max=` |
| Who invests alongside an investor; who shares an investor with a company | `GET /graph/co-investment?id=` |
| Starting points and the insight list | `GET /graph/top?limit=&type=` |
| Finding an organisation to start from | The existing search |

The API is built (Oct 7, 2026). Every route also takes `kinds` (the kinds of link to follow; investments, programmes and events when not given) and the map's filter parameters. Each node comes with `degree` and `hidden`, the number of its neighbours the answer does not show, which is what `ExpandControl` displays. An investment link carries its rounds, each with stage, amount, date and source address.

Every answer carries only published records, and each link can be traced to its source, as on the map.

### Rules

- **No hairballs.** A cap on nodes shown at once, with a clear message when a node has more neighbours than are drawn and a way to page through them.
- **Honest about gaps.** The graph today is small and mostly investment links. A node with no connections on record says so; it is not hidden, and it is not padded with invented links.
- **People.** A person appears only as a role at an organisation, as everywhere else. People are off by default in the relationship filter, and no node shows personal details beyond name and role.
- **The same in a list.** Everything on the canvas is also reachable as a list in the side panel, for keyboard and screen-reader use.
- **Lazy.** The graph library is loaded only on this page, which has its own first-load budget of 600 KB like the other two.

### Small screens

The canvas fills the screen. Controls and details become bottom sheets, as in the map app. The path finder and insight lists move into a sheet of their own.

### Open choices

| Question | Recommendation |
|----------|----------------|
| Graph drawing library | Choose between Cytoscape.js and Sigma.js by trying both on the real data: both are free. Decide on legibility at 200 nodes and on bundle size |
| Layout | Force-directed by default, with a radial option centred on the selected node, which reads better for "who backs this company" |
| Geography on this page | A toggle that pins nodes to their place on a small map was considered. Leave it out: the map app is the place for geography, and the two views say more side by side than merged |

### Acceptance checks

- Opening the page from a startup's details panel shows that startup with its investors in under a second on the current data.
- Expanding an investor brings in its portfolio, and no node appears twice.
- The path finder returns a chain for two organisations that share an investor, and says "no connection on record" for two that do not.
- Switching a kind of link off removes those links and any node left with none.
- A share link reopens the same graph, expanded the same way, with the same node selected.
- A draft organisation never appears, and neither does a link to one.
- Every link shown can be opened to see where it came from.

