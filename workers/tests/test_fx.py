from datetime import date

import httpx
import psycopg
import pytest

from atlas_workers import config
from atlas_workers.fx import Rates, apply, period, plan, summarise

TODAY = date(2026, 10, 7)


def test_a_date_stands_for_as_much_as_its_precision_says():
    assert period(date(2023, 1, 1), "year", TODAY) == (date(2023, 1, 1), date(2023, 12, 31))
    assert period(date(2024, 2, 1), "month", TODAY) == (date(2024, 2, 1), date(2024, 2, 29))
    assert period(date(2024, 2, 14), "day", TODAY) == (date(2024, 2, 14), date(2024, 2, 14))
    # A period still running ends today: there are no rates for days that have not happened.
    assert period(date(2026, 1, 1), "year", TODAY) == (date(2026, 1, 1), TODAY)


def rates(tmp_path, answers: dict[str, httpx.Response]) -> tuple[Rates, list[str]]:
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(f"{request.url.path}?base={request.url.params['base']}")
        return answers.get(request.url.path, httpx.Response(404))

    return Rates(tmp_path / "fx.json", httpx.Client(transport=httpx.MockTransport(handler))), asked


def test_rates_are_averaged_over_a_period_and_cached(tmp_path):
    year = httpx.Response(200, json={"rates": {"2023-01-02": {"USD": 0.70}, "2023-01-03": {"USD": 0.80}}})
    day = httpx.Response(200, json={"rates": {"USD": 0.75}})
    book, asked = rates(tmp_path, {"/v1/2023-01-01..2023-12-31": year, "/v1/2024-02-14": day})
    assert book.to_usd("CAD", date(2023, 1, 1), date(2023, 12, 31)) == pytest.approx(0.75)
    assert book.to_usd("CAD", date(2024, 2, 14), date(2024, 2, 14)) == 0.75
    # A currency the service does not cover has no rate, and that answer is remembered too.
    assert book.to_usd("KES", date(2024, 2, 15), date(2024, 2, 15)) is None
    assert book.to_usd("KES", date(2024, 2, 15), date(2024, 2, 15)) is None
    assert book.to_usd("CAD", date(2023, 1, 1), date(2023, 12, 31)) == pytest.approx(0.75)
    assert len(asked) == 3


@pytest.fixture
def conn():
    try:
        connection = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    with connection.cursor() as cur:
        cur.execute("insert into organisation (name, slug, types, status) values ('Fx Startup', 'fx-startup', '{startup}', 'published') returning id")
        org = cur.fetchone()[0]
        for amount, currency, usd, when, precision in (
            (1_000_000, "CAD", None, "2023-01-01", "year"),
            (500_000, "KES", None, "2024-02-14", "day"),
            (2_000_000, "USD", 2_000_000, "2024-03-01", "month"),
        ):
            cur.execute(
                "insert into funding_round (organisation_id, amount_original, currency, amount_usd, announced_on, announced_precision, status) "
                "values (%s, %s, %s, %s, %s, %s, 'published')",
                (org, amount, currency, usd, when, precision),
            )
    connection.commit()
    yield connection
    connection.rollback()
    with connection.cursor() as cur:
        cur.execute("delete from field_source where source_url = 'https://frankfurter.dev' and record_id in (select r.id from funding_round r join organisation g on g.id = r.organisation_id where g.slug = 'fx-startup')")
        cur.execute("delete from organisation where slug = 'fx-startup'")
    connection.commit()
    connection.close()


def test_rounds_in_other_currencies_get_a_dollar_figure_with_its_basis(conn, tmp_path):
    year = httpx.Response(200, json={"rates": {"2023-01-02": {"USD": 0.70}, "2023-01-03": {"USD": 0.80}}})
    book, _ = rates(tmp_path, {"/v1/2023-01-01..2023-12-31": year})
    mine = lambda items: [item for item in items if item.organisation == "Fx Startup"]  # noqa: E731

    conversions = mine(plan(conn, book, TODAY))
    # The dollar round is not touched; the shilling round has no rate and is left as it is.
    assert [(item.currency, item.usd) for item in conversions] == [("CAD", 750_000.0), ("KES", None)]
    assert "CAD 1,000,000" in summarise(conversions) and "no rate available" in summarise(conversions)

    apply(conn, conversions, "2026-10-07")
    # Running again finds the round it converted, so a corrected rate would replace the old figure.
    again = mine(plan(conn, book, TODAY))
    assert [item.currency for item in again] == ["CAD", "KES"]
    apply(conn, again, "2026-10-07")

    with conn.cursor() as cur:
        cur.execute(
            """
            select r.currency, r.amount_original::float8, r.amount_usd::float8, r.fx_rate::float8, s.quote
            from funding_round r join organisation g on g.id = r.organisation_id and g.slug = 'fx-startup'
            left join field_source s on s.record_id = r.id and s.field = 'amount_usd'
            order by r.currency
            """
        )
        rows = cur.fetchall()
    assert [row[:4] for row in rows] == [
        ("CAD", 1_000_000.0, 750_000.0, 0.75),
        ("KES", 500_000.0, None, None),
        ("USD", 2_000_000.0, 2_000_000.0, None),
    ]
    assert rows[0][4] == (
        "Converted from CAD 1,000,000 at 0.7500 US dollars to one CAD, "
        "the European Central Bank reference rate averaged over 2023-01-01 to 2023-12-31."
    )
