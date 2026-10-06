"""Rule-based extractor: regular expressions over the headline and text.

It costs nothing to run and needs no model, so it is the baseline every model
provider has to beat on the labelled set. It only understands two headline shapes:
"<Company> raises <amount> ..." and "<Investor> invests <amount> in <Company>".
"""

import re

from . import Document, ExtractionResult, Value

_VERB = r"(?:raises?|raised|secures?|secured|closes?|closed|lands?|bags?|gets?|receives?|nets?|announces?)"
_MONEY = r"(?P<symbol>US\$|USD|KES|KSh|NGN|ZAR|EUR|GBP|\$|€|£|₦)\s?(?P<number>\d[\d,]*(?:\.\d+)?)\s?(?P<scale>k|m|mn|million|bn|billion)?\b"
# "<Investor> invests <amount> in <Company>"
_INVESTS = re.compile(rf"^(?P<investor>.+?)\s+invests?\s+(?P<money>{_MONEY})\s+in\s+(?P<company>.+)$", re.I)
_HEADLINE = re.compile(rf"^(?P<company>.+?)\s+{_VERB}\s+(?:an?\s+|its\s+)?(?:.*?)(?P<money>{_MONEY})", re.I)
_MONEY_RE = re.compile(_MONEY, re.I)
_STAGE = re.compile(r"\b(pre[- ]seed|pre[- ]series[- ]a|series[- ][a-d]|seed|debt|grant)\b", re.I)
_LED_BY = re.compile(
    r"\b(?:co-)?led by (?P<names>.+?)(?:,? with\b|,? alongside\b|\.|;| while\b|$)", re.I
)

_SCALE = {"k": 1e3, "m": 1e6, "mn": 1e6, "million": 1e6, "bn": 1e9, "billion": 1e9}
_CURRENCY = {"$": "USD", "us$": "USD", "usd": "USD", "ksh": "KES", "kes": "KES", "ngn": "NGN", "₦": "NGN", "zar": "ZAR", "eur": "EUR", "€": "EUR", "gbp": "GBP", "£": "GBP"}
# Descriptions in front of a company name: "Kenyan fintech", "Lagos-based startup".
_PREFIX = re.compile(
    r"^(?:.*\b(?:startup|fintech|agritech|healthtech|edtech|insurtech|cleantech|unicorn|firm"
    r"|company|platform|marketplace|provider|lender)|[\w' ]+-based)\s+(?=\S)",
    re.I,
)


def company_name(text: str) -> str:
    return _PREFIX.sub("", text).strip(" ,:")


def parse_amount(number: str, scale: str | None) -> float:
    return float(number.replace(",", "")) * _SCALE.get((scale or "").lower(), 1)


def normalise_stage(text: str) -> str:
    return re.sub(r"[- ]+", " ", text.lower()).replace("pre seed", "pre-seed").replace("pre series", "pre-series")


class RuleExtractor:
    name = "rules"

    def extract(self, document: Document) -> ExtractionResult:
        headline = _INVESTS.match(document.title) or _HEADLINE.match(document.title)
        company = company_name(headline["company"]) if headline else ""
        # "58 startups raise $583m" is a market summary, not one company's round.
        if not headline or not company or company[0].isdigit():
            return ExtractionResult(is_funding_announcement=False)

        result = ExtractionResult(is_funding_announcement=True, company=Value(company, company))
        money = headline["money"]
        result.amount = Value(parse_amount(headline["number"], headline["scale"]), money)
        result.currency = Value(_CURRENCY[headline["symbol"].lower()], money)
        if investor := headline.groupdict().get("investor"):
            investor = company_name(investor)
            result.investors.append(Value(investor, investor))

        text = document.full_text
        if stage := _STAGE.search(text):
            result.stage = Value(normalise_stage(stage[1]), stage[0])
        if led := _LED_BY.search(text):
            known = {v.value for v in result.investors}
            for name in re.split(r",\s*|\s+and\s+", led["names"]):
                name = name.strip()
                if name and name[0].isupper() and name not in known:
                    result.investors.append(Value(name, name))
        return result
