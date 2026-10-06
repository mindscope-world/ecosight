"""Feed crawlers: read a publisher's RSS feed and store each entry as a raw document.

Only the feed is fetched, which is what publishers offer for syndication. Article
pages are not requested, so there is one request per source per run.
"""

import html
import json
import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import feedparser
import httpx

from .config import USER_AGENT
from .sources import FeedSource
from .store import RawStore

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"[ \t\r\f\v]*\n\s*|[ \t]+")


def html_to_text(markup: str) -> str:
    """Plain text with paragraph breaks kept, for quoting and extraction."""
    text = re.sub(r"(?i)</(p|div|h[1-6]|li)>|<br\s*/?>", "\n", markup)
    text = html.unescape(_TAG.sub("", text))
    return _SPACE.sub(lambda m: "\n" if "\n" in m.group() else " ", text).strip()


@dataclass(frozen=True)
class CrawlResult:
    source: str
    entries: int
    new: int


def robots_allows(client: httpx.Client, url: str) -> bool:
    """True when robots.txt permits this URL. No robots.txt means no restriction."""
    parts = urlsplit(url)
    response = client.get(f"{parts.scheme}://{parts.netloc}/robots.txt")
    if response.status_code >= 500:
        return False  # Site in trouble: stay away rather than guess.
    if response.status_code >= 400:
        return True
    parser = RobotFileParser()
    parser.parse(response.text.splitlines())
    return parser.can_fetch(USER_AGENT, url)


def entry_document(source: FeedSource, entry: dict) -> tuple[str, bytes] | None:
    """The stored form of one feed entry: its URL and a stable JSON body."""
    url = entry.get("link")
    title = entry.get("title")
    if not url or not title:
        return None
    content = entry.get("content") or []
    body = content[0].get("value") if content else entry.get("summary", "")
    document = {
        "source": source.id,
        "url": url,
        "title": html.unescape(title).strip(),
        "published": entry.get("published"),
        "text": html_to_text(body or ""),
    }
    # Sorted keys keep the hash stable, so an unchanged entry is not stored twice.
    return url, json.dumps(document, sort_keys=True, ensure_ascii=False).encode()


def crawl_feed(source: FeedSource, store: RawStore, client: httpx.Client) -> CrawlResult:
    if not robots_allows(client, source.feed_url):
        raise PermissionError(f"robots.txt does not allow {source.feed_url}")
    time.sleep(source.delay)
    response = client.get(source.feed_url)
    response.raise_for_status()
    feed = feedparser.parse(response.content)
    if feed.bozo and not feed.entries:
        raise ValueError(f"{source.feed_url} is not a readable feed: {feed.bozo_exception}")

    entries = new = 0
    for entry in feed.entries:
        document = entry_document(source, entry)
        if document is None:
            continue
        entries += 1
        new += store.put(*document).is_new
    return CrawlResult(source.id, entries, new)


def make_client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True
    )
