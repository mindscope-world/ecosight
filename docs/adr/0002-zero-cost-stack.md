# ADR 0002: Zero-cost stack for the MVP

Oct 6, 2026 · Status: proposed, in use in the repo

> **Note, Oct 7, 2026.** ADR 0003 proposes Memgraph on Railway for the graph features. That is a paid host and a departure from the rule below; see that record for the cost and the reasons.

## Decision

Every component of the MVP uses a free tier or a free self-run option, chosen so
that moving to a paid tier later is a configuration change and not a rewrite.

| Need | Choice | Cost | When it stops being enough | Way out |
|------|--------|------|----------------------------|---------|
| Basemap tiles | OpenFreeMap hosted styles (light and dark) | Free, no key, no request limit stated | If the public instance becomes slow or unreliable | Self-host Protomaps PMTiles on Cloudflare R2; only `VITE_BASEMAP_STYLE` changes |
| Public data layers | GeoJSON per layer, clustered in the browser | Free | About 50,000 points in a layer | PMTiles or Martin for that layer |
| Live filtered tiles | None. Filters run in the browser on the GeoJSON | Free | Same 50,000 point mark | Martin |
| Database | Postgres with PostGIS, pgvector and pg_trgm. Docker locally, Supabase free tier when hosted | Free up to 500 MB | Database above 500 MB, or the free project pausing after a week idle | Supabase Pro |
| Search | Postgres full-text plus trigram similarity | Free | Not expected at MVP scale | Dedicated search engine |
| Name embeddings | 384-dimension open model run on CPU in the workers | Free | Not expected | Hosted embeddings, with a column migration |
| Extraction | Rule-based baseline, and a model on Groq called through LangChain | Free tier, rate limited | If the free tier's daily limits are too low for a backfill, or accuracy on the labelled set is too low | Groq's paid tier, or another LangChain chat model passed to the same extractor |
| Geocoding | Public Nominatim, 1 request per second, results cached | Free | Bulk backfills beyond a few thousand addresses | Kenya-only self-hosted Nominatim |
| Raw document store | Local directory, later Cloudflare R2 | Free up to 10 GB | Above 10 GB | Paid R2 storage |
| Web hosting | Any static host; the build supports a sub-path, so GitHub Pages works without another account | Free | Not expected | — |
| API hosting | A container (`infra/api/Dockerfile`); host not chosen yet | — | — | See open questions |
| Scheduled jobs | GitHub Actions on a schedule | Free and unmetered while the repository is public | If the repository goes private: 2,000 minutes a month | — |
| CI | GitHub Actions | Free for public repos, 2,000 minutes a month for private | — | — |

## Why

The proposal budgets USD 0 to 50 a month for infrastructure before launch. None of
the paid options in the original plan (R2-hosted basemap, Martin, a hosted model)
is needed at Nairobi scale, and each has a free equivalent that the code already
isolates behind one setting or one interface.

## Consequences

- Plan item 4 (clustering) is settled as static GeoJSON with client-side
  clustering. Martin is dropped from sprint 4 and R2 from sprint 2.
- Risk R7 (self-hosted Nominatim) goes away for the MVP.
- The basemap depends on a public service with no uptime commitment. The uptime
  check in sprint 9 should cover it.
- Article text is sent to Groq for extraction. A local model (`gemma3:4b` through
  Ollama) was tried first and took 80 to 160 seconds per article on a laptop CPU,
  which is why the hosted free tier was chosen.

## Open questions

- Where the API runs for free. It is packaged as a container and the map no
  longer depends on it being up, so a host that sleeps when idle is acceptable.
  Free tiers change often; check the candidates' current terms when choosing.
  See `docs/deploy.md`.
- Whether the model choice survives the labelled-set comparison in month 2.
