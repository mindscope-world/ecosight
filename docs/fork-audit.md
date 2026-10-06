# Fork audit: God's Eye View

Audited Oct 6, 2026 at commit `9542a5e58b19277d1f9b6698a46f69fdaa5fc5c1` of
<https://github.com/bilawalsidhu/gods-eye-view> (version 0.2.1).

## Decision

Do not fork the repository. Build the web app clean on MapLibre and reuse
upstream's patterns, porting a small number of self-contained files when they
are needed.

## What the audit found

| Measure | Value |
|---|---|
| Tracked files | 1,667 |
| Non-test source modules under `src/` | 782 |
| Lines in those modules | about 195,000 |
| Modules that reference Cesium | 215 |
| Bundled data under `src/data/local_data/` | 20 MB |

The technical proposal's module table describes an earlier, smaller codebase:

- `src/main.js` (17 lines), `src/ui.js` (16) and `src/mapStackController.js` (32)
  are now thin shims. The real code sits in `src/app/` (about 30 modules),
  `src/ui/` (166 files) and `src/maps/` (18 files).
- The layer contract is `init(viewer)`, `enable(viewer)`, `disable(viewer)`,
  `update(viewer)`, where `viewer` is a Cesium viewer. Even the simplest layer
  (earthquakes) creates Cesium data sources directly. There are 24 layers, none
  relevant to this product.
- `src/sharelink.js` (706 lines) imports Cesium and mostly encodes state this
  product does not have: visual styles, bloom, HUD mode, detection settings.
- There is no 2D MapLibre path. Adding one means writing a second renderer
  under a contract designed around Cesium.

Stripping this down to a 2D map would mean deleting well over 90% of the code
and then untangling what is left from Cesium. Starting clean is less work and
leaves no dead code. It also keeps the first-load JavaScript small: the clean
app is 273 KB compressed against the 600 KB budget.

## Licence

The source code is MIT (copyright 2026 Bilawal Sidhu). The licence file states
that the grant does not cover bundled data or 3D models. Two bundled datasets
are non-commercial: the TeleGeography submarine cables (CC BY-NC-SA 3.0) and the
Bhote Koshi imagery and derived coordinates (CC BY-NC 4.0). None of this is in
our repository.

No upstream code has been copied so far. When a file is ported, add a `NOTICE`
file with the upstream MIT copyright notice and a header comment on the ported
file naming its origin.

## What is reused

| Upstream | How it is used here | Status |
|---|---|---|
| One module per layer with a uniform lifecycle | `apps/web/src/layers/types.ts`, redesigned against a renderer-neutral `MapAdapter` | Pattern only, built |
| Layer catalog registered at startup | The `layers` array in `apps/web/src/main.ts` | Pattern only, built |
| Share link as URL hash, malformed parts dropped | `apps/web/src/state/urlState.ts` | Pattern only, built |
| Third-party keys held on the server | API design | Pattern only |
| `src/search/coordinateParser.js` (100 lines, no Cesium) | Strict coordinate parsing for the search box | Port in sprint 5 |
| `src/search/nominatim.js`, `src/search/http.js` | Reference for the geocoder client | Port or rewrite in sprint 5 |

## Consequences for the plan

- The proposal's estimate that the fork saves 4 to 6 weeks of map work does not
  hold. The 2D basics (map, layers, cards, share links) were rebuilt in sprint 1,
  so most of that time is not lost; search and the 3D globe get no head start.
- The 3D globe was "kept from the fork". Without a fork it is new work on
  CesiumJS behind the map adapter. The plan now recommends leaving it out of
  the MVP.
- Voice control and the cinematic director were already parked or deleted.
