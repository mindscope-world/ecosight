"""Find the LinkedIn profile of each person on record, without visiting LinkedIn.

LinkedIn forbids automated collection from its own pages and shows little
without signing in, so nothing here requests linkedin.com. A profile address is
looked for where it has already been published for the public to follow:

- among the sources on record for the person's organisation, where the research
  often cites a founder's profile; and
- on the organisation's own website, whose team and about pages commonly link
  each person's profile. Those pages are fetched only where the site's
  robots.txt allows, a few per site, one request a second.

An address is kept only when it plainly belongs to the person: the name in the
address must carry the person's first and last name, and the match must be the
only one for both the person and the profile. Anything less is reported and left
for a person to settle. Only the address is stored, with the page it was found on.
"""

import re
import time
import unicodedata
from dataclasses import dataclass, field
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit

import httpx

from .crawl import robots_allows

# A personal profile, as opposed to a company page, a post or a search.
_PROFILE = re.compile(r"^https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/([^/?#\s;,)\]]+)", re.I)
# Titles and suffixes that are not part of a name.
_NOT_NAME = {"dr", "mr", "mrs", "ms", "prof", "eng", "md", "phd", "jr", "sr"}
# Pages of a site likely to list its people, tried after the home page.
_PEOPLE_PAGE = re.compile(r"about|team|people|leadership|founder|who-we-are|management|company", re.I)
PAGES_PER_SITE = 4
DELAY = 1.0


def profile_url(url: str) -> str | None:
    """A profile address in one spelling, or None when the link is not to a person's profile."""
    match = _PROFILE.match(url.strip())
    if not match:
        return None
    # A link lifted from running text can end in its sentence's punctuation.
    slug = unquote(match[1]).strip().rstrip(".;,").lower()
    return f"https://www.linkedin.com/in/{slug}" if slug else None


def _plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def name_words(name: str) -> list[str]:
    """The words of a name that identify the person: no titles, no initials."""
    words = re.findall(r"[a-z]+", _plain(name))
    return [word for word in words if len(word) > 1 and word not in _NOT_NAME]


def belongs_to(profile: str, name: str) -> bool:
    """True when the profile's address carries the person's first and last name.

    "jane-doe-4a1b2c" and "doejane" belong to Jane Doe; "jdoe" and "jane-smith"
    do not. A single-word name is never enough to go on.
    """
    words = name_words(name)
    if len(words) < 2:
        return False
    slug = _plain(profile.rsplit("/", 1)[-1])
    parts = set(re.findall(r"[a-z]+", slug))
    first, last = words[0], words[-1]
    if first in parts and last in parts:
        return True
    # Run together, the two names must make up the start of the address: "janedoe", "doejane1".
    squashed = re.sub(r"[^a-z]", "", slug)
    return squashed.startswith(first + last) or squashed.startswith(last + first)


class _Links(HTMLParser):
    """Every link on a page."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href.strip())


def page_links(markup: str, base: str) -> list[str]:
    parser = _Links()
    parser.feed(markup)
    return [urljoin(base, href) for href in parser.links]


def people_pages(links: list[str], home: str) -> list[str]:
    """Pages of the same site that look as if they list its people, nearest the root first."""
    host = urlsplit(home).netloc.removeprefix("www.")
    found: dict[str, None] = {}
    for link in links:
        parts = urlsplit(link)
        if parts.scheme not in ("http", "https") or parts.netloc.removeprefix("www.") != host:
            continue
        if _PEOPLE_PAGE.search(parts.path) and not re.search(r"\.(pdf|jpe?g|png|svg|zip)$", parts.path, re.I):
            found.setdefault(f"{parts.scheme}://{parts.netloc}{parts.path}")
    return sorted(found, key=lambda url: (url.count("/"), len(url)))[: PAGES_PER_SITE - 1]


def site_profiles(client: httpx.Client, domain: str, pause: float = DELAY) -> dict[str, str]:
    """Profile addresses linked from a site's home page and its people pages, each with the page it is on."""
    home = f"https://{domain}/"
    found: dict[str, str] = {}
    try:
        if not robots_allows(client, home):
            return found
        queue, seen = [home], set()
        while queue and len(seen) < PAGES_PER_SITE:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)
            if url != home and not robots_allows(client, url):
                continue
            time.sleep(pause)
            response = client.get(url)
            if response.status_code != 200 or "html" not in response.headers.get("content-type", ""):
                continue
            links = page_links(response.text, str(response.url))
            for link in links:
                profile = profile_url(link)
                if profile:
                    found.setdefault(profile, str(response.url))
            if url == home:
                queue += people_pages(links, str(response.url))
    except (httpx.HTTPError, ValueError):
        pass  # A site that cannot be read has nothing to offer; what was found so far stands.
    return found


@dataclass
class Person:
    id: str
    name: str
    organisation: str
    organisation_id: str
    domain: str | None
    current: str | None
    profile: str | None = None
    source: str | None = None
    note: str | None = None
    candidates: dict[str, str] = field(default_factory=dict)


def read_people(conn) -> list[Person]:
    """People on record at published organisations who have not opted out."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select pr.id, pr.name, g.name, g.id, g.website_domain, pr.linkedin_url
            from person_role pr join organisation g on g.id = pr.organisation_id
            where not pr.opted_out and g.status = 'published'
            order by g.name, pr.name
            """
        )
        return [Person(str(i), name, org, str(org_id), domain, current) for i, name, org, org_id, domain, current in cur.fetchall()]


def recorded_profiles(conn) -> dict[str, dict[str, str]]:
    """Profile addresses among each organisation's sources on record. The source is the address itself."""
    with conn.cursor() as cur:
        cur.execute(
            "select record_id, source_url from field_source "
            "where record_type = 'organisation' and source_url ~* 'linkedin\\.com/in/'"
        )
        found: dict[str, dict[str, str]] = {}
        for org_id, url in cur.fetchall():
            profile = profile_url(url)
            if profile:
                found.setdefault(str(org_id), {}).setdefault(profile, "the organisation's sources on record")
        return found


def assign(people: list[Person], candidates: dict[str, dict[str, str]]) -> None:
    """Give each person the one profile that is plainly theirs, organisation by organisation."""
    by_org: dict[str, list[Person]] = {}
    for person in people:
        by_org.setdefault(person.organisation_id, []).append(person)
    for org_id, members in by_org.items():
        offered = candidates.get(org_id, {})
        claims = {
            person.id: [profile for profile in offered if belongs_to(profile, person.name)] for person in members
        }
        for person in members:
            mine = claims[person.id]
            person.candidates = {profile: offered[profile] for profile in mine}
            if not mine:
                continue
            if len(mine) > 1:
                person.note = f"{len(mine)} profiles carry this name; not chosen"
            elif sum(mine[0] in other for other in claims.values()) > 1:
                person.note = "the profile fits more than one person here; not chosen"
            else:
                person.profile, person.source = mine[0], offered[mine[0]]


def find(conn, client: httpx.Client | None, progress=lambda done, total: None) -> list[Person]:
    """Look for every person's profile. With no client, only the sources on record are read."""
    people = read_people(conn)
    candidates = recorded_profiles(conn)
    if client is not None:
        # Only sites of organisations with someone still to find are visited.
        assign(people, candidates)
        domains = {p.organisation_id: p.domain for p in people if p.domain and not p.profile and not p.current}
        for done, (org_id, domain) in enumerate(sorted(domains.items(), key=lambda item: item[1]), 1):
            progress(done, len(domains))
            for profile, page in site_profiles(client, domain).items():
                candidates.setdefault(org_id, {}).setdefault(profile, page)
        for person in people:
            person.profile = person.source = person.note = None
    assign(people, candidates)
    return people


def summarise(people: list[Person]) -> str:
    found = [p for p in people if p.profile]
    new = [p for p in found if p.profile != p.current]
    unsure = [p for p in people if p.note]
    lines = [
        f"{len(people)} people on record, {sum(bool(p.current) for p in people)} with a profile already, "
        f"{len(new)} to add or change, {len(unsure)} left for a person to settle",
        "",
    ]
    lines += [f"{p.organisation[:28]:<29}{p.name[:26]:<27}{p.profile}  (from {p.source})" for p in new]
    if unsure:
        lines += ["", "Not chosen:"]
        lines += [f"  {p.organisation} / {p.name}: {p.note}: {', '.join(p.candidates)}" for p in unsure]
    return "\n".join(lines)


def apply(conn, people: list[Person]) -> int:
    """Store what was found. A profile already on record is replaced only by a different find, never removed."""
    changed = 0
    with conn.transaction(), conn.cursor() as cur:
        for person in people:
            if person.profile and person.profile != person.current:
                cur.execute(
                    "update person_role set linkedin_url = %s, linkedin_source = %s, updated_at = now() where id = %s",
                    (person.profile, person.source, person.id),
                )
                changed += 1
    return changed
