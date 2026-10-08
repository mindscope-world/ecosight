import json
from datetime import date

import psycopg
import pytest

from atlas_workers import config
from atlas_workers.extract.rules import RuleExtractor
from atlas_workers.news import published_on, read_news, summarise
from atlas_workers.store import LocalStorage, RawStore


def test_a_feed_date_is_read_in_either_spelling():
    assert published_on("Tue, 06 Oct 2026 09:30:00 +0000") == date(2026, 10, 6)
    assert published_on("2026-10-06T09:30:00Z") == date(2026, 10, 6)
    assert published_on("yesterday") is None and published_on(None) is None


ENTRIES = [
    {
        "source": "test-feed", "url": "https://news.test/sample-pay-raises", "published": "Tue, 06 Oct 2026 09:30:00 +0000",
        "title": "Kenyan fintech Sample Pay raises $2.5 million seed round",
        "text": "Sample Pay has raised a seed round led by Example Ventures and Other Capital, with angels taking part.",
    },
    {"source": "test-feed", "url": "https://news.test/market", "published": None, "title": "58 startups raise $583m in a record quarter", "text": "A summary."},
    {"source": "test-feed", "url": "https://news.test/launch", "published": None, "title": "Sample Pay launches in Uganda", "text": "No money was raised."},
]


@pytest.fixture
def stored(tmp_path):
    try:
        conn = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    store = RawStore(conn, LocalStorage(tmp_path))
    for entry in ENTRIES:
        store.put(entry["url"], json.dumps(entry, sort_keys=True).encode())
    yield conn, store
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("delete from review_item where payload->>'import' = 'news' and payload->>'url' like 'https://news.test/%'")
        cur.execute("delete from raw_document where url like 'https://news.test/%'")
    conn.commit()
    conn.close()


def mine(conn):
    with conn.cursor() as cur:
        cur.execute(
            "select r.payload, r.status::text, r.method::text, r.record_id from review_item r "
            "where r.payload->>'import' = 'news' and r.payload->>'url' like 'https://news.test/%'"
        )
        return cur.fetchall()


def test_a_reported_round_waits_in_the_review_queue_and_nothing_is_published(stored):
    conn, store = stored
    # A dry run reads and reports, and leaves no trace.
    outcome, proposals = read_news(conn, store, RuleExtractor(), apply=False)
    assert (outcome.read, outcome.proposed) == (3, 1) and mine(conn) == []
    assert "Sample Pay" in summarise(outcome, proposals) and "USD 2,500,000" in summarise(outcome, proposals)

    outcome, _ = read_news(conn, store, RuleExtractor(), apply=True)
    assert (outcome.read, outcome.proposed) == (3, 1)
    ((payload, status, method, record_id),) = mine(conn)
    assert (status, method, record_id) == ("pending", "ai", None)
    assert payload["company"] == {"value": "Sample Pay", "quote": "Sample Pay"}
    assert payload["amount"]["value"] == 2_500_000 and payload["currency"]["value"] == "USD"
    assert payload["stage"]["value"] == "seed" and payload["published"] == "2026-10-06"
    assert [investor["value"] for investor in payload["investors"]] == ["Example Ventures", "Other Capital"]
    assert (payload["url"], payload["extractor"]) == ("https://news.test/sample-pay-raises", "rules")
    with conn.cursor() as cur:
        cur.execute("select count(*) from funding_round r join review_item v on v.record_id = r.id where v.payload->>'import' = 'news'")
        assert cur.fetchone()[0] == 0
        cur.execute(
            "select count(*), count(*) filter (where e.is_funding), count(e.review_item_id) from news_extraction e "
            "join raw_document d on d.id = e.document_id where d.url like 'https://news.test/%'"
        )
        assert cur.fetchone() == (3, 1, 1)

    # Every document has been read, so a second run finds nothing to do.
    outcome, _ = read_news(conn, store, RuleExtractor(), apply=True)
    assert (outcome.read, outcome.proposed) == (0, 0) and len(mine(conn)) == 1
