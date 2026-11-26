import json

import psycopg
import pytest

from atlas_workers import config
from atlas_workers.confidence import assess
from atlas_workers.extract import ExtractionResult, Value
from atlas_workers.extract.rules import RuleExtractor
from atlas_workers.news import read_news
from atlas_workers.store import LocalStorage, RawStore

KNOWN = {"tiny-pay": "00000000-0000-0000-0000-000000000001"}


def result(amount=500_000, currency="USD", company="Tiny Pay", rejected=(), investors=("Example Ventures",)):
    v = lambda x: Value(x, str(x))  # noqa: E731
    return ExtractionResult(
        True, v(company), v(amount) if amount is not None else None, v(currency) if currency else None, v("seed"),
        [v(i) for i in investors], list(rejected),
    )


def blockers(**kwargs):
    return assess(result(**kwargs), "2026-10-06", "https://news.test/x", KNOWN).blockers


def test_a_fully_read_small_round_for_a_known_company_may_skip_a_reviewer():
    found = assess(result(), "2026-10-06", "https://news.test/x", KNOWN)
    assert found.score == 1.0 and found.auto_approvable and found.company_id == KNOWN["tiny-pay"]


def test_a_round_above_a_million_dollars_always_needs_a_person():
    assert blockers(amount=1_000_000) == []
    assert any("above USD 1 million" in b for b in blockers(amount=1_000_001))


@pytest.mark.parametrize(
    "kwargs, reason",
    [
        ({"company": "Unknown Ltd"}, "not a single published record"),
        ({"amount": None, "currency": None}, "not stated"),
        ({"currency": "KES"}, "not US dollars"),
        ({"rejected": ["stage"]}, "does not support"),
    ],
)
def test_anything_unclear_needs_a_person(kwargs, reason):
    assert any(reason in b for b in blockers(**kwargs))


def test_a_low_score_needs_a_person_even_when_every_other_test_passes():
    found = assess(result(investors=()), None, "https://news.test/x", KNOWN)
    assert found.score == 0.85 and found.auto_approvable
    found = assess(result(investors=(), rejected=["investors"]), None, "https://news.test/x", KNOWN)
    assert not found.auto_approvable


@pytest.fixture
def db(tmp_path):
    try:
        conn = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    yield conn, RawStore(conn, LocalStorage(tmp_path))
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("delete from funding_round where organisation_id in (select id from organisation where slug = 'tiny-pay-test')")
        cur.execute("delete from audit_log where record_type = 'funding_round' and actor is null and record_id not in (select id from funding_round)")
        cur.execute("delete from review_item where payload->>'url' like 'https://news.test/auto-%'")
        cur.execute("delete from raw_document where url like 'https://news.test/auto-%'")
        cur.execute("delete from organisation where slug = 'tiny-pay-test'")
    conn.commit()
    conn.close()


def entry(slug, title):
    return {"source": "t", "url": f"https://news.test/auto-{slug}", "published": "Tue, 06 Oct 2026 09:30:00 +0000", "title": title, "text": "x"}


def test_auto_approval_is_off_unless_asked_for_and_publishes_only_what_passes(db):
    conn, store = db
    with conn.cursor() as cur:
        cur.execute("insert into organisation (name, slug, types, status) values ('Tiny Pay Test', 'tiny-pay-test', '{startup}', 'published')")
    conn.commit()
    for e in (entry("small", "Tiny Pay Test raises $500,000 seed round"), entry("big", "Tiny Pay Test raises $5 million Series A")):
        store.put(e["url"], json.dumps(e).encode())

    # Without the flag, both wait for a person.
    outcome, _ = read_news(conn, store, RuleExtractor(), apply=True)
    assert outcome.proposed == 2 and outcome.auto_approved == 0
    with conn.cursor() as cur:
        cur.execute("select count(*) from funding_round where organisation_id = (select id from organisation where slug = 'tiny-pay-test')")
        assert cur.fetchone()[0] == 0
        cur.execute("delete from news_extraction where document_id in (select id from raw_document where url like 'https://news.test/auto-%')")
        cur.execute("delete from review_item where payload->>'url' like 'https://news.test/auto-%'")
    conn.commit()

    outcome, _ = read_news(conn, store, RuleExtractor(), apply=True, auto_approve=True)
    assert (outcome.proposed, outcome.auto_approved) == (2, 1)
    with conn.cursor() as cur:
        cur.execute("select amount_original, status::text from funding_round where organisation_id = (select id from organisation where slug = 'tiny-pay-test')")
        assert cur.fetchall() == [(500000, "published")]
        cur.execute(
            "select payload->>'url', status::text, reviewed_by, payload->>'auto_approved' from review_item "
            "where payload->>'url' like 'https://news.test/auto-%' order by 1"
        )
        assert cur.fetchall() == [("https://news.test/auto-big", "pending", None, None), ("https://news.test/auto-small", "approved", None, "true")]
