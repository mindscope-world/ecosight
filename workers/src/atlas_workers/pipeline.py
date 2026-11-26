"""The daily run, and the check that it is still happening.

`run_daily` crawls every source, reads what was stored, and flags stale records. Each
step is isolated: one source failing, or the model running out of allowance, does not
stop the rest, and the run is recorded in `pipeline_run` with what every step did.
`check_health` reads those rows and says what is wrong, if anything; `notify` sends it
to a chat webhook. Scheduling is left to whatever runs `atlas run-daily` (see docs/pipeline.md).
"""

import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone

import httpx

from .crawl import crawl_feed
from .extract import Extractor
from .news import read_news
from .sources import FeedSource
from .stale import flag_stale
from .store import RawStore

# A run is overdue after this long; a source is quiet when it has stored nothing new over this many runs.
MAX_AGE = timedelta(hours=36)
STUCK_AFTER = timedelta(hours=3)
QUIET_RUNS = 7
FAILING_RUNS = 3


def run_daily(conn, store: RawStore, client, sources: tuple[FeedSource, ...], extractor: Extractor, auto_approve: bool = False) -> tuple[str, dict]:
    with conn.cursor() as cur:
        cur.execute("insert into pipeline_run default values returning id")
        run_id = cur.fetchone()[0]
    conn.commit()

    stats: dict = {"crawl": {}}
    problems = 0
    for source in sources:
        try:
            result = crawl_feed(source, store, client)
            stats["crawl"][source.id] = {"entries": result.entries, "new": result.new, "error": None}
        except Exception as error:  # noqa: BLE001 - any one source may fail in its own way
            stats["crawl"][source.id] = {"entries": 0, "new": 0, "error": f"{type(error).__name__}: {str(error)[:200]}"}
            problems += 1
    try:
        outcome, _ = read_news(conn, store, extractor, apply=True, auto_approve=auto_approve)
        stats["news"] = asdict(outcome)
        problems += outcome.stopped is not None
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        stats["news"] = {"error": f"{type(error).__name__}: {str(error)[:200]}"}
        problems += 1
    try:
        stats["stale"] = asdict(flag_stale(conn, apply=True))
    except Exception as error:  # noqa: BLE001
        conn.rollback()
        stats["stale"] = {"error": f"{type(error).__name__}: {str(error)[:200]}"}
        problems += 1

    everything_failed = problems and all(
        step.get("error") for step in (*stats["crawl"].values(), stats.get("news", {}), stats.get("stale", {}))
    )
    status = "failed" if everything_failed else "partial" if problems else "ok"
    with conn.cursor() as cur:
        cur.execute(
            "update pipeline_run set finished_at = now(), status = %s, stats = %s where id = %s",
            (status, json.dumps(stats), run_id),
        )
    conn.commit()
    return status, stats


def check_health(conn, now: datetime | None = None, kind: str = "daily") -> list[str]:
    """What is wrong with the pipeline, in words. Empty when it is healthy."""
    now = now or datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            "select started_at, finished_at, status, stats from pipeline_run where kind = %s order by started_at desc limit %s",
            (kind, QUIET_RUNS),
        )
        runs = cur.fetchall()
    if not runs:
        return ["The pipeline has never run"]

    problems = []
    started, finished, status, stats = runs[0]
    if finished is None and now - started > STUCK_AFTER:
        problems.append(f"The run started {started:%Y-%m-%d %H:%M} has not finished")
    done = [run for run in runs if run[1] is not None]
    if not done or now - done[0][1] > MAX_AGE:
        last = f"the last finished {done[0][1]:%Y-%m-%d %H:%M}" if done else "none has finished"
        problems.append(f"No run has finished in {int(MAX_AGE.total_seconds() // 3600)} hours ({last})")
    if done and done[0][2] != "ok":
        steps = done[0][3]
        failures = [f"{name}: {data['error']}" for name, data in steps.get("crawl", {}).items() if data.get("error")]
        failures += [f"{name}: {steps[name]['error']}" for name in ("news", "stale") if steps.get(name, {}).get("error")]
        if steps.get("news", {}).get("stopped"):
            failures.append(f"news: stopped early, {steps['news']['stopped']}")
        problems.append(f"The last run ended {done[0][2]}" + (": " + "; ".join(failures) if failures else ""))

    # A source that keeps failing, or has gone quiet, is noticed even while every run ends ok elsewhere.
    sources = {name for run in done for name in run[3].get("crawl", {})}
    for name in sorted(sources):
        history = [run[3].get("crawl", {}).get(name) for run in done]
        recent = [entry for entry in history if entry is not None]
        if len(recent) >= FAILING_RUNS and all(entry.get("error") for entry in recent[:FAILING_RUNS]):
            problems.append(f"Source {name} has failed {FAILING_RUNS} runs in a row: {recent[0]['error']}")
        elif len(recent) >= QUIET_RUNS and not any(entry.get("new") for entry in recent):
            problems.append(f"Source {name} has stored nothing new in {QUIET_RUNS} runs")
    return problems


def notify(problems: list[str], webhook_url: str) -> None:
    """Post the problems to a chat webhook. The `text` field is what Slack, Mattermost and Discord-compatible hooks read."""
    text = "ecoSight pipeline needs attention:\n" + "\n".join(f"• {problem}" for problem in problems)
    httpx.post(webhook_url, json={"text": text, "content": text}, timeout=15).raise_for_status()
