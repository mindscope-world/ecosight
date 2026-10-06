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
"""

import csv
import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .geocode import Geocoder, Place

NAIROBI = ("Nairobi", "KE")

REQUIRED_COLUMNS = (
    "Record #",
    "Startup / organisation",
    "Verification status",
    "Industry",
    "Nairobi basis",
    "Exact public building / premise",
    "Location verification",
    "Funding level / status",
    "Funding details",
    "Founders and public roles",
    "Official website",
)
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
    ("cleantech", r"clean|climate|energy|solar|waste|circular|recycl"),
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
    ("pre-seed", r"pre-seed"),
    ("seed", r"seed"),
    ("bridge", r"bridge"),
    ("debt", r"debt"),
    ("grant", r"grant|award|prize"),
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
    precision: str | None = None
    address: str | None = None
    sources: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    raw: dict[str, str] = field(default_factory=dict)


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
    for part in re.split(r";\s*|(?<=[a-z)])\.\s+", text):
        match = _DASH_ROLE.match(part.strip())
        if match and "founder" in match[2].lower():
            people.setdefault(match[1], match[2].strip().rstrip(","))
    for name, role in _PAREN_ROLE.findall(text):
        people.setdefault(name, role.strip())
    return [(name, role[:80]) for name, role in people.items()]


_SENTENCE_END = r";|(?<!\bNo)(?<=[a-z)])\.(?:\s|$)"
_STREET = re.compile(rf"^(?:No\.?\s*)?\d+\s+(.+\b{_STREET_WORD})$", re.I)
_IS_STREET = re.compile(rf"\b{_STREET_WORD}$", re.I)
_LEAD_IN = re.compile(r"^(?:off|along|next to|opposite|near)[- ]", re.I)


def clean_address(premise: str) -> str:
    """The address itself: the first one given, without the researcher's remarks."""
    first = re.split(_SENTENCE_END, premise, maxsplit=1)[0]
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


def parse_row(row: dict[str, str]) -> Record:
    raw_name = row["Startup / organisation"].strip()
    name = display_name(raw_name)
    status = row["Verification status"].strip()
    website, domain, website_noted = read_website(row.get("Official website", ""))
    premise = row["Exact public building / premise"].strip()
    has_premise = bool(premise) and not premise.lower().startswith("not publicly verified")
    area = _AREA_IN_TEXT.search(row["Nairobi basis"])
    funding = row["Funding details"].strip()
    people_text = row["Founders and public roles"].strip()

    record = Record(
        number=int(row["Record #"]),
        raw_name=raw_name,
        name=name,
        slug=slugify(name),
        status=status,
        publish=status == "verified",
        description=row["Industry"].strip(),
        sectors=read_sectors(row["Industry"]),
        stage=read_stage(row["Funding level / status"]),
        funding_note=f"{row['Funding level / status'].strip().rstrip('.')}. {funding}" if funding else None,
        website=website,
        domain=domain,
        people=read_people(people_text),
        location_level=row["Location verification"].strip(),
        premise=premise if has_premise else None,
        area=area[1] if area else None,
        sources={
            key: row.get(column, "").strip()
            for key, column in (
                ("name", "Identity / Nairobi source URL"),
                ("office", "Location source URL"),
                ("funding", "Funding source URL"),
                ("people", "Founder source URL"),
                ("website", "Official website"),
            )
            if row.get(column, "").strip().startswith("http")
        },
        raw=dict(row),
    )
    if status not in STATUSES:
        record.notes.append(f"unknown verification status {status!r}")
    if record.location_level not in LOCATION_LEVELS:
        record.notes.append(f"unknown location verification {record.location_level!r}")
    if not record.sectors:
        record.notes.append("no sector recognised")
    if website_noted:
        record.notes.append("website cell has a note; first URL used")
    if not record.people and not re.match(r"(no founders|founder\(s\) not|not publicly)", people_text, re.I):
        record.notes.append("founder text not read")
    return record


def read_dataset(path: Path) -> list[Record]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name} is missing columns: {', '.join(missing)}")
        records = [parse_row(row) for row in reader]
    for key, label in (("slug", "name"), ("domain", "website domain")):
        seen = Counter(getattr(record, key) for record in records if getattr(record, key))
        for record in records:
            if seen.get(getattr(record, key), 0) > 1:
                record.notes.append(f"shares its {label} with another row")
    return records


def locate(record: Record, geocoder: Geocoder) -> None:
    """Place a record as precisely as the public evidence and the geocoder allow."""
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


def apply(conn, records: list[Record], import_key: str, snapshot: str, replace_sample: bool) -> None:
    """Write the plan in one transaction. Re-running replaces what this import loaded before."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            "select record_id from review_item where payload->>'import' = %s and record_id is not null",
            (import_key,),
        )
        previous = [row[0] for row in cur.fetchall()]
        if replace_sample:
            cur.execute("select id from organisation where slug like 'sample-%%'")
            previous += [row[0] for row in cur.fetchall()]
            cur.execute("delete from event where name like 'Sample Meetup %%'")
        if previous:
            cur.execute("delete from field_source where record_type = 'organisation' and record_id = any(%s)", (previous,))
            cur.execute("delete from review_item where record_id = any(%s)", (previous,))
            cur.execute("delete from organisation where id = any(%s)", (previous,))

        for record in records:
            cur.execute(
                """
                insert into organisation
                  (name, slug, types, sectors, stage, website_domain, description, status, funding_note)
                values (%s, %s, '{startup}', %s, %s, %s, %s, %s, %s)
                returning id
                """,
                (
                    record.name, record.slug, record.sectors, record.stage, record.domain,
                    record.description, "published" if record.publish else "draft", record.funding_note,
                ),
            )
            org_id = cur.fetchone()[0]
            if record.precision:
                lon, lat = (record.place.lon, record.place.lat) if record.place else (0.0, 0.0)
                cur.execute(
                    """
                    insert into office (organisation_id, is_hq, address, city, country, geom, precision)
                    values (%s, true, %s, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography, %s)
                    """,
                    # A city-precision office is moved to the city centroid by the database.
                    (org_id, record.address, *NAIROBI, lon, lat, record.precision),
                )
            for name, role in record.people:
                cur.execute(
                    "insert into person_role (organisation_id, name, role) values (%s, %s, %s)",
                    (org_id, name, role),
                )
            for field_name, url in record.sources.items():
                cur.execute(
                    """
                    insert into field_source (record_type, record_id, field, source_url, method, verified_at)
                    values ('organisation', %s, %s, %s, 'manual', %s)
                    """,
                    (org_id, field_name, url, snapshot if record.publish else None),
                )
            cur.execute(
                """
                insert into review_item (record_type, record_id, payload, method, status, reason, reviewed_at)
                values ('organisation', %s, %s, 'manual', %s, %s, %s)
                """,
                (
                    org_id,
                    json.dumps({"import": import_key, "record": record.number, "row": record.raw}),
                    "approved" if record.publish else "pending",
                    None if record.publish else f"Dataset marks this row {record.status}",
                    snapshot if record.publish else None,
                ),
            )
