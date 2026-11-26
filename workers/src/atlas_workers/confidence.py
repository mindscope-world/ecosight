"""How far to trust a round read from a news report, and which ones may skip a reviewer.

The score is the share of what a round needs that was read, quoted from the text and
checked against records on file. It orders the review queue and gates auto-approval.
Auto-approval is opt-in (`atlas extract-news --auto-approve`) and deliberately narrow:
a round is published without a person only when every condition in `auto_approvable`
holds. A round of more than USD 1 million, or one whose size is not stated in dollars,
always goes to a person.
"""

from dataclasses import dataclass

from .extract import ExtractionResult
from .importer import display_name, slugify

# Rounds above this, in US dollars, always wait for a person.
AUTO_APPROVE_CEILING_USD = 1_000_000
AUTO_APPROVE_MINIMUM = 0.85

WEIGHTS = {"company": 0.30, "company_on_record": 0.20, "amount": 0.25, "stage": 0.10, "investors": 0.10, "dated": 0.05}
# Taken off for each value the extractor gave that the article's text does not support.
UNSUPPORTED_PENALTY = 0.10


@dataclass(frozen=True)
class Assessment:
    score: float
    company_id: str | None
    duplicate: bool
    # Why the round needs a person; empty when it may be published without one.
    blockers: list[str]

    @property
    def auto_approvable(self) -> bool:
        return not self.blockers


def known_organisations(conn) -> dict[str, str]:
    """Published organisations by every name they go by. A name two records share is left out as ambiguous."""
    found: dict[str, str | None] = {}
    with conn.cursor() as cur:
        cur.execute("select id, slug, aliases from organisation where status = 'published'")
        for org_id, slug, aliases in cur.fetchall():
            for key in {slug, *map(slugify, aliases)}:
                found[key] = str(org_id) if found.get(key, str(org_id)) == str(org_id) else None
    return {key: value for key, value in found.items() if value}


def is_duplicate(conn, company_id: str, amount: float | None, currency: str | None, stage: str | None) -> bool:
    """The same sum in the same currency, or the same named stage, is taken to be a round already on record."""
    with conn.cursor() as cur:
        cur.execute(
            "select 1 from funding_round where organisation_id = %s and status = 'published' and "
            "((%s::numeric is not null and amount_original = %s and currency = %s) or (%s::text is not null and stage = %s)) limit 1",
            (company_id, amount, amount, currency, stage, stage),
        )
        return cur.fetchone() is not None


def assess(result: ExtractionResult, published: str | None, source_url: str, known: dict[str, str], conn=None) -> Assessment:
    """Score one verified extraction. `result` must already have passed `verify`."""
    company_id = known.get(slugify(display_name(str(result.company.value)))) if result.company else None
    amount = result.amount.value if result.amount and isinstance(result.amount.value, (int, float)) else None
    currency = str(result.currency.value).upper() if result.currency else None
    stage = str(result.stage.value).lower().replace(" ", "-") if result.stage else None

    score = 0.0
    score += WEIGHTS["company"] if result.company else 0
    score += WEIGHTS["company_on_record"] if company_id else 0
    score += WEIGHTS["amount"] if amount is not None and currency else 0
    score += WEIGHTS["stage"] if stage else 0
    score += WEIGHTS["investors"] if result.investors else 0
    score += WEIGHTS["dated"] if published else 0
    score = max(0.0, score - UNSUPPORTED_PENALTY * len(result.rejected))

    duplicate = bool(conn and company_id and is_duplicate(conn, company_id, amount, currency, stage))

    blockers = []
    if not company_id:
        blockers.append("the company is not a single published record")
    if amount is None or currency is None:
        blockers.append("the amount is not stated with its currency")
    elif currency != "USD":
        blockers.append(f"the amount is in {currency}, not US dollars")
    elif amount > AUTO_APPROVE_CEILING_USD:
        blockers.append("the round is above USD 1 million")
    if not source_url.lower().startswith(("http://", "https://")):
        blockers.append("there is no link to the source")
    if result.rejected:
        blockers.append("the extractor gave values the text does not support")
    if duplicate:
        blockers.append("it repeats a round already on record")
    if score < AUTO_APPROVE_MINIMUM:
        blockers.append(f"confidence {score:.2f} is below {AUTO_APPROVE_MINIMUM}")
    return Assessment(round(score, 2), company_id, duplicate, blockers)
