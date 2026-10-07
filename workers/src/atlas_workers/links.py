"""Load relationships between organisations from a CSV: who is part of, hosted by, backed by whom.

Each row reads "from, relation, to". Both organisations must already be on
record and published, and the row must give a link to its evidence. Such a row
is loaded and published. Any other row is not loaded: it goes to the review
queue with the reason, for a person to settle. An organisation is never created
from a name in a relationship file, and a name is never matched by guesswork.
"""

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .importer import display_name, slugify

# Ties kept in organisation_link. Each reads "from <kind> to".
LINK_KINDS = ("part_of", "hosted_by", "member_of", "founded_by", "funded_by", "partner_of")
# Taking part in a programme has tables of its own.
PROGRAMME = "accelerated_at"

# The words a file may use for each relation, and whether they read the other
# way round: "A hosts B" is recorded as "B hosted_by A".
RELATION_WORDS: dict[str, tuple[str, bool]] = {
    "part of": ("part_of", False), "unit of": ("part_of", False), "subsidiary of": ("part_of", False),
    "institute of": ("part_of", False), "parent of": ("part_of", True),
    "hosted by": ("hosted_by", False), "housed at": ("hosted_by", False), "based at": ("hosted_by", False),
    "hosts": ("hosted_by", True),
    "member of": ("member_of", False),
    "founded by": ("founded_by", False), "established by": ("founded_by", False), "founded": ("founded_by", True),
    "funded by": ("funded_by", False), "backed by": ("funded_by", False), "grant from": ("funded_by", False),
    "funds": ("funded_by", True), "backs": ("funded_by", True), "invested in": ("funded_by", True),
    "partner of": ("partner_of", False), "partners with": ("partner_of", False), "partner": ("partner_of", False),
    "accelerated at": (PROGRAMME, False), "programme at": (PROGRAMME, False), "program at": (PROGRAMME, False),
    "alumnus of": (PROGRAMME, False), "took part in a programme at": (PROGRAMME, False),
    **{kind: (kind, False) for kind in (*LINK_KINDS, PROGRAMME)},
}

# Column headings a file may use for each field.
HEADINGS = {
    "source": ("from", "organisation", "source organisation"),
    "relation": ("relation", "relationship", "type"),
    "target": ("to", "related organisation", "target organisation"),
    "label": ("label", "detail", "programme", "program"),
    "url": ("source", "source url", "evidence", "evidence url"),
    "quote": ("quote", "basis"),
}
DEFAULT_PROGRAMME = "Programme"


@dataclass
class Link:
    number: int
    source: str
    relation: str
    target: str
    label: str | None
    url: str | None
    quote: str | None
    row: dict[str, str]
    kind: str | None = None
    source_id: str | None = None
    target_id: str | None = None
    # Why the row is not loaded. None means it will be published.
    problem: str | None = None


def read_file(path: Path) -> list[Link]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        headings = {(name or "").strip().lower(): name for name in reader.fieldnames or []}
        columns = {field: next((headings[word] for word in words if word in headings), None) for field, words in HEADINGS.items()}
        missing = [field for field in ("source", "relation", "target") if columns[field] is None]
        if missing:
            wanted = ", ".join(HEADINGS[field][0] for field in missing)
            raise ValueError(f"{path.name} is missing columns: {wanted}")
        links = []
        for number, row in enumerate(reader, 1):
            cell = lambda field: (row.get(columns[field] or "") or "").strip()  # noqa: E731
            source, target, relation = cell("source"), cell("target"), cell("relation")
            link = Link(
                number=number, source=source, relation=relation, target=target,
                label=cell("label") or None, url=cell("url") or None, quote=cell("quote") or None, row=dict(row),
            )
            reading = RELATION_WORDS.get(" ".join(relation.lower().replace("_", " ").split())) or RELATION_WORDS.get(relation.lower())
            if reading:
                link.kind, turned = reading
                if turned:
                    link.source, link.target = target, source
            links.append(link)
    return links


def resolve(conn, links: list[Link]) -> None:
    """Find each row's organisations on record and decide whether the row can be published."""
    with conn.cursor() as cur:
        cur.execute("select id, slug, aliases, status::text from organisation")
        known: dict[str, tuple[str, str]] = {}
        for org_id, slug, aliases, status in cur.fetchall():
            for key in (slug, *map(slugify, aliases)):
                # A published record wins over a draft that happens to share a name.
                if key not in known or status == "published":
                    known[key] = (str(org_id), status)
        cur.execute(
            "select source_id::text, target_id::text, kind from organisation_link l "
            "where not exists (select 1 from review_item r where r.record_id = l.id and r.record_type = 'organisation_link')"
        )
        elsewhere = set(cur.fetchall())
    seen: dict[tuple, int] = {}
    for link in links:
        problems = []
        if link.kind is None:
            problems.append(f"relation not understood: {link.relation!r}")
        for name, side in ((link.source, "source_id"), (link.target, "target_id")):
            found = known.get(slugify(display_name(name)))
            if not name:
                problems.append("an organisation is not named")
            elif found is None:
                problems.append(f"not on record: {name}")
            elif found[1] != "published":
                problems.append(f"not published: {name}")
            else:
                setattr(link, side, found[0])
        if link.source_id and link.source_id == link.target_id:
            problems.append("both sides are the same organisation")
        if not (link.url or "").lower().startswith(("http://", "https://")):
            problems.append("no link to a source")
        if not problems and link.kind:
            # Two partners are one tie whichever is named first.
            ends = tuple(sorted((link.source_id, link.target_id))) if link.kind == "partner_of" else (link.source_id, link.target_id)
            key = (link.kind, *ends, (link.label or "") if link.kind == PROGRAMME else "")
            if key in seen:
                problems.append(f"repeats row {seen[key]}")
            elif (link.source_id, link.target_id, link.kind) in elsewhere:
                problems.append("already on record from another source")
            seen.setdefault(key, link.number)
        link.problem = "; ".join(problems) or None


def summarise(links: list[Link]) -> str:
    ready = [link for link in links if link.problem is None]
    held = [link for link in links if link.problem is not None]
    lines = [f"{len(links)} rows read: {len(ready)} to publish, {len(held)} for the review queue", ""]
    for link in ready:
        detail = f" ({link.label})" if link.label else ""
        lines.append(f"  {link.source}  --{link.kind}-->  {link.target}{detail}")
    if held:
        lines += ["", "Not loaded:"]
        lines += [f"  row {link.number}: {link.source or '?'} / {link.relation or '?'} / {link.target or '?'}: {link.problem}" for link in held]
    return "\n".join(lines)


def apply(conn, links: list[Link], key: str, snapshot: str) -> None:
    """Replace what this file loaded before with its current contents, in one transaction."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select record_type, record_id, payload from review_item where payload->>'import' = %s", (key,))
        for record_type, record_id, payload in cur.fetchall():
            if record_id is None:
                continue
            if record_type == "organisation_link":
                cur.execute("delete from field_source where record_type = 'organisation_link' and record_id = %s", (record_id,))
                cur.execute("delete from organisation_link where id = %s", (record_id,))
            elif record_type == "program":
                participant = payload["participant"]
                cur.execute("delete from program_participant where program_id = %s and organisation_id = %s", (record_id, participant))
                cur.execute(
                    "delete from field_source where record_type = 'program' and record_id = %s and field = %s",
                    (record_id, f"participant:{participant}"),
                )
                # A programme this file created goes when its last participant does.
                if payload.get("created"):
                    cur.execute(
                        "delete from program p where p.id = %s and not exists "
                        "(select 1 from program_participant pp where pp.program_id = p.id)",
                        (record_id,),
                    )
        cur.execute("delete from review_item where payload->>'import' = %s", (key,))

        created: set[str] = set()
        for link in links:
            payload = {"import": key, "record": link.number, "row": link.row, "kind": link.kind, "from": link.source, "to": link.target}
            if link.problem is not None:
                cur.execute(
                    "insert into review_item (record_type, record_id, payload, method, status, reason) "
                    "values ('organisation_link', null, %s, 'manual', 'pending', %s)",
                    (json.dumps(payload), link.problem),
                )
                continue
            if link.kind == PROGRAMME:
                name = link.label or DEFAULT_PROGRAMME
                cur.execute("select id from program where organisation_id = %s and name = %s", (link.target_id, name))
                row = cur.fetchone()
                if row is None:
                    cur.execute("insert into program (organisation_id, name) values (%s, %s) returning id", (link.target_id, name))
                    row = cur.fetchone()
                    created.add(str(row[0]))
                record_type, record_id, field = "program", row[0], f"participant:{link.source_id}"
                cur.execute(
                    "insert into program_participant (program_id, organisation_id) values (%s, %s) on conflict do nothing",
                    (record_id, link.source_id),
                )
                payload |= {"participant": link.source_id, "created": str(record_id) in created}
            else:
                cur.execute(
                    "insert into organisation_link (source_id, target_id, kind, label, status) "
                    "values (%s, %s, %s, %s, 'published') returning id",
                    (link.source_id, link.target_id, link.kind, link.label),
                )
                record_type, record_id, field = "organisation_link", cur.fetchone()[0], "link"
            cur.execute(
                "insert into field_source (record_type, record_id, field, source_url, method, quote, verified_at) "
                "values (%s, %s, %s, %s, 'manual', %s, %s)",
                (record_type, record_id, field, link.url, link.quote, snapshot),
            )
            cur.execute(
                "insert into review_item (record_type, record_id, payload, method, status, reviewed_at) "
                "values (%s, %s, %s, 'manual', 'approved', %s)",
                (record_type, record_id, json.dumps(payload), snapshot),
            )
