"""Import a researched organisations dataset (CSV) into the database.

The dataset is prose-heavy research, so the importer reads only what it can read
reliably and leaves the rest as text for a person:

- Only rows marked `verified` are published. Everything else is loaded as a draft
  with a pending review item, so it is kept but not shown on the map.
- Funding is not turned into round rows. The disclosure text is kept as a note and
  a stage is set only when the status names one outright.
- A person is loaded only when the text names them as a founder.
- Emails and phone numbers are not loaded.

Running without `apply` changes nothing in the database: it builds the plan and
the report, which is what gets reviewed first.

Other datasets are read through a column mapping: a JSON object from the field
names in `DEFAULT_COLUMNS` to that dataset's own column headings.
"""

import csv
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .geocode import Geocoder, Place, in_nairobi

# What an investor known only from a funding round is described as, until a dataset says more.
INVESTOR_PLACEHOLDER = "Named as an investor in a funding round on record."

# Field name to column heading, as in the first dataset loaded. A mapping file
# overrides any of these for a dataset with different headings.
DEFAULT_COLUMNS = {
    "record": "Record #",
    "name": "Startup / organisation",
    "status": "Verification status",
    "type": "Type",
    "industry": "Industry",
    "founded_year": "Founded year",
    "location_basis": "Nairobi basis",
    "premise": "Exact public building / premise",
    "location_verification": "Location verification",
    "city": "City",
    "country": "Country",
    "latitude": "Latitude",
    "longitude": "Longitude",
    "funding_status": "Funding level / status",
    "funding_details": "Funding details",
    "founders": "Founders and public roles",
    "website": "Official website",
    "source_name": "Identity / Nairobi source URL",
    "source_office": "Location source URL",
    "source_funding": "Funding source URL",
    "source_people": "Founder source URL",
    # One cell holding every source for the row, as "title — URL" entries.
    "sources": "Sources",
    "confidence": "Confidence",
}
CONFIDENCE = {"high": 0.9, "medium": 0.6, "low": 0.3}
# Only a name is indispensable. Everything else has a safe reading when absent.
REQUIRED_FIELDS = ("name",)

# Words a dataset may use for each kind of organisation.
TYPE_WORDS = {
    "startup": "startup", "company": "startup", "scaleup": "startup",
    "investor": "fund", "vc": "fund", "venture capital": "fund", "fund": "fund", "pe": "fund",
    "angel network": "angel_network", "angel": "angel_network",
    "accelerator": "accelerator", "incubator": "incubator",
    "ngo": "ngo", "non-profit": "ngo", "nonprofit": "ngo",
    "development funder": "development_funder", "dfi": "development_funder", "foundation": "development_funder",
    "hub": "innovation_hub", "innovation hub": "innovation_hub", "coworking": "innovation_hub",
    "university": "university", "government": "government_program", "government program": "government_program",
    "corporate": "corporate",
}
STATUSES = {"verified", "partially_verified", "not_verified", "inactive_or_unclear"}
LOCATION_LEVELS = {
    "exact_public_address_verified",
    "only_area_or_city_verified",
    "not_publicly_verified",
}

# Sector tags, each with the words that signal it. Order sets which tag wins a tie.
SECTOR_RULES: tuple[tuple[str, str], ...] = (
    ("insurtech", r"insur"),
    ("fintech", r"fintech|financ|payment|lending|credit|wealth|capital markets|remittance|invest|bnpl|loan"),
    ("healthtech", r"health|medical"),
    ("agritech", r"agri|farm"),
    ("edtech", r"ed-?tech|education|learning|assistive"),
    ("mobility", r"mobility|ride-hailing|electric[- ]motorcycle|\bev\b|fleet"),
    ("logistics", r"logistic|freight|trucking|deliver|parcel|fulfil|transport|supply chain"),
    # Not bare "clean": a cleaning service is not clean technology.
    ("cleantech", r"clean ?tech|clean (?:cooking|energy)|climate|energy|solar|waste|circular|recycl"),
    ("e-commerce", r"e-commerce|retail|marketplace"),
    ("ai", r"\bai\b|artificial intelligence|machine learning"),
    ("software", r"software|saas|it services|digital products|data infrastructure|blockchain|\biot\b|game"),
    ("beautytech", r"beauty"),
)

# A stage is read only from the opening words of the funding status.
STAGE_RULES: tuple[tuple[str, str], ...] = (
    ("pre-series-a", r"pre-series a"),
    ("series-a", r"series a"),
    ("series-b", r"series b"),
    ("series-c", r"series c"),
    # Before "seed": a "seed prize" is prize money, not a seed round.
    ("grant", r"grant|award|prize"),
    ("pre-seed", r"pre-seed"),
    ("seed", r"seed"),
    ("bridge", r"bridge"),
    ("debt", r"debt"),
    ("bootstrapped", r"bootstrapped|self-funded"),
)
_NO_STAGE = re.compile(r"^(no |undisclosed|latest|proposed|venture-backed|fundraising|fmo)", re.I)

# Neighbourhoods a record can be placed in when only an area is public.
AREAS = (
    "Westlands", "Kilimani", "Upper Hill", "Lavington", "Kileleshwa", "Parklands", "Karen",
    "Ruaraka", "South B", "South C", "Syokimau", "Hurlingham", "Gigiri", "Riverside",
    "Industrial Area", "Ngara", "Langata", "Embakasi", "Kasarani", "Runda", "Spring Valley",
)
_AREA_IN_TEXT = re.compile(rf"\b({'|'.join(AREAS)}), Nairobi")

_NAME_WORD = r"(?:[A-Z][\w'’.-]*|da|de|van|wa)"
_PERSON = rf"{_NAME_WORD}(?: {_NAME_WORD}){{1,3}}"
_DASH_ROLE = re.compile(rf"^({_PERSON}) [—–-] ([^.;(]+)")
_PAREN_ROLE = re.compile(rf"({_PERSON}) \(([^)]*founder[^)]*)\)", re.I)
_ROLE_WORD = re.compile(r"\b(founder|ceo|cto|coo|cfo|partner|director|chair|president|head|officer|managing)\b", re.I)
# Floor and unit wording inside an address part, and whole parts that locate nothing.
_FLOOR = re.compile(r"\b(?:\d+(?:st|nd|rd|th)|ground|first|second|third)\s+floor\b|\blevel\s+\d+\b|\b\d{5}\b", re.I)
_NOT_ADDRESS_PART = re.compile(
    r"^(?:(?:office|suite|room|block|godown|warehouse|unit)\s*[\w&]{0,5}|(?:right|left|north|south|east|west)\s+wing"
    r"|p\.?\s?o\.?\s?box.*|nairobi(?: county)?|kenya)$",
    re.I,
)
# Roads long enough that "somewhere on it" says little about where an office is.
ARTERIALS = {
    "ngong road", "waiyaki way", "mombasa road", "thika road", "limuru road", "outering road",
    "northern bypass", "southern bypass", "eastern bypass", "langata road", "kiambu road", "jogoo road",
}
_STREET_WORD = r"(?:Road|Rd|Street|St|Avenue|Ave|Drive|Lane|Way|Bypass)"


@dataclass
class Record:
    number: int
    raw_name: str
    name: str
    slug: str
    status: str
    publish: bool
    description: str
    sectors: list[str]
    stage: str | None
    funding_note: str | None
    website: str | None
    domain: str | None
    people: list[tuple[str, str]]
    location_level: str
    premise: str | None
    area: str | None
    place: Place | None = None
    types: list[str] = field(default_factory=lambda: ["startup"])
    founded_year: int | None = None
    city: str = "Nairobi"
    # ISO 3166 two-letter code.
    country: str = "KE"
    # Where a record outside Nairobi is drawn when it has no coordinates of its own.
    city_centre: Place | None = None
    # Coordinates given by the dataset itself, which take precedence over a lookup.
    given: tuple[float, float] | None = None
    # Set when the organisation is already on record from another source.
    existing: str | None = None
    existing_id: str | None = None
    aliases: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    confidence: float | None = None
    precision: str | None = None
    address: str | None = None
    sources: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    raw: dict[str, str] = field(default_factory=dict)
    # The row keyed by field name, kept so later steps need not know the dataset's headings.
    fields: dict[str, str] = field(default_factory=dict)


def slugify(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def display_name(raw: str) -> str:
    """The name without the researcher's bracketed notes: "Pula (Pula Advisors)" is "Pula"."""
    return re.sub(r"\s*\(.*$", "", raw).strip() or raw.strip()


def read_sectors(industry: str) -> list[str]:
    """Up to three tags, in the order the industry text first mentions them."""
    text = industry.lower()
    found = []
    for tag, pattern in SECTOR_RULES:
        match = re.search(pattern, text)
        if match:
            found.append((match.start(), tag))
    return [tag for _, tag in sorted(found)][:3]


def read_stage(status: str) -> str | None:
    opening = re.split(r"[;(.]", status, maxsplit=1)[0].strip()
    if not opening or _NO_STAGE.match(opening):
        return None
    for stage, pattern in STAGE_RULES:
        if re.search(pattern, opening, re.I):
            return stage
    return None


def read_website(text: str) -> tuple[str | None, str | None, bool]:
    """The first URL in the cell, its domain, and whether the cell said more than a URL."""
    match = re.search(r"https?://[^\s;,)]+", text)
    if not match:
        return None, None, False
    url = match.group().rstrip(".")
    domain = re.sub(r"^www\.", "", re.sub(r"^https?://", "", url).split("/")[0].lower())
    return url, domain, text.strip() != match.group()


def read_people(text: str) -> list[tuple[str, str]]:
    """People the text names as founders, with the role as written."""
    people: dict[str, str] = {}
    for part in re.split(r";\s*|\s*\|\s*|(?<=[a-z)])\.\s+", text):
        match = _DASH_ROLE.match(part.strip())
        if match and "founder" in match[2].lower():
            people.setdefault(match[1], match[2].strip().rstrip(","))
    for name, role in _PAREN_ROLE.findall(text):
        # "Founder and CEO (co-founder confirmed by ...)" is a role with a remark, not a person.
        if not _ROLE_WORD.search(name):
            people.setdefault(name, role.strip())
    return [(name, role[:80]) for name, role in people.items()]


_SENTENCE_END = r";|(?<!\bNo)(?<=[a-z)])\.(?:\s|$)"
_STREET = re.compile(rf"^(?:No\.?\s*)?\d+\s+(.+\b{_STREET_WORD})$", re.I)
_IS_STREET = re.compile(rf"\b{_STREET_WORD}(?: (?:North|South|East|West))?$", re.I)
_LEAD_IN = re.compile(r"^(?:off|along|next to|opposite|near)[- ]", re.I)


def clean_address(premise: str) -> str:
    """The address itself: the first one given, without the researcher's remarks."""
    first = re.split(_SENTENCE_END, premise, maxsplit=1)[0]
    first = re.split(r"\s—\s", first, maxsplit=1)[0]  # "... Nairobi — third-party listing"
    first = re.sub(r"^[^,:]{0,40}:\s*", "", first)  # "Workpay parent office: ..."
    return re.sub(r"\s*\([^)]*(\)|$)", "", first).strip().rstrip(".")


def address_parts(premise: str) -> list[str]:
    """The parts of an address that can be found on a map: building, streets, area."""
    parts = []
    for part in re.split(r",|\s[–—]\s", clean_address(premise)):
        part = _LEAD_IN.sub("", _FLOOR.sub("", part).strip(" -"))
        part = re.sub(r"\bRd\b\.?", "Road", part)
        if parts:
            # Past the first part a leading number is a plot number on a street.
            part = re.sub(r"^\d+\s+", "", part)
        if part and not _NOT_ADDRESS_PART.match(part):
            parts.append(part)
    return parts


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _key_word(part: str) -> str:
    """The word that identifies a street or area: "Muthangari" in "Muthangari Drive"."""
    first = part.split()[0]
    return _squash(first if len(first) >= 5 else part)


def find_address(premise: str, geocoder: Geocoder) -> tuple[Place, str] | None:
    """Find a premise on the map, refusing matches that only resemble it.

    A geocoder returns its best guess, which for "Nairobi Garage" can be a car
    garage across town. A building match is kept only when the result carries the
    building's name and something else from the address. Otherwise the record
    falls back to its street, then its area, each checked by name the same way.
    Long arterial roads are skipped: a point on one says too little.
    """
    parts = address_parts(premise)
    if not parts:
        return None
    building, rest = parts[0], parts[1:]
    numbered = _STREET.match(building)
    if numbered:
        # "304 Mandera Road" names a plot on a street, not a building to look up.
        rest = [numbered[1], *rest]
    elif _IS_STREET.search(building):
        rest = parts
    else:
        distinctive = len(building.split()) >= 3
        for query in dict.fromkeys((", ".join(parts), building)):
            place = geocoder.lookup(f"{query}, Nairobi")
            if not place or _squash(building) not in _squash(place.matched):
                continue
            # A street or district result counts only if it is named exactly as the building.
            if place.level == "area" and _squash(place.matched.split(",")[0]) != _squash(building):
                continue
            # The building's name must lead the result, not sit further along its address.
            if _squash(building) not in _squash(",".join(place.matched.split(",")[:2])):
                continue
            if distinctive or any(_key_word(part) in _squash(place.matched) for part in rest):
                return place, "address"
    for index, part in enumerate(rest):
        if part.lower() in ARTERIALS:
            continue
        # With what follows it first, so "Ring Road, Westlands" is not another Ring Road.
        for query in dict.fromkeys((", ".join(rest[index:]), part)):
            place = geocoder.lookup(f"{query}, Nairobi")
            if place and _squash(part) in _squash(place.matched):
                return place, "area"
    return None


# For descriptive categories such as "climate fund manager": the first rule whose
# word appears decides the type. Order matters: an "angel-network manager" is an
# angel network, and a "venture studio" is a program before it is a fund.
TYPE_HINTS: tuple[tuple[str, str], ...] = (
    (r"angel", "angel_network"),
    (r"accelerator", "accelerator"),
    (r"incubator", "incubator"),
    (r"\bhub\b", "innovation_hub"),
    (r"studio|venture builder|support organi[sz]ation", "accelerator"),
    (r"\bvc\b|venture capital|investor|\bfund\b", "fund"),
)


def read_types(text: str) -> tuple[list[str], list[str]]:
    """Organisation types named in a cell, and any words that were not understood."""
    types: list[str] = []
    unknown: list[str] = []
    for word in re.split(r"[;,/|()]| and ", text.lower()):
        word = word.strip()
        if not word:
            continue
        kind = TYPE_WORDS.get(word) or TYPE_WORDS.get(word.rstrip("s"))
        if kind is None:
            kind = next((kind for pattern, kind in TYPE_HINTS if re.search(pattern, word)), None)
        if kind is None:
            unknown.append(word)
        elif kind not in types:
            types.append(kind)
    return types, unknown


def read_sources(text: str) -> list[str]:
    """Every link in a sources cell, in order, without repeats."""
    return list(dict.fromkeys(url.rstrip(".,") for url in re.findall(r"https?://[^\s|;,)]+", text)))


# Words too common in organisation names to identify one website among many.
_GENERIC_NAME_WORDS = {
    "africa", "capital", "ventures", "venture", "fund", "kenya", "network", "accelerator", "partners",
    "limited", "east", "climate", "center", "centre", "innovation", "equity", "global", "group",
}


def own_site(name: str, urls: list[str]) -> tuple[str | None, str | None]:
    """The organisation's own website among its sources: the first whose address carries its name."""
    words = [
        word for word in re.findall(r"[a-z0-9]+", name.lower()) if len(word) >= 4 and word not in _GENERIC_NAME_WORDS
    ]
    for url in urls:
        _, domain, _ = read_website(url)
        squashed = re.sub(r"[^a-z0-9]", "", domain or "")
        if domain and any(word in squashed for word in words):
            return f"https://{domain}/", domain
    return None, None


def to_fields(row: dict[str, str], columns: dict[str, str]) -> dict[str, str]:
    """A dataset row keyed by field name, whatever its own headings are. Absent columns read as empty."""
    return {name: (row.get(column) or "").strip() for name, column in columns.items()}


def parse_row(
    row: dict[str, str],
    columns: dict[str, str] = DEFAULT_COLUMNS,
    position: int = 0,
    publish_all: bool = False,
) -> Record:
    fields = to_fields(row, columns)
    raw_name = fields["name"]
    name = display_name(raw_name)
    # A dataset with no verification column is unverified unless the person loading it vouches for it.
    status = fields["status"] or ("verified" if publish_all else "not_verified")
    website, domain, website_noted = read_website(fields["website"])
    premise = fields["premise"]
    has_premise = bool(premise) and not re.match(r"not publicly (verified|disclosed)", premise, re.I)
    area = _AREA_IN_TEXT.search(fields["location_basis"])
    funding = fields["funding_details"]
    funding_status = fields["funding_status"].rstrip(".")
    people_text = fields["founders"]
    types, unknown_types = read_types(fields["type"])
    references = read_sources(fields["sources"])
    if not website:
        website, domain = own_site(name, references)
    # With no stated level, an address in the row is taken as the address.
    level = fields["location_verification"] or (
        "exact_public_address_verified" if has_premise else "not_publicly_verified"
    )

    record = Record(
        number=int(fields["record"]) if fields["record"].isdigit() else position,
        raw_name=raw_name,
        name=name,
        slug=slugify(name),
        status=status,
        publish=status == "verified",
        description=fields["industry"],
        sectors=read_sectors(fields["industry"]),
        # A stage describes a company raising money, not an investor's fund.
        stage=read_stage(fields["funding_status"]) if not types or "startup" in types else None,
        funding_note=". ".join(part for part in (funding_status, funding) if part) or None,
        website=website,
        domain=domain,
        types=types or ["startup"],
        city=fields["city"] or "Nairobi",
        country=(fields["country"] or "KE").upper(),
        references=references,
        confidence=CONFIDENCE.get(fields["confidence"].lower()),
        people=read_people(people_text),
        location_level=level,
        premise=premise if has_premise else None,
        area=area[1] if area else None,
        sources={
            key: fields[source]
            for key, source in (
                ("name", "source_name"),
                ("office", "source_office"),
                ("funding", "source_funding"),
                ("people", "source_people"),
                ("website", "website"),
            )
            if fields[source].startswith("http")
        },
        raw=dict(row),
    )
    record.fields = fields
    if not name:
        record.notes.append("no name")
    if status not in STATUSES:
        record.notes.append(f"unknown verification status {status!r}")
    if record.location_level not in LOCATION_LEVELS:
        record.notes.append(f"unknown location verification {record.location_level!r}")
    if unknown_types:
        record.notes.append(f"type not recognised: {', '.join(unknown_types)}")
    if fields["founded_year"]:
        year = fields["founded_year"]
        if year.isdigit() and 1800 <= int(year) <= 2100:
            record.founded_year = int(year)
        else:
            record.notes.append(f"founded year not read: {year!r}")
    if fields["latitude"] or fields["longitude"]:
        try:
            lon, lat = float(fields["longitude"]), float(fields["latitude"])
        except ValueError:
            record.notes.append("coordinates not read")
        else:
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                record.notes.append("coordinates not read")
            elif record.city.casefold() == "nairobi" and not in_nairobi(lon, lat):
                record.notes.append("coordinates are outside Nairobi; not used")
            else:
                record.given = (lon, lat)
    if not re.fullmatch(r"[A-Z]{2}", record.country):
        record.notes.append(f"country must be a two-letter code, not {fields['country']!r}")
    if not record.sectors:
        record.notes.append("no sector recognised")
    if website_noted:
        record.notes.append("website cell has a note; first URL used")
    if people_text and not record.people and not re.match(r"(no founders|founder\(s\) not|not publicly)", people_text, re.I):
        record.notes.append("founder text not read")
    return record


def read_dataset(
    path: Path,
    columns: dict[str, str] | None = None,
    publish_all: bool = False,
    aliases: dict[str, list[str]] | None = None,
    statuses: dict[str, str] | None = None,
) -> list[Record]:
    columns = {**DEFAULT_COLUMNS, **(columns or {})}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = [columns[name] for name in REQUIRED_FIELDS if columns[name] not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name} is missing columns: {', '.join(missing)}")
        records = [parse_row(row, columns, position, publish_all) for position, row in enumerate(reader, 1)]
    for record in records:
        record.aliases = list((aliases or {}).get(record.name, []))
        # A status set by the curator for one row outranks the dataset-wide default.
        if record.name in (statuses or {}):
            record.status = statuses[record.name]
            record.publish = record.status == "verified"
            if record.status not in STATUSES:
                record.notes.append(f"unknown verification status {record.status!r}")
    for key, label in (("slug", "name"), ("domain", "website domain")):
        seen = Counter(getattr(record, key) for record in records if getattr(record, key))
        for record in records:
            if seen.get(getattr(record, key), 0) > 1:
                record.notes.append(f"shares its {label} with another row")
    return records


def match_existing(conn, records: list[Record], import_key: str) -> None:
    """Find records that are already on record from somewhere other than this import.

    Matching is by website domain, then by name or any other name either side goes
    by. A match is merged into, never loaded as a second organisation: the existing
    record keeps its id and its links, and gains whatever it was missing.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            select g.id, g.slug, g.website_domain, g.name, g.aliases from organisation g
            where not exists (
              select 1 from review_item r
              where r.record_id = g.id and r.payload->>'import' = %s
                and not coalesce((r.payload->>'merged')::boolean, false)
            )
            """,
            (import_key,),
        )
        existing = cur.fetchall()
    by_domain = {domain: (org_id, name) for org_id, _, domain, name, _ in existing if domain}
    by_slug: dict[str, tuple[str, str]] = {}
    for org_id, slug, _, name, aliases in existing:
        for key in (slug, *map(slugify, aliases)):
            by_slug.setdefault(key, (org_id, name))
    for record in records:
        found = (record.domain and by_domain.get(record.domain)) or next(
            (by_slug[key] for key in (record.slug, *map(slugify, record.aliases)) if key in by_slug), None
        )
        if found:
            record.existing_id, record.existing = found
            record.notes.append(f"already on record as {found[1]}; merged into it")


def locate(record: Record, geocoder: Geocoder) -> None:
    """Place a record as precisely as the public evidence and the geocoder allow."""
    elsewhere = record.city.casefold() != "nairobi"
    if elsewhere and not re.fullmatch(r"[A-Z]{2}", record.country):
        return
    if elsewhere and not record.given:
        # Street addresses are only looked up in Nairobi; elsewhere a record sits at its city's centre.
        record.city_centre = geocoder.city(record.city, record.country)
        if record.city_centre:
            record.precision = "city"
        else:
            record.notes.append(f"city not found: {record.city}, {record.country}; kept without an office")
        return
    if record.given:
        lon, lat = record.given
        record.place = Place(lon, lat, "address", "coordinates given in the dataset")
        record.precision, record.address = "address", clean_address(record.premise) if record.premise else None
        return
    if record.location_level == "not_publicly_verified" and not record.publish:
        return  # No confirmed Nairobi location: the draft is kept without an office.
    if record.premise and record.location_level == "exact_public_address_verified":
        found = find_address(record.premise, geocoder)
        if found:
            record.place, record.precision = found
            record.address = clean_address(record.premise)
            if record.precision == "area":
                record.notes.append("building not confirmed on the map; placed on its street or area")
            return
        record.notes.append("address not found on the map; placed at city level")
    if record.area and (place := geocoder.lookup(f"{record.area}, Nairobi")):
        record.place, record.precision, record.address = place, "area", record.area
        return
    record.precision = "city"


def build_report(records: list[Record], source: str) -> str:
    published = [record for record in records if record.publish]
    precision = Counter(record.precision or "no office" for record in published)
    lines = [
        f"# Import report: {source}",
        "",
        f"- Rows read: {len(records)}",
        f"- Published (verified): {len(published)}",
        f"- Loaded as drafts for review: {len(records) - len(published)}",
        "",
        f"- Already on record, not loaded again: {sum(bool(r.existing) for r in records)}",
        "",
        "## Types",
        "",
        *[f"- {kind}: {count}" for kind, count in Counter(r.types[0] for r in records).most_common()],
        "",
        "## Verification status",
        "",
        *[f"- {status}: {count}" for status, count in Counter(r.status for r in records).most_common()],
        "",
        "## Where published records are placed",
        "",
        *[f"- {level}: {count}" for level, count in precision.most_common()],
        "",
        "## Sectors (published, first tag)",
        "",
        *[f"- {tag}: {count}" for tag, count in Counter(r.sectors[0] if r.sectors else "none" for r in published).most_common()],
        "",
        "## Stage (published)",
        "",
        *[f"- {stage}: {count}" for stage, count in Counter(r.stage or "not stated" for r in published).most_common()],
        "",
        f"## People named as founders: {sum(len(r.people) for r in published)} across "
        f"{sum(bool(r.people) for r in published)} published records",
        "",
        "## Placement of each published record",
        "",
        "| # | Name | Precision | Address used | Matched on the map |",
        "|---|------|-----------|--------------|--------------------|",
        *[
            f"| {r.number} | {r.name} | {r.precision} | {r.address or ''} | {(r.place.matched if r.place else '')[:90]} |"
            for r in published
        ],
        "",
        "## Rows with notes",
        "",
        *[f"- {r.number} {r.name}: {'; '.join(r.notes)}" for r in records if r.notes],
        "",
        "## Drafts (not shown on the map)",
        "",
        *[f"- {r.number} {r.name}: {r.status}" for r in records if not r.publish],
    ]
    return "\n".join(lines) + "\n"


def ensure_city(cur, name: str, country: str, centre: Place) -> None:
    """Record a city's centre, which is where the database draws its city-level offices."""
    cur.execute(
        """
        insert into city (name, country, centroid)
        values (%s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography)
        on conflict (name, country) do nothing
        """,
        (name, country, centre.lon, centre.lat),
    )


def apply(conn, records: list[Record], import_key: str, snapshot: str, replace_sample: bool) -> None:
    """Write the plan in one transaction. Re-running replaces what this import loaded before."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select record_id, payload from review_item where payload->>'import' = %s", (import_key,))
        owned: list[str] = []
        for org_id, payload in cur.fetchall():
            if not payload.get("merged"):
                owned.append(org_id)
                continue
            # A record merged into one that belongs elsewhere: take back only what was added.
            added = payload.get("added", {})
            cur.execute("delete from office where id = any(%s::uuid[])", (added.get("offices", []),))
            cur.execute("delete from person_role where id = any(%s::uuid[])", (added.get("people", []),))
            cur.execute("delete from field_source where id = any(%s::uuid[])", (added.get("sources", []),))
        cur.execute("delete from review_item where payload->>'import' = %s", (import_key,))
        if replace_sample:
            cur.execute("select id from organisation where slug like 'sample-%%'")
            owned += [row[0] for row in cur.fetchall()]
            cur.execute("delete from event where name like 'Sample Meetup %%'")
        if owned:
            cur.execute("delete from field_source where record_type = 'organisation' and record_id = any(%s)", (owned,))
            cur.execute("delete from review_item where record_id = any(%s)", (owned,))
            cur.execute("delete from organisation where id = any(%s)", (owned,))

        for record in records:
            if not record.name:
                continue
            added: dict[str, list[str]] = {"offices": [], "people": [], "sources": []}
            if record.existing_id:
                org_id = record.existing_id
                # Fill what the existing record lacks; never overwrite what it has.
                cur.execute(
                    """
                    update organisation set
                      name = %s,
                      slug = %s,
                      aliases = (select array(select distinct a from unnest(aliases || %s::text[] || array[name]) a where a <> %s)),
                      types = (select array(select distinct t from unnest(types || %s::org_type[]) t)),
                      sectors = case when sectors = '{}' then %s else sectors end,
                      description = case when description is null or description = %s then %s else description end,
                      website_domain = coalesce(website_domain, %s),
                      funding_note = coalesce(funding_note, %s),
                      founded_year = coalesce(founded_year, %s)
                    where id = %s
                    """,
                    (
                        record.name, record.slug, record.aliases, record.name, record.types, record.sectors,
                        INVESTOR_PLACEHOLDER, record.description or None, record.domain, record.funding_note,
                        record.founded_year, org_id,
                    ),
                )
                cur.execute("select count(*) from office where organisation_id = %s and valid_to is null", (org_id,))
                has_office = cur.fetchone()[0] > 0
                cur.execute("select name from person_role where organisation_id = %s", (org_id,))
                known_people = {row[0] for row in cur.fetchall()}
            else:
                cur.execute(
                    """
                    insert into organisation
                      (name, slug, aliases, types, sectors, stage, website_domain, description, status,
                       funding_note, founded_year)
                    values (%s, %s, %s, %s::org_type[], %s, %s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        record.name, record.slug, record.aliases, record.types, record.sectors, record.stage,
                        record.domain, record.description, "published" if record.publish else "draft",
                        record.funding_note, record.founded_year,
                    ),
                )
                org_id = cur.fetchone()[0]
                has_office, known_people = False, set()

            if record.city_centre:
                ensure_city(cur, record.city, record.country, record.city_centre)
            if record.precision and not has_office:
                lon, lat = (record.place.lon, record.place.lat) if record.place else (0.0, 0.0)
                cur.execute(
                    """
                    insert into office (organisation_id, is_hq, address, city, country, geom, precision)
                    values (%s, true, %s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography, %s)
                    returning id
                    """,
                    # A city-precision office is moved to the city centroid by the database.
                    (org_id, record.address, record.city, record.country, lon, lat, record.precision),
                )
                added["offices"].append(str(cur.fetchone()[0]))
            for name, role in record.people:
                if name in known_people:
                    continue
                cur.execute(
                    "insert into person_role (organisation_id, name, role) values (%s, %s, %s) returning id",
                    (org_id, name, role),
                )
                added["people"].append(str(cur.fetchone()[0]))
            sources = dict(record.sources)
            for number, url in enumerate(record.references):
                # The first listed source stands behind the record itself.
                sources.setdefault("name" if number == 0 and not record.existing_id else f"reference {number + 1}", url)
            for field_name, url in sources.items():
                cur.execute(
                    """
                    insert into field_source (record_type, record_id, field, source_url, method, confidence, verified_at)
                    values ('organisation', %s, %s, %s, 'manual', %s, %s)
                    returning id
                    """,
                    (org_id, field_name, url, record.confidence, snapshot if record.publish else None),
                )
                added["sources"].append(str(cur.fetchone()[0]))
            payload = {"import": import_key, "record": record.number, "row": record.raw, "fields": record.fields}
            if record.existing_id:
                payload |= {"merged": True, "added": added}
            cur.execute(
                """
                insert into review_item (record_type, record_id, payload, method, status, reason, reviewed_at)
                values ('organisation', %s, %s, 'manual', %s, %s, %s)
                """,
                (
                    org_id,
                    json.dumps(payload),
                    "approved" if record.publish else "pending",
                    None if record.publish else f"Dataset marks this row {record.status}",
                    snapshot if record.publish else None,
                ),
            )
