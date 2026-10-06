# Datasets

Researched datasets that are loaded into ecoSight. Each one sits in its own
folder, named for what it covers and the date of the research.

The data files themselves are **not in git**. They hold people's names and
business contact details, the repository is public, and whether their sources
allow republishing has not been confirmed. Only this page is tracked. Keep your
own copy of the files; a fresh clone will not have them.

| Folder | Contents | Status |
|--------|----------|--------|
| `nairobi-startups-2026-10-06/` | `nairobi_startups_organisations_100.csv`: 100 researched Nairobi startups and newer organisations. The `.xlsx` is the same data with a summary sheet and a one-link-per-row source register. `dataset-guide.pdf` explains the fields and verification labels | Loaded. 69 verified rows published, 31 kept as drafts |
| `nairobi-investors-2026-10-07/` | `nairobi_vc_accelerator_dataset_2026-10-07.csv`: 25 venture capital firms, impact investors and accelerators with a Nairobi presence | Not loaded yet |

Work derived from a dataset by hand lives in `curation/`, which is tracked: for
example the funding rounds read out of the startups dataset's funding notes.

## Loading

From `workers/`:

```sh
uv run atlas import-orgs ../datasets/nairobi-startups-2026-10-06/nairobi_startups_organisations_100.csv --snapshot 2026-10-06          # dry run
uv run atlas import-orgs ../datasets/nairobi-startups-2026-10-06/nairobi_startups_organisations_100.csv --snapshot 2026-10-06 --apply
uv run atlas import-rounds ../curation/nairobi_startups_funding_rounds.json --apply
```

The importer identifies a dataset by its file name, so a file can move between
folders without being treated as a new dataset. Do not rename a file that has
already been loaded.

## Adding a dataset

1. Make a folder `<place>-<what>-<research date>/` and put the file in it.
2. Add a row to the table above.
3. If its column headings differ from the first dataset's, write a mapping file
   beside it and pass it with `--mapping` (see the README at the repo root).
4. Run a dry run and read `data/import-report.md` before loading.
