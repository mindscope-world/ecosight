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

from .extract import Document, ExtractionResult, Extractor, Value, verify
from .store import RawStore

IMPORT_KEY = "news"
# Why every proposal waits for a person, whatever the extractor made of it.
REASON = "Read from a news report by an extractor; a person must confirm it before it is published"


@dataclass
class Outcome:
    read: int = 0
    proposed: int = 0
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


def proposal(stored: dict, result: ExtractionResult, extractor: str, document_id: str) -> dict:
    """What the review queue holds for one reported round: every value with the words behind it."""
    day = published_on(stored.get("published"))
    return {
        "import": IMPORT_KEY,
        "news": True,
        "document": document_id,
        "extractor": extractor,
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


def read_news(conn, store: RawStore, extractor: Extractor, apply: bool) -> tuple[Outcome, list[dict]]:
    """Read every unread document. With `apply`, record each reading and queue what it proposes."""
    outcome, proposals = Outcome(), []
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
        payload = proposal(stored, result, extractor.name, document_id) if funding else None
        if payload:
            outcome.proposed += 1
            proposals.append(payload)
        if not apply:
            continue
        with conn.transaction(), conn.cursor() as cur:
            item_id = None
            if payload:
                cur.execute(
                    "insert into review_item (record_type, payload, method, status, reason) "
                    "values ('funding_round', %s, 'ai', 'pending', %s) returning id",
                    (json.dumps(payload), REASON),
                )
                item_id = cur.fetchone()[0]
            cur.execute(
                "insert into news_extraction (document_id, extractor, is_funding, review_item_id) values (%s, %s, %s, %s)",
                (document_id, extractor.name, funding, item_id),
            )
    return outcome, proposals


def summarise(outcome: Outcome, proposals: list[dict]) -> str:
    lines = [
        f"{outcome.read} documents read, {outcome.proposed} report a funding round"
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
    return "\n".join(lines)
