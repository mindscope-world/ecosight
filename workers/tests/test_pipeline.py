import json
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from atlas_workers import config
from atlas_workers.extract.rules import RuleExtractor
from atlas_workers.pipeline import check_health, run_daily
from atlas_workers.sources import FeedSource
from atlas_workers.stale import flag_stale
from atlas_workers.store import LocalStorage, RawStore

NOW = datetime(2027, 6, 1, tzinfo=timezone.utc)


@pytest.fixture
def conn():
    try:
        c = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    # Runs are shared state; these tests need to start from none and put back whatever was there.
    with c.cursor() as cur:
        cur.execute("create temp table saved_runs as select * from pipeline_run")
        cur.execute("delete from pipeline_run")
    c.commit()
    yield c
    c.rollback()
    with c.cursor() as cur:
        cur.execute("delete from pipeline_run")
        cur.execute("insert into pipeline_run select * from saved_runs")
        cur.execute("delete from organisation where slug like 'stale-test-%'")
    c.commit()
    c.close()


def run(conn, hours_ago, status="ok", stats=None, finished=True):
    start = NOW - timedelta(hours=hours_ago)
    with conn.cursor() as cur:
        cur.execute(
            "insert into pipeline_run (started_at, finished_at, status, stats) values (%s, %s, %s, %s)",
            (start, start + timedelta(minutes=5) if finished else None, status, json.dumps(stats or {})),
        )


def crawl(**sources):
    return {"crawl": sources}


def test_a_pipeline_that_never_ran_is_reported(conn):
    assert check_health(conn, NOW) == ["The pipeline has never run"]


def test_a_recent_good_run_is_healthy_and_an_old_one_is_not(conn):
    run(conn, 5, stats=crawl(a={"entries": 10, "new": 2, "error": None}))
    assert check_health(conn, NOW) == []
    run(conn, 0.1, "ok")  # newest finished run is what counts
    assert check_health(conn, NOW) == []
    conn.execute("delete from pipeline_run")
    run(conn, 50)
    assert "No run has finished in 36 hours" in check_health(conn, NOW)[0]


def test_a_failed_or_stuck_run_says_why(conn):
    run(conn, 4, "partial", {"crawl": {"a": {"entries": 0, "new": 0, "error": "HTTPStatusError: 503"}}, "news": {"stopped": "RateLimit"}})
    run(conn, 3.5, finished=False, status="running")
    problems = check_health(conn, NOW)
    assert any("has not finished" in p for p in problems)
    assert any("ended partial" in p and "a: HTTPStatusError: 503" in p and "stopped early" in p for p in problems)


def test_a_source_that_keeps_failing_or_goes_quiet_is_named(conn):
    bad = {"entries": 0, "new": 0, "error": "Timeout"}
    for hours in (26, 50, 74):
        run(conn, hours - 25, stats=crawl(a=bad, b={"entries": 10, "new": 1, "error": None}))
    problems = check_health(conn, NOW)
    assert any(p.startswith("Source a has failed 3 runs in a row") for p in problems)
    assert not any("Source b" in p for p in problems)
    conn.execute("delete from pipeline_run")
    for hours in range(7):
        run(conn, 1 + hours * 24, stats=crawl(q={"entries": 10, "new": 0, "error": None}))
    assert any("Source q has stored nothing new in 7 runs" in p for p in check_health(conn, NOW))


def test_a_daily_run_isolates_failures_and_records_what_each_step_did(conn, tmp_path):
    class Client:
        def get(self, url, **kwargs):
            raise OSError("no network in tests")

    source = FeedSource("broken", "Broken", "https://news.test/feed", delay=0)
    status, stats = run_daily(conn, RawStore(conn, LocalStorage(tmp_path)), Client(), (source,), RuleExtractor())
    # The crawl failed, but the reading and the stale check still ran.
    assert status == "partial"
    assert "OSError" in stats["crawl"]["broken"]["error"]
    assert "read" in stats["news"] and "stale" in stats["stale"]
    with conn.cursor() as cur:
        cur.execute("select status, finished_at is not null from pipeline_run")
        assert cur.fetchall() == [("partial", True)]
    assert any("ended partial" in p for p in check_health(conn))


def org(conn, slug, status="published", created="2025-01-01", verified=None):
    with conn.cursor() as cur:
        cur.execute(
            "insert into organisation (name, slug, types, status, created_at) values (%s, %s, '{startup}', %s, %s) returning id",
            (slug, slug, status, created),
        )
        org_id = cur.fetchone()[0]
        if verified:
            cur.execute(
                "insert into field_source (record_type, record_id, field, method, verified_at) values ('organisation', %s, 'name', 'manual', %s)",
                (org_id, verified),
            )
    return org_id


def stale_of(conn, org_id):
    with conn.cursor() as cur:
        cur.execute("select stale_since from organisation where id = %s", (org_id,))
        return cur.fetchone()[0]


def test_an_organisation_unconfirmed_for_a_year_is_flagged_and_confirming_it_clears_the_flag(conn):
    old = org(conn, "stale-test-old")  # added 2025, never verified
    checked = org(conn, "stale-test-checked", created="2025-01-01", verified="2027-01-15")  # re-checked recently
    draft = org(conn, "stale-test-draft", status="draft")
    before = flag_stale(conn, apply=False, now=NOW)
    assert stale_of(conn, old) is None  # a dry run writes nothing
    report = flag_stale(conn, apply=True, now=NOW)
    assert report.flagged >= 1 and report.flagged == before.flagged
    assert stale_of(conn, old) is not None
    assert stale_of(conn, checked) is None and stale_of(conn, draft) is None

    # Running again flags nothing new; confirming a fact clears the flag.
    assert flag_stale(conn, apply=True, now=NOW).flagged == 0
    conn.execute(
        "insert into field_source (record_type, record_id, field, method, verified_at) values ('organisation', %s, 'name', 'manual', '2027-05-20')",
        (old,),
    )
    assert flag_stale(conn, apply=True, now=NOW).cleared >= 1
    assert stale_of(conn, old) is None
