"""Fetch each organisation's logo from its own website, for its card in the app.

The icon a site declares for itself is used: the one for a phone's home screen
when there is one, since it is the largest and drawn to stand alone, else the
largest icon it lists, else `/favicon.ico`. Only the organisation's own site is
asked, within its robots.txt, two requests a site. The image is stored, so the
app never fetches it from anywhere else. Large images are left out: a card
needs an icon, not a banner.
"""

import re
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin

import httpx

from .crawl import robots_allows

MAX_BYTES = 65536
DELAY = 1.0


class _Icons(HTMLParser):
    """The icons a page declares in its head."""

    def __init__(self) -> None:
        super().__init__()
        self.found: list[tuple[str, str, int]] = []  # rel, href, declared size

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "link":
            return
        given = {name: (value or "") for name, value in attrs}
        rel = given.get("rel", "").lower()
        if "icon" in rel and given.get("href"):
            sizes = [int(size) for size in re.findall(r"(\d+)x\d+", given.get("sizes", ""))]
            self.found.append((rel, given["href"].strip(), max(sizes, default=0)))


def icon_candidates(markup: str, base: str) -> list[str]:
    """Addresses to try for a site's logo, best first, ending with the conventional favicon."""
    parser = _Icons()
    parser.feed(markup)

    def rank(icon: tuple[str, str, int]) -> tuple[int, int]:
        rel, _, size = icon
        # An icon made for a home screen first; then the largest declared; a mask icon is one colour, so last.
        return (0 if "apple-touch-icon" in rel else 2 if "mask-icon" in rel else 1, -size)

    listed = [urljoin(base, href) for _, href, _ in sorted(parser.found, key=rank)]
    return list(dict.fromkeys([*listed, urljoin(base, "/favicon.ico")]))


def image_type(data: bytes) -> str | None:
    """What kind of image the bytes are, from the bytes themselves. None for anything else, such as an error page."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] == b"\x00\x00\x01\x00":
        return "image/x-icon"
    head = data[:1024].lstrip().lower()
    if head.startswith((b"<svg", b"<?xml")) and b"<svg" in data[:2048].lower():
        return "image/svg+xml"
    return None


@dataclass
class Logo:
    organisation_id: str
    organisation: str
    domain: str
    content_type: str | None = None
    image: bytes | None = None
    source_url: str | None = None
    note: str | None = None


def fetch_logo(client: httpx.Client, logo: Logo, pause: float = DELAY) -> None:
    """Fill in the logo from the organisation's site, or say why there is none."""
    home = f"https://{logo.domain}/"
    try:
        if not robots_allows(client, home):
            logo.note = "robots.txt does not allow it"
            return
        time.sleep(pause)
        page = client.get(home)
        markup = page.text if page.status_code == 200 and "html" in page.headers.get("content-type", "") else ""
        too_big = False
        # The first two a site offers are tried; a site with neither usable has no logo here.
        for url in icon_candidates(markup, str(page.url) if markup else home)[:2]:
            if not url.startswith("http") or not robots_allows(client, url):
                continue
            time.sleep(pause)
            response = client.get(url)
            if response.status_code != 200:
                continue
            if len(response.content) > MAX_BYTES:
                too_big = True
                continue
            kind = image_type(response.content)
            if kind:
                logo.content_type, logo.image, logo.source_url = kind, response.content, str(response.url)
                return
        logo.note = "its icon is too large to keep" if too_big else "no icon found"
    except (httpx.HTTPError, ValueError) as error:
        logo.note = f"site could not be read: {type(error).__name__}"


def wanted(conn, refresh: bool) -> list[Logo]:
    """Published organisations with a website, and no logo yet unless every one is to be fetched again."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select g.id, g.name, g.website_domain from organisation g
            where g.status = 'published' and g.website_domain is not null
              and (%s or not exists (select 1 from organisation_logo l where l.organisation_id = g.id))
            order by g.name
            """,
            (refresh,),
        )
        return [Logo(str(org_id), name, domain) for org_id, name, domain in cur.fetchall()]


def save(conn, logo: Logo) -> None:
    """Store one logo. Each is saved as it is fetched, so a long run that is cut short keeps what it has."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            insert into organisation_logo (organisation_id, content_type, image, source_url)
            values (%s, %s, %s, %s)
            on conflict (organisation_id) do update
              set content_type = excluded.content_type, image = excluded.image,
                  source_url = excluded.source_url, fetched_at = now()
            """,
            (logo.organisation_id, logo.content_type, logo.image, logo.source_url),
        )


def summarise(logos: list[Logo]) -> str:
    found = [logo for logo in logos if logo.image]
    lines = [f"{len(logos)} organisations looked up, {len(found)} with a logo, {len(logos) - len(found)} without", ""]
    lines += [f"{logo.organisation[:34]:<35}{logo.content_type:<15}{len(logo.image):>6} bytes  {logo.source_url}" for logo in found]
    missing = [logo for logo in logos if not logo.image]
    if missing:
        lines += ["", "Without a logo:"]
        lines += [f"  {logo.organisation}: {logo.note}" for logo in missing]
    return "\n".join(lines)
