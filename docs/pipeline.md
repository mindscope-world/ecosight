# The daily pipeline

`atlas run-daily` does three things in order and records the run in `pipeline_run`:

1. **Crawl** every feed in `workers/src/atlas_workers/sources.py` (a source failing does not stop the others).
2. **Read** the stored entries with the news extractor and queue the funding rounds they report (`atlas extract-news`; `--auto-approve` is passed through, off by default).
3. **Flag stale records** (`atlas flag-stale`): a published organisation none of whose facts has been verified for 12 months gets `stale_since`, and the app says so on its card. Nothing is hidden. Confirming a fact clears the flag on the next run.

Each step's counts are stored in the run's `stats`. The command exits 1 unless everything succeeded.

## Health checks and alerts

`atlas health` reads the recent runs and exits 1, printing why, when:

- no run has ever happened, or none has finished in 36 hours;
- a run has been going for more than 3 hours;
- the last run ended `partial` or `failed` (with the step and error);
- a source failed its last 3 runs, or stored nothing new over 7 runs.

If `ALERT_WEBHOOK_URL` is set it also posts the problems there (a Slack, Mattermost or Discord-style webhook). Run it on a different schedule from the pipeline, so a pipeline that stops running is still noticed.

## Scheduling

`.github/workflows/pipeline.yml` runs both on GitHub Actions. **The schedule is commented out** until:

- the publishers' terms have been read (6.3, `docs/sources.md`);
- `CRAWLER_USER_AGENT` has a working contact address (2.7);
- the repository secrets `DATABASE_URL`, `GROQ_API_KEY` and optionally `ALERT_WEBHOOK_URL` exist.

Until then, start it by hand from the Actions tab, or from cron on any machine: `cd workers && uv run atlas run-daily`.

**Limit:** the raw document store is a directory. On a runner it exists only for that run, so an entry the extractor did not get to (the model's daily allowance ran out) cannot be read next time and is counted as unreadable. Move the store to a bucket (`store.py` is written for it) before relying on a runner.
