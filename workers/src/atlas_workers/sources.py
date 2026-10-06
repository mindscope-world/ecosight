"""News sources the crawlers read. Terms and robots notes for each are in docs/sources.md."""

from dataclasses import dataclass


@dataclass(frozen=True)
class FeedSource:
    id: str
    name: str
    feed_url: str
    # Seconds between requests to this host.
    delay: float = 5.0


SOURCES: tuple[FeedSource, ...] = (
    FeedSource("techcabal", "TechCabal", "https://techcabal.com/feed/"),
    FeedSource("disrupt-africa", "Disrupt Africa", "https://disruptafrica.com/feed/"),
)
