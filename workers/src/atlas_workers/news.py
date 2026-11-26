"""Read stored news documents and put the funding rounds they report in the review queue.

Each document the crawler stored is read once by an extractor. A report that one
named company raised money becomes a proposed round, waiting in the review queue
with the article's link and the words each value was read from. Nothing is
published here: a round goes on record only when a reviewer approves it, and the
company and investors are matched to records on file at that point, by name.
"""

import json
from dataclasses import dataclass
from datetime import date
from email.utils import parsedate_to_datetime

from .confidence import assess, known_organisations
from .extract import Document, ExtractionResult, Extractor, Value, verify
from .importer import display_name, slugify
from .store import RawStore

IMPORT_KEY = "news"
AUTO_REASON = "Published automatically: a small round in US dollars whose company is on record, with every value quoted from the article. No person has reviewed it"
# Why every proposal waits for a person, whatever the extractor made of it.
REASON = "Read from a news report by an extractor; a person must confirm it before it is published"


@dataclass
class Outcome:
    read: int = 0
    proposed: int = 0
    auto_approved: int = 0
    unreadable: int = 0
    # Why the run ended before every document was read, when it did.
    stopped: str | None = None


def published_on(text: str | None) -> date | None:
    """The day a feed says an entry was published. Feeds write it as an email date; some write ISO."""
    if not text:
        return None
    try:
        return parsedate_to_datetime(text).date()
    except (TypeError, ValueError):
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _stated(value: Value | None) -> dict | None:
    return None if value is None else {"value": value.value, "quote": value.quote}


def proposal(stored: dict, result: ExtractionResult, extractor: str, document_id: str, confidence: float | None = None) -> dict:
    """What the review queue holds for one reported round: every value with the words behind it."""
    day = published_on(stored.get("published"))
    return {
        "import": IMPORT_KEY,
        "news": True,
        "document": document_id,
        "extractor": extractor,
        "confidence": confidence,
        "url": stored["url"],
        "title": stored["title"],
        "publisher": stored.get("source"),
        # A report is dated by when it was published, which is when the round was announced.
        "published": day.isoformat() if day else None,
        "company": _stated(result.company),
        "amount": _stated(result.amount),
        "currency": _stated(result.currency),
        "stage": _stated(result.stage),
        "investors": [_stated(investor) for investor in result.investors],
    }


def unread(conn) -> list[tuple[str, str]]:
    """Stored documents no extractor has read yet, oldest first."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select d.id, d.url from raw_document d
            where not exists (select 1 from news_extraction e where e.document_id = d.id)
            order by d.fetched_at, d.id
            """
        )
        return [(str(document_id), url) for document_id, url in cur.fetchall()]


def publish(cur, payload: dict, known: dict[str, str], company_id: str) -> str:
    """Publish an auto-approved round: the rows a reviewer's approval writes, with no reviewer recorded."""
    amount, currency = payload["amount"]["value"], payload["currency"]["value"].upper()
    stage = payload["stage"]["value"].lower().replace(" ", "-") if payload["stage"] else None
    cur.execute(
        "insert into funding_round (organisation_id, stage, amount_original, currency, amount_usd, fx_rate, announced_on, announced_precision, status) "
        "values (%s, %s, %s, %s, %s, 1, %s, %s, 'published') returning id",
        (company_id, stage, amount, currency, amount, payload["published"], "day" if payload["published"] else None),
    )
    round_id = cur.fetchone()[0]
    keys = (slugify(display_name(i["value"])) for i in payload["investors"])
    for investor in {known[k] for k in keys if k in known and known[k] != company_id}:
        cur.execute("insert into round_investor (round_id, investor_id) values (%s, %s) on conflict do nothing", (round_id, investor))
    quote = " … ".join(v["quote"] for v in (payload["company"], payload["amount"], payload["stage"]) if v) or payload["title"]
    cur.execute(
        "insert into field_source (record_type, record_id, field, source_url, method, quote, confidence, verified_at) "
        "values ('funding_round', %s, 'round', %s, 'ai', %s, %s, now())",
        (round_id, payload["url"], quote, payload["confidence"]),
    )
    cur.execute(
        "insert into audit_log (actor, record_type, record_id, field, new_value) values (null, 'funding_round', %s, 'status', '\"published\"')",
        (round_id,),
    )
    return str(round_id)


def read_news(conn, store: RawStore, extractor: Extractor, apply: bool, auto_approve: bool = False) -> tuple[Outcome, list[dict]]:
    """Read every unread document. With `apply`, record each reading and queue what it proposes.

    With `auto_approve`, a round that passes every test in `confidence.assess` is published as well.
    """
    outcome, proposals = Outcome(), []
    known = known_organisations(conn)
    for document_id, url in unread(conn):
        try:
            stored = json.loads(store.get(document_id))
            document = Document(stored["url"], stored["title"], stored.get("text", ""))
        except (KeyError, ValueError, OSError):
            # The stored bytes are gone or are not a feed entry. It is left unread, to be looked at.
            outcome.unreadable += 1
            continue
        try:
            extracted = extractor.extract(document)
        except Exception as error:  # noqa: BLE001 - a hosted model can fail in ways this code cannot list
            # A model that is out of allowance or cannot be reached ends the run. What was read stands,
            # and this document and those after it are still unread, so the next run takes them up.
            outcome.stopped = f"{type(error).__name__}: {str(error)[:200]}"
            break
        outcome.read += 1
        result = verify(extracted, document)
        # A round with no company named, once checked against the text, proposes nothing.
        funding = result.is_funding_announcement and result.company is not None
        day = published_on(stored.get("published"))
        assessment = assess(result, day.isoformat() if day else None, stored["url"], known, conn) if funding else None
        payload = proposal(stored, result, extractor.name, document_id, assessment.score) if funding else None
        if payload:
            payload["blockers"] = assessment.blockers
            outcome.proposed += 1
            outcome.auto_approved += int(auto_approve and assessment.auto_approvable and apply)
            proposals.append(payload)
        if not apply:
            continue
        with conn.transaction(), conn.cursor() as cur:
            item_id = None
            if payload:
                automatic = auto_approve and assessment.auto_approvable
                cur.execute(
                    "insert into review_item (record_type, payload, method, status, reason) "
                    "values ('funding_round', %s, 'ai', %s, %s) returning id",
                    (json.dumps(payload), "approved" if automatic else "pending", AUTO_REASON if automatic else REASON),
                )
                item_id = cur.fetchone()[0]
                if automatic:
                    round_id = publish(cur, payload, known, assessment.company_id)
                    cur.execute(
                        "update review_item set record_id = %s, reviewed_at = now(), payload = payload || %s where id = %s",
                        (round_id, json.dumps({"auto_approved": True, "organisation_id": assessment.company_id}), item_id),
                    )
            cur.execute(
                "insert into news_extraction (document_id, extractor, is_funding, review_item_id) values (%s, %s, %s, %s)",
                (document_id, extractor.name, funding, item_id),
            )
    return outcome, proposals


def summarise(outcome: Outcome, proposals: list[dict]) -> str:
    lines = [
        f"{outcome.read} documents read, {outcome.proposed} report a funding round"
        + (f", {outcome.auto_approved} published automatically" if outcome.auto_approved else "")
        + (f", {outcome.unreadable} could not be read" if outcome.unreadable else ""),
        "",
    ]
    if outcome.stopped:
        lines[1:1] = [f"Stopped early; the rest are left for the next run. The extractor failed with {outcome.stopped}"]
    for item in proposals:
        amount, currency, stage = item["amount"], item["currency"], item["stage"]
        money = f"{currency['value'] if currency else ''} {amount['value']:,.0f}".strip() if amount else "amount not stated"
        investors = ", ".join(investor["value"] for investor in item["investors"]) or "no investor named"
        lines.append(f"{item['company']['value'][:30]:<31}{money:>18}  {(stage['value'] if stage else 'no stage'):<13}{item['published'] or 'undated':<11} {investors}")
        lines.append(f"    {item['title'][:110]}")
        verdict = "may be published automatically" if not item["blockers"] else "needs a person: " + "; ".join(item["blockers"])
        lines.append(f"    confidence {item['confidence']:.2f}, {verdict}")
    return "\n".join(lines)
