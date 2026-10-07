"""Find the LinkedIn profile of each person on record, without visiting LinkedIn.

LinkedIn forbids automated collection from its own pages and shows little
without signing in, so nothing here requests linkedin.com. A profile address is
looked for where it has already been published for the public to follow:

- among the sources on record for the person's organisation, where the research
  often cites a founder's profile; and
- on the organisation's own website, whose team and about pages commonly link
  each person's profile. Those pages are fetched only where the site's
  robots.txt allows, a few per site, one request a second; and
- through a web search service, asked for the person's name and organisation
  among LinkedIn profiles. Only the service's own answer is read: the address,
  title and summary of each result. The result's page is never opened.

An address is kept only when it plainly belongs to the person: the name in the
address must carry the person's first and last name, and the match must be the
only one for both the person and the profile. A search result must also name the
person's organisation in its title or summary, since a name alone is shared by
many people. Anything less is reported and left for a person to settle. Only the
address is stored, with the page or the search it was found through.
"""

import json
import re
import time
import unicodedata
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote_plus, unquote, urljoin, urlsplit

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
# SerpAPI: search engine results as data, with a free monthly allowance.
SEARCH_URL = "https://serpapi.com/search.json"
SEARCH_DELAY = 1.0
MAX_FAILURES_IN_A_ROW = 4
# The page a person can open to see the same results.
RESULT_PAGES = {"google": "https://www.google.com/search?q=", "duckduckgo": "https://duckduckgo.com/?q="}
# Words that end a registered name and are dropped when looking for it in a result.
_LEGAL_SUFFIX = re.compile(r"\b(limited|ltd|plc|inc|llc|sarl|gmbh|pty|co)\b\.?", re.I)


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


def mentions(text: str, organisations: list[str]) -> bool:
    """True when the text names the organisation, under any name it goes by, legal suffix aside.

    The name must stand as words of its own: "REMA" is not in "remarkable", though
    "Sample Pay" is in "SamplePay".
    """
    plain = _plain(text)
    for name in organisations:
        words = re.findall(r"[a-z0-9]+", _plain(_LEGAL_SUFFIX.sub("", name)))
        # A name of one or two letters turns up too often to mean anything.
        if len("".join(words)) >= 3 and re.search(r"\b" + r"[\W_]*".join(map(re.escape, words)) + r"\b", plain):
            return True
    return False


class SearchStopped(Exception):
    """The search service refused: a bad key, or the allowance is used up."""


class Search:
    """Web search for one person's profile, through SerpAPI. Answers are kept on disk, so nothing is asked twice.

    SerpAPI answers with the results of a search engine as data. Two engines are
    used: Google, and DuckDuckGo for anyone Google did not find. DuckDuckGo is
    reached through SerpAPI too: it has no search API of its own, and its
    robots.txt forbids scripts from its results pages.
    """

    def __init__(
        self,
        client: httpx.Client,
        key: str,
        cache_path: Path,
        engines: tuple[str, ...] = ("google", "duckduckgo"),
        limit: int | None = None,
        pause: float = SEARCH_DELAY,
    ) -> None:
        self.client, self.key, self.cache_path, self.pause = client, key, cache_path, pause
        self.engines = engines
        # How many requests this run may make. The free plan has a monthly allowance.
        self.limit = limit
        self.asked = 0
        self._cache: dict[str, list[dict[str, str]]] = json.loads(cache_path.read_text()) if cache_path.is_file() else {}

    def results(self, engine: str, query: str) -> list[dict[str, str]]:
        cached = f"{engine}:{query}"
        if cached not in self._cache:
            if self.limit is not None and self.asked >= self.limit:
                raise SearchStopped(f"this run's limit of {self.limit} requests was reached")
            time.sleep(self.pause)
            response = self.client.get(SEARCH_URL, params={"engine": engine, "q": query, "api_key": self.key})
            self.asked += 1
            body = response.json() if "json" in response.headers.get("content-type", "") else {}
            error = str(body.get("error", ""))
            # Finding nothing is an answer; anything else the service objects to ends the search.
            if response.status_code != 200 and "returned any results" not in error:
                raise SearchStopped(f"the search service answered {response.status_code}{': ' + error if error else ''}")
            self._cache[cached] = [
                {"url": item.get("link", ""), "title": item.get("title", ""), "description": item.get("snippet", "")}
                for item in body.get("organic_results", [])
            ]
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self._cache, indent=1, sort_keys=True, ensure_ascii=False))
        return self._cache[cached]

    def profiles(self, name: str, organisations: list[str]) -> dict[str, str]:
        """Profiles the search returns that carry the person's name and whose result names the organisation."""
        query = f'"{name}" "{organisations[0]}" site:linkedin.com/in'
        found: dict[str, str] = {}
        for engine in self.engines:
            for item in self.results(engine, query):
                profile = profile_url(item["url"])
                if profile and belongs_to(profile, name) and mentions(f"{item['title']} {item['description']}", organisations):
                    # Where a person can run the same search and see the same result.
                    found.setdefault(profile, RESULT_PAGES[engine] + quote_plus(query))
            if found:
                break  # The next engine is asked only when this one found nobody.
        return found


@dataclass
class Person:
    id: str
    name: str
    organisation: str
    organisation_id: str
    domain: str | None
    current: str | None
    # Other names the organisation goes by.
    aliases: tuple[str, ...] = ()
    profile: str | None = None
    source: str | None = None
    note: str | None = None
    candidates: dict[str, str] = field(default_factory=dict)


def read_people(conn) -> list[Person]:
    """People on record at published organisations who have not opted out."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select pr.id, pr.name, g.name, g.id, g.website_domain, pr.linkedin_url, g.aliases
            from person_role pr join organisation g on g.id = pr.organisation_id
            where not pr.opted_out and g.status = 'published'
            order by g.name, pr.name
            """
        )
        return [
            Person(str(i), name, org, str(org_id), domain, current, tuple(aliases or ()))
            for i, name, org, org_id, domain, current, aliases in cur.fetchall()
        ]


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


def _reassign(people: list[Person], candidates: dict[str, dict[str, str]]) -> None:
    for person in people:
        person.profile = person.source = person.note = None
    assign(people, candidates)


def find(
    conn,
    client: httpx.Client | None = None,
    search: Search | None = None,
    progress=lambda step, done, total: None,
) -> tuple[list[Person], str | None]:
    """Look for every person's profile, and say why the search stopped early if it did.

    Each step is tried only for those the one before left without a profile: the
    sources on record, then with a client the organisations' own sites, then with
    a search service the web.
    """
    people = read_people(conn)
    candidates = recorded_profiles(conn)
    assign(people, candidates)
    stopped = None
    if client is not None:
        domains = {p.organisation_id: p.domain for p in people if p.domain and not p.profile and not p.current}
        for done, (org_id, domain) in enumerate(sorted(domains.items(), key=lambda item: item[1]), 1):
            progress("reading organisations' own sites", done, len(domains))
            for profile, page in site_profiles(client, domain).items():
                candidates.setdefault(org_id, {}).setdefault(profile, page)
        _reassign(people, candidates)
    if search is not None:
        # Someone with profiles already offered but none chosen is left for a person, not searched for.
        wanted = [p for p in people if not p.profile and not p.current and not p.note]
        failed = 0
        try:
            for done, person in enumerate(wanted, 1):
                progress("searching the web", done, len(wanted))
                try:
                    found = search.profiles(person.name, [person.organisation, *person.aliases])
                except httpx.HTTPError as error:
                    # One slow or dropped answer is passed over, and asked again on the next run.
                    # Several in a row mean the service cannot be reached.
                    failed += 1
                    if failed >= MAX_FAILURES_IN_A_ROW:
                        raise SearchStopped(f"{failed} requests in a row failed, the last with {error!r}") from error
                    continue
                failed = 0
                for profile, source in found.items():
                    candidates.setdefault(person.organisation_id, {}).setdefault(profile, source)
        except SearchStopped as error:
            stopped = f"The search stopped early: {error}. What was found before that stands."
        _reassign(people, candidates)
    return people, stopped


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
