import json

import psycopg
import pytest

from atlas_workers import config
from atlas_workers.rounds import apply, check_against_database, read_file, summarise

STATUS = "Series A (latest publicly evidenced stage: June 2023)"
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
        payload = {"import": "test_rounds_dataset", "record": 901, "fields": {"funding_status": STATUS, "funding_details": NOTE, "source_funding": "https://rounds.test/a; https://rounds.test/b"}}
        cur.execute(
            "insert into review_item (record_type, record_id, payload, method, status) values ('organisation', %s, %s, 'manual', 'approved')",
            (org_id, json.dumps(payload)),
        )
    connection.commit()
    yield connection
    connection.rollback()
    with connection.cursor() as cur:
        cur.execute("delete from field_source where source_url like 'https://rounds.test/%'")
        cur.execute("delete from city where name = 'Zurich'")
        cur.execute("delete from organisation where slug in ('sample-pay-rounds', 'example-ventures', 'example-ventures-africa')")
        cur.execute("delete from review_item where payload->>'import' like 'test_rounds_dataset%' or payload->>'import' = 'another_dataset'")
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


def test_a_date_can_be_read_from_the_funding_status(conn, tmp_path):
    # The amount is in one cell and its date in the other, so each is quoted from where it stands.
    dated = {"stage": None, "amount": 2000, "date": "2023-06", "investors": [], "quote": "Earlier grant undated", "date_quote": "June 2023"}
    doc, rounds, problems = read_file(write(tmp_path, **dated))
    assert problems == []
    orgs, problems = check_against_database(conn, doc["dataset"], rounds)
    assert problems == []
    apply(conn, doc, rounds, orgs)
    with conn.cursor() as cur:
        cur.execute("select quote from field_source where record_type = 'funding_round' and quote like 'Earlier grant%'")
        assert cur.fetchall() == [("Earlier grant undated … June 2023",)]

    # A round can be quoted from the status alone, but no quote runs from one cell into the other.
    _, whole, _ = read_file(write(tmp_path, quote="Series A (latest publicly evidenced stage: June 2023)"))
    assert check_against_database(conn, doc["dataset"], whole)[1] == []
    _, across, _ = read_file(write(tmp_path, quote="June 2023) TechCrunch reported"))
    assert "quote is not in" in check_against_database(conn, doc["dataset"], across)[1][0]
    _, invented, _ = read_file(write(tmp_path, **{**dated, "date_quote": "May 2021"}))
    assert "date quote is not in" in check_against_database(conn, doc["dataset"], invented)[1][0]
    _, _, problems = read_file(write(tmp_path, date=None, precision=None, date_quote="June 2023"))
    assert any("a date quote needs a date" in line for line in problems)


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


def test_an_organisation_already_on_record_is_merged_not_duplicated(conn, tmp_path):
    from atlas_workers.geocode import Place
    from atlas_workers.importer import apply as load_orgs
    from atlas_workers.importer import match_existing, parse_row

    # An investor known only from a funding round ...
    doc, rounds, _ = read_file(write(tmp_path))
    orgs, _ = check_against_database(conn, doc["dataset"], rounds)
    apply(conn, doc, rounds, orgs)

    # ... then listed by a later dataset under a fuller name, with an office.
    row = {
        "Startup / organisation": "Example Ventures Africa", "Type": "VC / accelerator", "Record #": "1",
        "Verification status": "verified", "Industry": "Fintech and logistics investor.",
        "Founders and public roles": "Ada Example — Co-founder and Partner | Ben Sample — Partner",
        "Sources": "Team — https://rounds.test/team || Contact — https://rounds.test/contact",
    }

    def load():
        record = parse_row(row)
        record.aliases = ["Example Ventures"]
        match_existing(conn, [record], "another_dataset")
        record.place, record.precision, record.address = Place(36.8, -1.26, "address", "x"), "address", "Sample House"
        load_orgs(conn, [record], "another_dataset", "2026-10-06", replace_sample=False)
        return record

    assert load().existing == "Example Ventures"
    load()  # a second run must not add a second office or person

    with conn.cursor() as cur:
        cur.execute(
            """
            select g.name, g.aliases, g.types::text, g.sectors, g.description,
              (select count(*) from office o where o.organisation_id = g.id),
              (select array_agg(name) from person_role p where p.organisation_id = g.id),
              (select count(*) from round_investor ri where ri.investor_id = g.id),
              (select count(*) from field_source s where s.record_id = g.id)
            from organisation g where g.slug in ('example-ventures', 'example-ventures-africa')
            """
        )
        found = cur.fetchall()
    assert len(found) == 1  # one organisation, not two
    name, aliases, types, sectors, description, offices, people, links, sources = found[0]
    assert (name, aliases) == ("Example Ventures Africa", ["Example Ventures"])
    assert set(types.strip("{}").split(",")) == {"fund", "accelerator"}
    assert sectors == ["fintech", "logistics"] and description == "Fintech and logistics investor."
    assert (offices, people, links) == (1, ["Ada Example"], 1)  # the round link survived
    assert sources == 3  # the round's source for its name, plus the dataset's two

    # Loading the rounds again finds it by its old name and leaves the office alone.
    apply(conn, doc, rounds, orgs)
    with conn.cursor() as cur:
        cur.execute("select count(*) from organisation where 'Example Ventures' = any(aliases) or slug = 'example-ventures'")
        assert cur.fetchone()[0] == 1
        cur.execute("select count(*) from office o join organisation g on g.id = o.organisation_id where g.slug = 'example-ventures-africa'")
        assert cur.fetchone()[0] == 1


def test_an_investor_with_no_office_is_placed_at_a_city(conn, tmp_path):
    import httpx

    from atlas_workers.geocode import Geocoder
    from atlas_workers.locations import apply as place, read_file as read_places, resolve, summarise

    doc, rounds, _ = read_file(write(tmp_path))
    orgs, _ = check_against_database(conn, doc["dataset"], rounds)
    apply(conn, doc, rounds, orgs)  # creates the investor "Example Ventures" with no office

    path = tmp_path / "places.json"
    path.write_text(json.dumps({"basis": "Test basis", "placements": [
        {"name": "Example Ventures", "city": "Zurich", "country": "ch"},
        {"name": "Nobody Capital", "city": "Zurich", "country": "CH"},
        {"name": "Sample Pay Rounds", "city": "Nowhere", "country": "CH"},
    ]}))
    zurich = {"lon": "8.54", "lat": "47.37", "category": "place", "type": "city", "display_name": "Zurich, Switzerland"}
    geo = Geocoder(tmp_path / "cache.json", httpx.Client(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=[zurich] if request.url.params["q"] == "Zurich" else []))), delay=0)

    for _ in range(2):  # a second run must not add a second office
        pdoc, placements = read_places(path)
        resolve(conn, placements, geo, "test_rounds_dataset/locations")
        place(conn, pdoc, placements, "test_rounds_dataset/locations")
    assert [item.problem for item in placements] == [
        None, "no organisation of this name is on record", "city not found: Nowhere, CH",
    ]
    assert "1 of 3 can be placed" in summarise(placements)

    with conn.cursor() as cur:
        cur.execute(
            """
            select o.city, o.country, o.precision::text, round(st_x(o.geom::geometry)::numeric, 2)::float8, s.quote, s.source_url
            from office o join organisation g on g.id = o.organisation_id and g.slug = 'example-ventures'
            join field_source s on s.record_id = g.id and s.field = 'office'
            """
        )
        assert cur.fetchall() == [("Zurich", "CH", "city", 8.54, "Test basis", None)]
