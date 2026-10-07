"""Place organisations that are on record with no office, at the centre of a named city.

Some organisations are known only by name: an investor named in a funding round,
for instance. A curated file gives each one a city and country, and says on what
basis. They are placed at city level, never at an address, and each placement
carries its basis so a reader can see how firm it is.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .geocode import Geocoder, Place
from .importer import ensure_city, slugify


@dataclass
class Placement:
    name: str
    city: str
    country: str
    basis: str
    # The page the city was taken from, when it was looked up and not simply known.
    source: str | None = None
    org_id: str | None = None
    centre: Place | None = None
    problem: str | None = None


def read_file(path: Path) -> tuple[dict, list[Placement]]:
    doc = json.loads(path.read_text())
    placements = []
    for row in doc["placements"]:
        item = Placement(
            row["name"], row["city"], row["country"].upper(), row.get("basis", doc.get("basis", "")), row.get("source")
        )
        if not re.fullmatch(r"[A-Z]{2}", item.country):
            item.problem = f"country must be a two-letter code, not {row['country']!r}"
        elif not item.basis.strip():
            item.problem = "no basis given"
        placements.append(item)
    return doc, placements


def resolve(conn, placements: list[Placement], geocoder: Geocoder, key: str) -> None:
    """Find each organisation and its city. Anything not found is marked, not guessed."""
    with conn.cursor() as cur:
        for item in placements:
            if item.problem:
                continue
            cur.execute(
                "select id, status::text from organisation where slug = %s or %s = any(aliases)",
                (slugify(item.name), item.name),
            )
            row = cur.fetchone()
            if row is None:
                item.problem = "no organisation of this name is on record"
                continue
            item.org_id = row[0]
            # An office from anywhere but an earlier run of this file means it is already placed.
            cur.execute(
                """
                select count(*) from office o
                where o.organisation_id = %s and o.valid_to is null and not exists (
                  select 1 from review_item r
                  where r.payload->>'import' = %s and r.payload->>'office' = o.id::text
                )
                """,
                (item.org_id, key),
            )
            if cur.fetchone()[0]:
                item.problem = "already has an office; left as it is"
                continue
            item.centre = geocoder.city(item.city, item.country)
            if item.centre is None:
                item.problem = f"city not found: {item.city}, {item.country}"


def summarise(placements: list[Placement]) -> str:
    ready = [item for item in placements if not item.problem]
    lines = [f"{len(ready)} of {len(placements)} can be placed", ""]
    lines += [f"{item.name[:38]:<40}{item.city}, {item.country}" for item in ready]
    skipped = [item for item in placements if item.problem]
    if skipped:
        lines += ["", "Not placed:"] + [f"  {item.name}: {item.problem}" for item in skipped]
    return "\n".join(lines)


def apply(conn, doc: dict, placements: list[Placement], key: str) -> None:
    """Replace what this file placed before with its current contents, in one transaction."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select payload from review_item where payload->>'import' = %s", (key,))
        for (payload,) in cur.fetchall():
            cur.execute("delete from office where id = %s", (payload.get("office"),))
            cur.execute("delete from field_source where id = %s", (payload.get("source"),))
        cur.execute("delete from review_item where payload->>'import' = %s", (key,))
        for item in placements:
            if item.problem:
                continue
            ensure_city(cur, item.city, item.country, item.centre)
            cur.execute(
                """
                insert into office (organisation_id, is_hq, city, country, geom, precision)
                values (%s, true, %s, %s, st_setsrid(st_makepoint(%s, %s), 4326)::geography, 'city')
                returning id
                """,
                (item.org_id, item.city, item.country, item.centre.lon, item.centre.lat),
            )
            office_id = cur.fetchone()[0]
            # A stated basis, a link where the city was looked up, and a middling confidence: this is how the card shows it.
            cur.execute(
                """
                insert into field_source (record_type, record_id, field, source_url, method, quote, confidence)
                values ('organisation', %s, 'office', %s, 'manual', %s, %s) returning id
                """,
                (item.org_id, item.source, item.basis, doc.get("confidence", 0.5)),
            )
            source_id = cur.fetchone()[0]
            cur.execute(
                "insert into review_item (record_type, record_id, payload, method, status, reason) "
                "values ('organisation', %s, %s, 'manual', 'approved', %s)",
                (
                    item.org_id,
                    json.dumps({"import": key, "merged": True, "office": str(office_id), "source": str(source_id)}),
                    "City-level placement awaiting a sourced address",
                ),
            )
