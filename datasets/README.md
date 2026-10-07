# Datasets

Researched datasets that are loaded into ecoSight. Each one sits in its own
folder, named for what it covers and the date of the research.

The data files themselves are **not in git**, and must not be added. The data may
not be published, and the repository is public. Only this page is tracked. Keep your
own copy of the files; a fresh clone will not have them.

| Folder | Contents | Status |
|--------|----------|--------|
| `nairobi-startups-2026-10-06/` | `nairobi_startups_organisations_100.csv`: 100 researched Nairobi startups and newer organisations. The `.xlsx` is the same data with a summary sheet and a one-link-per-row source register. `dataset-guide.pdf` explains the fields and verification labels | Loaded. 69 verified rows published, 31 kept as drafts |
| `nairobi-investors-2026-10-07/` | `nairobi_vc_accelerator_dataset_2026-10-07.csv`: 25 venture capital firms, impact investors and accelerators with a Nairobi presence. Read through `curation/nairobi_vc_accelerator_dataset_2026-10-07.mapping.json` | Loaded. 23 published, 2 kept as drafts; 5 were merged into investors already on record |
| `east-africa-2026-10-07/` | `east_africa_100_organizations.csv`: 100 universities, public bodies, NGOs and innovation hubs in Kenya, Uganda, Tanzania, Rwanda, Ethiopia, Burundi, Somalia, South Sudan and Djibouti. The `.xlsx` is the same data; the `.md` describes the columns. Read through `curation/east_africa_100_organizations.mapping.json` | Loaded. 96 published, 4 kept as drafts; 5 were merged into organisations already on record |
| `africa-health-sources-2026-10-07/` | `African_Healthtech_100.csv`: 100 health technology organisations in 17 African countries. `African_Healthtech_Sources.csv` is its source register, one link per row, which the organisations file cites by ID. The `.xlsx` is the same data. Read through `curation/African_Healthtech_100.mapping.json` | Loaded. 84 published, 16 kept as drafts. 51 funding rounds read from it |

Work derived from a dataset by hand lives in `curation/`: the funding rounds read
out of the startups and health technology datasets' funding notes, the mapping files
for the other datasets, and the cities of investors abroad. It is kept out of git for the same
reason as the datasets. Keep your own copy of it too.

## Loading

From `workers/`:

```sh
uv run atlas import-orgs ../datasets/nairobi-startups-2026-10-06/nairobi_startups_organisations_100.csv --snapshot 2026-10-06          # dry run
uv run atlas import-orgs ../datasets/nairobi-startups-2026-10-06/nairobi_startups_organisations_100.csv --snapshot 2026-10-06 --apply
uv run atlas import-rounds ../curation/nairobi_startups_funding_rounds.json --apply
uv run atlas import-orgs ../datasets/nairobi-investors-2026-10-07/nairobi_vc_accelerator_dataset_2026-10-07.csv \\
  --mapping ../curation/nairobi_vc_accelerator_dataset_2026-10-07.mapping.json --publish-all --snapshot 2026-10-07 --apply
uv run atlas import-orgs ../datasets/east-africa-2026-10-07/east_africa_100_organizations.csv \\
  --mapping ../curation/east_africa_100_organizations.mapping.json --publish-all --snapshot 2026-10-07 --apply
uv run atlas import-orgs ../datasets/africa-health-sources-2026-10-07/African_Healthtech_100.csv \\
  --mapping ../curation/African_Healthtech_100.mapping.json --publish-all --snapshot 2026-10-07 --apply
uv run atlas import-rounds ../curation/African_Healthtech_100_funding_rounds.json --apply
```

Load them in that order on an empty database. Each command can be run again safely.

The importer identifies a dataset by its file name, so a file can move between
folders without being treated as a new dataset. Do not rename a file that has
already been loaded.

## Relationships

A relationships file is a CSV with one tie per row:

| Column | Holds |
|--------|-------|
| `from` | An organisation's name, as it is on record or another name it goes by |
| `relation` | `part of`, `hosted by`, `member of`, `founded by`, `funded by` (or `backed by`), `partner of`, or `accelerated at` for a programme. The reverse wordings `hosts`, `founded`, `funds` and `invested in` are understood too |
| `to` | The other organisation |
| `label` | Optional. A few words on the tie; for a programme, its name |
| `source` | A link to where this is stated. A row without one is not published |
| `quote` | Optional. The words it rests on |

```sh
uv run atlas import-links ../curation/stated_relationships.csv --snapshot 2026-10-07          # dry run
uv run atlas import-links ../curation/stated_relationships.csv --snapshot 2026-10-07 --apply
```

After loading or reloading rounds, run `uv run atlas convert-rounds --apply` so rounds
reported in another currency count in dollar totals.

Load a relationships file after the organisations it names. A row is published when both
organisations are on record and published and it has a source. Any other row is
not loaded: it is put in the review queue with the reason. A funding round with a
stage, amount or date belongs in a rounds file instead.

## Adding a dataset

1. Make a folder `<place>-<what>-<research date>/` and put the file in it.
2. Add a row to the table above.
3. If its column headings differ from the first dataset's, write a mapping file
   beside it and pass it with `--mapping` (see the README at the repo root).
4. Run a dry run and read `data/import-report.md` before loading.
