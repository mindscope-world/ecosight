import json

import httpx
import psycopg
import pytest

from atlas_workers.crawl import crawl_feed, entry_document, html_to_text, robots_allows
from atlas_workers.sources import FeedSource
from atlas_workers.store import LocalStorage, RawStore

SOURCE = FeedSource("demo", "Demo", "https://news.test/feed/", delay=0)
FEED = """<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Demo</title>
<item><title>Sample Pay raises $2.5 million</title><link>https://news.test/a</link>
<pubDate>Mon, 05 Oct 2026 08:00:00 +0000</pubDate>
<content:encoded><![CDATA[<p>Sample Pay has raised &amp; closed.</p><p>Second paragraph.</p>]]></content:encoded></item>
<item><title>No link here</title></item>
</channel></rss>"""


def client_for(robots: httpx.Response) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/robots.txt":
            return robots
        return httpx.Response(200, content=FEED.encode())

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_html_to_text_keeps_paragraphs():
    assert html_to_text("<p>One &amp; two</p><p>Three<br>four</p>") == "One & two\nThree\nfour"


def test_entry_document_is_stable_json():
    url, body = entry_document(SOURCE, {"link": "https://news.test/a", "title": "A &amp; B", "summary": "<p>Hi</p>"})
    assert url == "https://news.test/a"
    assert json.loads(body) == {"source": "demo", "url": url, "title": "A & B", "published": None, "text": "Hi"}
    assert entry_document(SOURCE, {"title": "No link"}) is None


@pytest.mark.parametrize(
    "robots, allowed",
    [
        (httpx.Response(404), True),
        (httpx.Response(200, text="User-agent: *\nDisallow:"), True),
        (httpx.Response(200, text="User-agent: *\nDisallow: /feed/"), False),
        (httpx.Response(503), False),
    ],
)
def test_robots(robots, allowed):
    assert robots_allows(client_for(robots), SOURCE.feed_url) is allowed


@pytest.fixture
def store(tmp_path):
    from atlas_workers import config

    try:
        conn = psycopg.connect(config.test_database_url(), connect_timeout=3)
    except Exception as error:
        pytest.skip(f"database not available: {error}")
    yield RawStore(conn, LocalStorage(tmp_path))
    conn.execute("delete from raw_document where url like 'https://news.test/%'")
    conn.commit()
    conn.close()


def test_crawl_stores_each_entry_once(store, tmp_path):
    client = client_for(httpx.Response(404))
    first = crawl_feed(SOURCE, store, client)
    second = crawl_feed(SOURCE, store, client)
    assert (first.entries, first.new) == (1, 1)
    assert (second.entries, second.new) == (1, 0)

    row = store.conn.execute(
        "select id, storage_key from raw_document where url = 'https://news.test/a'"
    ).fetchone()
    stored = json.loads(store.get(str(row[0])))
    assert stored["title"] == "Sample Pay raises $2.5 million"
    assert stored["text"] == "Sample Pay has raised & closed.\nSecond paragraph."
    assert (tmp_path / row[1]).is_file()


def test_crawl_refuses_a_disallowed_feed(store):
    client = client_for(httpx.Response(200, text="User-agent: *\nDisallow: /"))
    with pytest.raises(PermissionError):
        crawl_feed(SOURCE, store, client)
