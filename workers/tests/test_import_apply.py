import psycopg
import pytest

from atlas_workers import config
from atlas_workers.importer import apply, parse_row

from test_importer import ROW

KEY = "test_apply_dataset"


@pytest.fixture
def conn():
    try:
        connection = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    yield connection
    connection.rollback()
    with connection.cursor() as cur:
        cur.execute("delete from organisation where slug in ('apply-checked', 'apply-unchecked', 'apply-doubtful')")
        cur.execute("delete from review_item where payload->>'import' = %s", (KEY,))
        cur.execute("delete from field_source where source_url like 'https://apply.test/%'")
        cur.execute("delete from app_user where email = 'apply-reviewer@apply.test'")
    connection.commit()
    connection.close()


def records():
    rows = []
    for number, (name, status) in enumerate(
        (("Apply Checked", "verified"), ("Apply Unchecked", "partially_verified"), ("Apply Doubtful", "not_verified")), 1
    ):
        row = {**ROW, "Record #": str(number), "Startup / organisation": name, "Verification status": status,
               "Official website": "", "Identity / Nairobi source URL": f"https://apply.test/{number}",
               "Location source URL": "", "Founder source URL": ""}
        rows.append(parse_row(row))
    return rows


def statuses(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            select g.slug, g.status::text, r.status::text, r.reviewed_by is not null, s.verified_at is not null
            from organisation g
            join review_item r on r.record_id = g.id and r.payload->>'import' = %s
            join field_source s on s.record_id = g.id and s.field = 'name'
            where g.slug like 'apply-%%' order by g.slug
            """,
            (KEY,),
        )
        return cur.fetchall()


def test_a_reload_keeps_what_a_reviewer_decided(conn):
    apply(conn, records(), KEY, "2026-10-07", False)
    assert statuses(conn) == [
        ("apply-checked", "published", "approved", False, True),
        ("apply-doubtful", "draft", "pending", False, False),
        ("apply-unchecked", "draft", "pending", False, False),
    ]
    with conn.cursor() as cur:
        cur.execute("insert into app_user (email, role) values ('apply-reviewer@apply.test', 'reviewer') returning id")
        reviewer = cur.fetchone()[0]
        # The reviewer approves one draft and rejects the other.
        for slug, decision in (("apply-unchecked", "approved"), ("apply-doubtful", "rejected")):
            cur.execute(
                "update review_item r set status = %s, reviewed_by = %s, reviewed_at = now() "
                "from organisation g where g.id = r.record_id and g.slug = %s",
                (decision, reviewer, slug),
            )
    conn.commit()

    apply(conn, records(), KEY, "2026-10-07", False)
    assert statuses(conn) == [
        ("apply-checked", "published", "approved", False, True),
        ("apply-doubtful", "draft", "rejected", True, False),
        ("apply-unchecked", "published", "approved", True, True),
    ]
    with conn.cursor() as cur:
        cur.execute("update review_item set reviewed_by = null where reviewed_by = %s", (reviewer,))
    conn.commit()
