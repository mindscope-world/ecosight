"""Load hand-curated funding rounds for organisations that came from a dataset import.

A person reads each funding note and writes the rounds into a JSON file, with the
words each one was read from. This module checks that file against the database
and loads it. Nothing is inferred here: a round whose quote is not in the stored
note, or whose organisation is not found, stops the load.
"""

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .importer import INVESTOR_PLACEHOLDER, slugify

STAGES = {
    "pre-seed", "seed", "pre-series-a", "series-a", "series-b", "series-c", "bridge", "debt", "grant",
}
INVESTOR_TYPES = {"fund", "angel_network", "accelerator", "corporate", "development_funder", "ngo"}
_DATE = {
    "year": re.compile(r"^\d{4}$"),
    "month": re.compile(r"^\d{4}-(0[1-9]|1[0-2])$"),
    "day": re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"),
}


@dataclass(frozen=True)
class Round:
    record: int
    organisation: str
    stage: str | None
    amount: float | None
    currency: str | None
    date: str | None
    precision: str | None
    investors: tuple[tuple[str, bool], ...]
    quote: str
    source: str | None

    @property
    def announced_on(self) -> str | None:
        """The first day of the stated period, which is what the date column holds."""
        if self.date is None:
            return None
        return {"year": f"{self.date}-01-01", "month": f"{self.date}-01", "day": self.date}[self.precision]


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def read_file(path: Path) -> tuple[dict, list[Round], list[str]]:
    """Parse the curated file and check everything that can be checked without a database."""
    doc = json.loads(path.read_text())
    problems: list[str] = []
    rounds: list[Round] = []
    for index, row in enumerate(doc["rounds"], 1):
        where = f"round {index} ({row.get('organisation')})"
        item = Round(
            record=row["record"],
            organisation=row["organisation"],
            stage=row.get("stage"),
            amount=row.get("amount"),
            currency=row.get("currency"),
            date=row.get("date"),
            precision=row.get("precision"),
            investors=tuple((i["name"], bool(i.get("lead"))) for i in row.get("investors", [])),
            quote=row.get("quote", ""),
            source=row.get("source"),
        )
        rounds.append(item)
        if item.stage is not None and item.stage not in STAGES:
            problems.append(f"{where}: unknown stage {item.stage!r}")
        if (item.amount is None) != (item.currency is None):
            problems.append(f"{where}: amount and currency must be given together")
        if item.amount is not None and item.amount <= 0:
            problems.append(f"{where}: amount must be positive")
        if (item.date is None) != (item.precision is None):
            problems.append(f"{where}: date and precision must be given together")
        elif item.date is not None and not (_DATE.get(item.precision) and _DATE[item.precision].match(item.date)):
            problems.append(f"{where}: date {item.date!r} is not a {item.precision}")
        if item.amount is None and not (item.date and (item.stage or item.investors)):
            problems.append(f"{where}: needs an amount, or a date with a stage or investor")
        if not item.quote.strip():
            problems.append(f"{where}: no quote")
        for name, _ in item.investors:
            if name not in doc["investors"]:
                problems.append(f"{where}: investor {name!r} has no type in the investors list")
    for name, kind in doc["investors"].items():
        if kind not in INVESTOR_TYPES:
            problems.append(f"investor {name!r}: unknown type {kind!r}")
    return doc, rounds, problems


def check_against_database(conn, dataset: str, rounds: list[Round]) -> tuple[dict[int, dict], list[str]]:
    """Find each round's organisation and confirm its quote is in the stored funding note."""
    problems: list[str] = []
    with conn.cursor() as cur:
        cur.execute(
            """
            select (payload->>'record')::int, record_id, payload->'fields'->>'funding_details',
                   payload->'fields'->>'source_funding', g.status::text
            from review_item r join organisation g on g.id = r.record_id
            where r.record_type = 'organisation' and payload->>'import' = %s
            """,
            (dataset,),
        )
        orgs = {
            number: {"id": org_id, "note": note or "", "source": source or "", "status": status}
            for number, org_id, note, source, status in cur.fetchall()
        }
    for index, item in enumerate(rounds, 1):
        where = f"round {index} ({item.organisation})"
        org = orgs.get(item.record)
        if org is None:
            problems.append(f"{where}: record {item.record} was not loaded from {dataset}")
        elif _squash(item.quote) not in _squash(org["note"]):
            problems.append(f"{where}: quote is not in the organisation's funding note")
        elif org["status"] != "published":
            problems.append(f"{where}: the organisation is not published")
    return orgs, problems


def first_url(text: str) -> str | None:
    match = re.search(r"https?://[^\s;]+", text)
    return match.group() if match else None


def summarise(doc: dict, rounds: list[Round]) -> str:
    usd = sum(r.amount for r in rounds if r.currency == "USD")
    lines = [
        f"{len(rounds)} rounds for {len({r.record for r in rounds})} organisations, "
        f"{len(doc['investors'])} investors, USD {usd:,.0f} in rounds with a stated US dollar amount",
        "",
        f"{'Organisation':<26}{'Stage':<14}{'Amount':>16}  {'Date':<11}Investors (* lead)",
    ]
    for r in rounds:
        amount = f"{r.currency} {r.amount:,.0f}" if r.amount is not None else "undisclosed"
        names = ", ".join(("*" if lead else "") + name for name, lead in r.investors)
        lines.append(f"{r.organisation[:25]:<26}{(r.stage or 'not stated'):<14}{amount:>16}  {(r.date or 'no date'):<11}{names}")
    return "\n".join(lines)


def apply(conn, doc: dict, rounds: list[Round], orgs: dict[int, dict]) -> None:
    """Replace what this file loaded before with its current contents, in one transaction."""
    key = f"{doc['dataset']}/rounds"
    snapshot = doc["snapshot"]
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select record_type, record_id from review_item where payload->>'import' = %s", (key,))
        previous = cur.fetchall()
        old_rounds = [record_id for kind, record_id in previous if kind == "funding_round"]
        old_investors = [record_id for kind, record_id in previous if kind == "organisation"]
        # An investor that another import has since added to is no longer this one's to remove.
        cur.execute(
            "select distinct record_id from review_item where record_id = any(%s) and payload->>'import' <> %s",
            (old_investors, key),
        )
        shared = {row[0] for row in cur.fetchall()}
        old_investors = [org_id for org_id in old_investors if org_id not in shared]
        cur.execute("delete from field_source where record_id = any(%s)", (old_rounds + old_investors,))
        cur.execute("delete from review_item where payload->>'import' = %s", (key,))
        cur.execute("delete from funding_round where id = any(%s)", (old_rounds,))
        cur.execute("delete from organisation where id = any(%s)", (old_investors,))

        # Each new investor is sourced to the first round that names it.
        named_in: dict[str, str | None] = {}
        for item in rounds:
            for name, _ in item.investors:
                named_in.setdefault(name, item.source or first_url(orgs[item.record]["source"]))
        investor_ids: dict[str, str] = {}
        for name, kind in doc["investors"].items():
            # By its name or any other name it goes by.
            cur.execute("select id from organisation where slug = %s or %s = any(aliases)", (slugify(name), name))
            row = cur.fetchone()
            if row:  # Already on record from elsewhere: use it, and leave it alone on re-runs.
                investor_ids[name] = row[0]
                continue
            cur.execute(
                """
                insert into organisation (name, slug, types, status, description)
                values (%s, %s, array[%s]::org_type[], 'published', %s) returning id
                """,
                (name, slugify(name), kind, INVESTOR_PLACEHOLDER),
            )
            investor_ids[name] = cur.fetchone()[0]
            cur.execute(
                "insert into review_item (record_type, record_id, payload, method, status, reviewed_at) "
                "values ('organisation', %s, %s, 'manual', 'approved', %s)",
                (investor_ids[name], json.dumps({"import": key, "investor": name}), snapshot),
            )
            cur.execute(
                "insert into field_source (record_type, record_id, field, source_url, method, verified_at) "
                "values ('organisation', %s, 'name', %s, 'manual', %s)",
                (investor_ids[name], named_in.get(name), snapshot),
            )

        for item in rounds:
            org = orgs[item.record]
            in_usd = item.amount if item.currency == "USD" else None
            cur.execute(
                """
                insert into funding_round
                  (organisation_id, stage, amount_original, currency, amount_usd, fx_rate,
                   announced_on, announced_precision, status)
                values (%s, %s, %s, %s, %s, %s, %s, %s, 'published') returning id
                """,
                (
                    org["id"], item.stage, item.amount, item.currency, in_usd,
                    1 if in_usd is not None else None, item.announced_on, item.precision,
                ),
            )
            round_id = cur.fetchone()[0]
            for name, lead in item.investors:
                cur.execute(
                    "insert into round_investor (round_id, investor_id, is_lead) values (%s, %s, %s)",
                    (round_id, investor_ids[name], lead),
                )
            cur.execute(
                """
                insert into field_source (record_type, record_id, field, source_url, method, quote, verified_at)
                values ('funding_round', %s, 'round', %s, 'manual', %s, %s)
                """,
                (round_id, item.source or first_url(org["source"]), item.quote, snapshot),
            )
            cur.execute(
                "insert into review_item (record_type, record_id, payload, method, status, reviewed_at) "
                "values ('funding_round', %s, %s, 'manual', 'approved', %s)",
                (round_id, json.dumps({"import": key, "record": item.record, "quote": item.quote}), snapshot),
            )
