import psycopg
import pytest

from atlas_workers import config
from atlas_workers.links import apply, read_file, resolve, summarise

HEADER = "from,relation,to,label,source,quote\n"
KEY = "test_links_file/links"


def write(tmp_path, *rows: str, header: str = HEADER):
    path = tmp_path / "links.csv"
    path.write_text(header + "".join(row + "\n" for row in rows))
    return path


def test_relations_are_read_in_either_direction(tmp_path):
    hub, hosts, programme, odd = read_file(
        write(
            tmp_path,
            "Links Hub,Hosted by,Links University,,https://links.test/a,the hub is hosted by the university",
            "Links University,hosts,Links Hub,,https://links.test/a,",
            "Links Startup,accelerated_at,Links Hub,Cohort 1,https://links.test/b,",
            "Links Startup,admires,Links Hub,,https://links.test/b,",
        )
    )
    assert (hub.kind, hub.source, hub.target, hub.quote) == ("hosted_by", "Links Hub", "Links University", "the hub is hosted by the university")
    # "A hosts B" is the same tie, read the other way.
    assert (hosts.kind, hosts.source, hosts.target) == ("hosted_by", "Links Hub", "Links University")
    assert (programme.kind, programme.label) == ("accelerated_at", "Cohort 1")
    assert odd.kind is None


def test_a_file_needs_its_three_columns(tmp_path):
    with pytest.raises(ValueError, match="missing columns: relation, to"):
        read_file(write(tmp_path, "a,b", header="from,other\n"))
    # Other headings for the same things are understood.
    (link,) = read_file(write(tmp_path, "A,part of,B,https://links.test/x", header="Organisation,Relationship,Related organisation,Evidence\n"))
    assert (link.source, link.kind, link.target, link.url) == ("A", "part_of", "B", "https://links.test/x")


@pytest.fixture
def conn():
    try:
        connection = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    with connection.cursor() as cur:
        for name, slug, kind, status, aliases in (
            ("Links University", "links-university", "university", "published", "{}"),
            ("Links Hub", "links-hub", "innovation_hub", "published", "{The Links Lab}"),
            ("Links Startup", "links-startup", "startup", "published", "{}"),
            ("Links Draft", "links-draft", "startup", "draft", "{}"),
        ):
            cur.execute(
                "insert into organisation (name, slug, types, status, aliases) values (%s, %s, array[%s]::org_type[], %s, %s)",
                (name, slug, kind, status, aliases),
            )
    connection.commit()
    yield connection
    connection.rollback()
    with connection.cursor() as cur:
        cur.execute("delete from field_source where source_url like 'https://links.test/%'")
        cur.execute("delete from review_item where payload->>'import' = %s", (KEY,))
        cur.execute("delete from organisation where slug like 'links-%'")
    connection.commit()
    connection.close()


ROWS = (
    "Links Hub,hosted by,Links University,,https://links.test/a,the hub is hosted by the university",
    "Links Startup,accelerated at,The Links Lab (formerly the Lab),Cohort 1,https://links.test/b,listed in Cohort 1",
    "Links Startup,funded by,Unknown Capital,,https://links.test/c,",
    "Links Draft,part of,Links University,,https://links.test/d,",
    "Links Hub,partner of,Links Startup,,,",
    "Links Hub,hosted_by,Links University,,https://links.test/a,",
    "Links Hub,hosted by,Links Hub,,https://links.test/a,",
)


def test_only_rows_with_both_ends_and_a_source_are_published(conn, tmp_path):
    links = read_file(write(tmp_path, *ROWS))
    resolve(conn, links)
    assert [link.problem for link in links] == [
        None,
        None,  # found by another name it goes by, with the bracketed note dropped
        "not on record: Unknown Capital",
        "not published: Links Draft",
        "no link to a source",
        "repeats row 1",
        "both sides are the same organisation",
    ]
    text = summarise(links)
    assert "7 rows read: 2 to publish, 5 for the review queue" in text
    assert "Links Hub  --hosted_by-->  Links University" in text and "row 3:" in text


def state(conn):
    with conn.cursor() as cur:
        cur.execute(
            """
            select e.kind, a.name, b.name, e.label, s.source_url, s.quote
            from graph_edge e
            join organisation a on a.id = e.source_org and a.slug like 'links-%%'
            join organisation b on b.id = e.target_org
            left join field_source s on s.record_id = e.ref_id and s.source_url like 'https://links.test/%%'
              and (s.field = 'link' or s.field = 'participant:' || a.id)
            where e.kind in ('hosted_by', 'accelerated_at') order by 1
            """
        )
        edges = cur.fetchall()
        cur.execute(
            "select status::text, reason from review_item where payload->>'import' = %s order by (payload->>'record')::int", (KEY,)
        )
        return edges, cur.fetchall()


def test_loading_twice_leaves_one_copy_and_the_rest_in_the_queue(conn, tmp_path):
    links = read_file(write(tmp_path, *ROWS))
    resolve(conn, links)
    apply(conn, links, KEY, "2026-10-07")
    again = read_file(write(tmp_path, *ROWS))
    resolve(conn, again)
    assert [link.problem for link in again] == [link.problem for link in links]  # its own rows are not "from another source"
    apply(conn, again, KEY, "2026-10-07")

    edges, queue = state(conn)
    assert edges == [
        ("accelerated_at", "Links Startup", "Links Hub", "Cohort 1", "https://links.test/b", "listed in Cohort 1"),
        ("hosted_by", "Links Hub", "Links University", None, "https://links.test/a", "the hub is hosted by the university"),
    ]
    assert [status for status, _ in queue] == ["approved", "approved", "pending", "pending", "pending", "pending", "pending"]
    assert queue[2][1] == "not on record: Unknown Capital"

    # A row taken out of the file is taken out of the database, with the programme it had created.
    fewer = read_file(write(tmp_path, ROWS[0]))
    resolve(conn, fewer)
    apply(conn, fewer, KEY, "2026-10-07")
    edges, queue = state(conn)
    assert [edge[0] for edge in edges] == ["hosted_by"] and len(queue) == 1
    with conn.cursor() as cur:
        cur.execute("select count(*) from program where name = 'Cohort 1'")
        assert cur.fetchone()[0] == 0
