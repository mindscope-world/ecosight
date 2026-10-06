# ADR 0003: A graph engine for ecosystem connections

Oct 7, 2026 · Status: proposed by the owner; adapted here; not built

## The proposal

Add Memgraph as ecoSight's graph engine, on Railway, fed by an asynchronous
background worker ("Strategy A"). The worker takes in pitch decks read by a
language model, CSV files, external APIs and other relational databases, and
writes entities and relationships to Memgraph with idempotent `MERGE`
statements. The Fastify API stays the single gateway for the web app and never
does ingestion work itself.

Reasons given: the sources are too varied to resolve inside user-facing
requests; a worker isolates that work; and Memgraph, written in C++, gives fast
traversals and spatial point lookups for less memory than Java-based graph
databases, which matters for cost on Railway.

## Decision

Adopt Memgraph and the asynchronous worker, with one change to the proposal:

**Postgres stays the system of record. Memgraph is a projection of it.**

The proposal's sample code writes straight from each source into the graph. That
would bypass four things the product already depends on:

- **The review queue.** Everything crawled, imported or submitted becomes a review
  item before it is published. A relationship read from a pitch deck by a model
  is exactly the kind of claim that needs it.
- **Provenance.** Every published field carries its source, and curated values
  carry the words they were read from. The graph has nowhere to keep that.
- **Publication status.** 33 organisations are held as drafts. Only published
  records may reach anything a visitor can query.
- **Location rules.** Angels are placed at city level only, and records without a
  public address sit at a city's centre. A graph node with its own latitude and
  longitude, written by an ingestor, would lose both rules.

So the flow is:

```
pitch decks, CSVs, APIs, other databases
        │
        ▼
  ingestors (async worker)  ──►  review queue  ──►  Postgres (published records)
                                                        │
                                                        ▼
                                          projection worker (async, Bolt)
                                                        │
                                                        ▼
                                                    Memgraph
                                                        │
  web app  ◄──────────  Fastify API  ◄──────────────────┘
```

The asynchronous worker of Strategy A does two jobs: it runs the ingestors, whose
output goes to the review queue, and it runs the projection that copies published
records into the graph. Memgraph can be emptied and rebuilt from Postgres at any
time, which also makes it safe to lose.

## The graph

One anchor label, `Entity`, with a second label for the kind of thing, as the
proposal has it. Node ids are the Postgres ids.

| Relationship | From → to | Carries | Exists in the data today |
|--------------|-----------|---------|--------------------------|
| `INVESTED_IN` | Investor → company | Stage, amount, currency, date and its precision, lead | Yes: 37 links from 36 rounds |
| `ACCELERATED_AT` | Company → accelerator or hub | Programme name, cohort year | Table exists; no real rows yet |
| `ORGANISED` | Organisation → event | — | Table exists; no real events yet |
| `HAS_ROLE` | Person → organisation | Role | Yes: 134 founders |
| `LOCATED_IN` | Organisation → city → country | Precision | Yes |
| `IN_SECTOR` | Organisation → sector | — | Yes |
| `FOUNDER_ALMA_MATER` | Person → university | — | No data, and see the open questions |

On start-up: a uniqueness constraint on `Entity.id` and a point index on
`Entity.location`. The proposal's `CREATE INDEX ON :Entity(location)` creates an
ordinary index; the statement for a spatial point index should be checked against
the Memgraph version chosen before it is relied on.

## Corrections to the proposal's sample code

To carry into the real implementation:

- The relationship type is pasted into the query text. It must come from a fixed
  list, never from a data file, or a crafted value could run its own Cypher.
- One transaction per row will be slow for a large file. Send rows in batches
  with `UNWIND`.
- A plain `open()` and `csv` loop inside an `async` function blocks the worker.
- Every node is given coordinates by whichever source mentions it last. Location
  must come from the office record in Postgres.
- The sample makes ids from source-specific prefixes (`hub_12`, `st_40`). Two
  sources naming the same organisation would create two nodes. Matching to an
  existing record (by website, name and other names) already exists in the
  importer and has to run before anything reaches the graph.

## Consequences

- **Cost.** This departs from ADR 0002, which kept every component free. Railway
  is a paid host once its trial credit is spent, and Memgraph holds the graph in
  memory and needs a persistent volume. The owner has chosen this; the plan
  should carry a monthly budget once Railway's current prices are checked.
- **Hosting.** Railway can also run the API, the worker and Postgres, which would
  settle the open hosting question in ADR 0002 in one place.
- **Scale today.** The graph is small: about 120 organisations and under 200
  relationships. Postgres answers neighbourhood and path questions at this size
  without strain. Memgraph is being adopted for where the data is going, not for
  a problem that exists now, so the graph API is specified so that the web app
  cannot tell which store answered.
- **Viewport loading.** The proposal's second phase has the map ask the API for
  markers inside the current view after each move. The map currently loads each
  layer once as a static file and clusters in the browser, which is why it works
  with the API down. That stays until a layer passes about 50,000 points.

## Open questions for the owner

1. **Pitch decks are confidential documents.** Where do they come from, who has
   agreed to their use, and may their text be sent to a hosted model? Nothing
   about a deck should be published without the company's consent.
2. **Founders' universities are personal data** of a kind the product has so far
   avoided: people appear only in a role at an organisation. `FOUNDER_ALMA_MATER`
   needs a decision before any such data is loaded.
3. **Budget** for Railway and Memgraph per month.
4. **Which external APIs and which other databases** are to be connected. None is
   named in the proposal.
