import json

import psycopg
import pytest

from atlas_workers import config
from atlas_workers.rounds import apply, check_against_database, read_file, summarise

NOTE = "TechCrunch reported a $1 million seed round in March 2022, led by Example Ventures. Earlier grant undated."


def write(tmp_path, **changes):
    row = {
        "record": 901, "organisation": "Sample Pay", "stage": "seed", "amount": 1000000, "currency": "USD",
        "date": "2022-03", "precision": "month",
        "investors": [{"name": "Example Ventures", "lead": True}],
        "quote": "a $1 million seed round in March 2022, led by Example Ventures",
        **changes,
    }
    doc = {"dataset": "test_rounds_dataset", "snapshot": "2026-10-06", "investors": {"Example Ventures": "fund"}, "rounds": [row]}
    path = tmp_path / "rounds.json"
    path.write_text(json.dumps(doc))
    return path


def test_a_well_formed_file_has_no_problems(tmp_path):
    doc, rounds, problems = read_file(write(tmp_path))
    assert problems == []
    assert rounds[0].announced_on == "2022-03-01"
    assert "Sample Pay" in summarise(doc, rounds) and "*Example Ventures" in summarise(doc, rounds)


@pytest.mark.parametrize(
    "changes, problem",
    [
        ({"stage": "series-z"}, "unknown stage"),
        ({"currency": None}, "amount and currency"),
        ({"date": "2022-13"}, "is not a month"),
        ({"date": "2022", "precision": "day"}, "is not a day"),
        ({"precision": None}, "date and precision"),
        ({"amount": None, "currency": None, "date": None, "precision": None}, "needs an amount"),
        ({"quote": " "}, "no quote"),
        ({"investors": [{"name": "Unlisted Capital"}]}, "has no type"),
    ],
)
def test_malformed_rounds_are_reported(tmp_path, changes, problem):
    _, _, problems = read_file(write(tmp_path, **changes))
    assert any(problem in line for line in problems), problems


def test_dates_keep_their_stated_precision(tmp_path):
    _, rounds, problems = read_file(write(tmp_path, date="2021", precision="year"))
    assert problems == [] and rounds[0].announced_on == "2021-01-01"
    _, rounds, _ = read_file(write(tmp_path, date="2023-02-14", precision="day"))
    assert rounds[0].announced_on == "2023-02-14"


@pytest.fixture
def conn():
    try:
        connection = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    with connection.cursor() as cur:
        cur.execute(
            "insert into organisation (name, slug, types, status) values ('Sample Pay Rounds', 'sample-pay-rounds', '{startup}', 'published') returning id"
        )
        org_id = cur.fetchone()[0]
        payload = {"import": "test_rounds_dataset", "record": 901, "fields": {"funding_details": NOTE, "source_funding": "https://rounds.test/a; https://rounds.test/b"}}
        cur.execute(
            "insert into review_item (record_type, record_id, payload, method, status) values ('organisation', %s, %s, 'manual', 'approved')",
            (org_id, json.dumps(payload)),
        )
    connection.commit()
    yield connection
    connection.rollback()
    with connection.cursor() as cur:
        cur.execute("delete from field_source where source_url like 'https://rounds.test/%'")
        cur.execute("delete from organisation where slug in ('sample-pay-rounds', 'example-ventures')")
        cur.execute("delete from review_item where payload->>'import' like 'test_rounds_dataset%'")
    connection.commit()
    connection.close()


def test_quotes_must_come_from_the_stored_note(conn, tmp_path):
    doc, rounds, _ = read_file(write(tmp_path))
    _, problems = check_against_database(conn, doc["dataset"], rounds)
    assert problems == []

    _, invented, _ = read_file(write(tmp_path, quote="a $5 million Series A"))
    assert "quote is not in" in check_against_database(conn, doc["dataset"], invented)[1][0]
    _, missing, _ = read_file(write(tmp_path, record=999))
    assert "was not loaded" in check_against_database(conn, doc["dataset"], missing)[1][0]


def test_loading_twice_leaves_one_copy(conn, tmp_path):
    doc, rounds, _ = read_file(write(tmp_path))
    orgs, _ = check_against_database(conn, doc["dataset"], rounds)
    apply(conn, doc, rounds, orgs)
    apply(conn, doc, rounds, orgs)
    with conn.cursor() as cur:
        cur.execute(
            """
            select r.stage, r.amount_usd, r.announced_on::text, r.announced_precision, i.name, ri.is_lead, s.source_url, s.quote
            from funding_round r
            join organisation g on g.id = r.organisation_id and g.slug = 'sample-pay-rounds'
            join round_investor ri on ri.round_id = r.id join organisation i on i.id = ri.investor_id
            join field_source s on s.record_type = 'funding_round' and s.record_id = r.id
            """
        )
        loaded = cur.fetchall()
        cur.execute("select count(*), min(types::text) from organisation where slug = 'example-ventures'")
        investors = cur.fetchone()
    assert len(loaded) == 1
    stage, usd, on, precision, investor, lead, source, quote = loaded[0]
    assert (stage, float(usd), on, precision, investor, lead) == ("seed", 1_000_000, "2022-03-01", "month", "Example Ventures", True)
    assert source == "https://rounds.test/a" and quote.startswith("a $1 million seed round")
    assert investors == (1, "{fund}")
    with conn.cursor() as cur:
        cur.execute(
            "select s.source_url from field_source s join organisation g on g.id = s.record_id where g.slug = 'example-ventures'"
        )
        assert cur.fetchall() == [("https://rounds.test/a",)]


def test_an_organisation_already_on_record_is_not_loaded_again(conn):
    from atlas_workers.importer import apply as load_orgs
    from atlas_workers.importer import match_existing, parse_row

    row = {"Startup / organisation": "Sample Pay Rounds (duplicate listing)", "Verification status": "verified", "Record #": "1"}
    record = parse_row(row)
    match_existing(conn, [record], "another_dataset")
    assert record.existing == "Sample Pay Rounds"

    load_orgs(conn, [record], "another_dataset", "2026-10-06", replace_sample=False)
    with conn.cursor() as cur:
        cur.execute("select count(*) from organisation where slug = 'sample-pay-rounds'")
        assert cur.fetchone()[0] == 1

    # Seen from its own import, the same record is not a duplicate of itself.
    own = parse_row(row)
    match_existing(conn, [own], "test_rounds_dataset")
    assert own.existing is None
