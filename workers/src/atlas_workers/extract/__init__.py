"""Extraction: one interface, a fixed result schema, and a quote behind every value.

Providers differ only in how they read the text. Whatever they return passes
through `verify`, which drops any value whose quote is not in the document, so no
provider can publish something the source does not say.
"""

import re
from dataclasses import dataclass, field
from typing import Protocol

# Fields of a funding announcement. `investors` holds a list; the rest hold one value.
FIELDS = ("company", "amount", "currency", "stage", "investors")

STAGES = ("pre-seed", "seed", "pre-series a", "series a", "series b", "series c", "series d", "debt", "grant")

# JSON schema given to model providers and used to check what they return.
RESULT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["is_funding_announcement", "fields"],
    "properties": {
        "is_funding_announcement": {"type": "boolean"},
        "fields": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "company": {"$ref": "#/$defs/text"},
                "amount": {"$ref": "#/$defs/number"},
                "currency": {"$ref": "#/$defs/text"},
                "stage": {"$ref": "#/$defs/text"},
                "investors": {"type": "array", "items": {"$ref": "#/$defs/text"}},
            },
        },
    },
    "$defs": {
        "text": {
            "type": "object",
            "required": ["value", "quote"],
            "properties": {"value": {"type": "string"}, "quote": {"type": "string"}},
        },
        "number": {
            "type": "object",
            "required": ["value", "quote"],
            "properties": {"value": {"type": "number"}, "quote": {"type": "string"}},
        },
    },
}


@dataclass(frozen=True)
class Document:
    url: str
    title: str
    text: str

    @property
    def full_text(self) -> str:
        return f"{self.title}\n{self.text}"


@dataclass(frozen=True)
class Value:
    value: str | float
    # The words in the document that support the value.
    quote: str


@dataclass
class ExtractionResult:
    is_funding_announcement: bool
    company: Value | None = None
    amount: Value | None = None
    currency: Value | None = None
    stage: Value | None = None
    investors: list[Value] = field(default_factory=list)
    # Values a provider returned that were dropped because the quote was not in the text.
    rejected: list[str] = field(default_factory=list)


class Extractor(Protocol):
    name: str

    def extract(self, document: Document) -> ExtractionResult: ...


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def verify(result: ExtractionResult, document: Document) -> ExtractionResult:
    """Drop every value whose quote does not appear in the document."""
    haystack = _squash(document.full_text)

    def supported(value: Value | None) -> bool:
        return value is not None and bool(value.quote.strip()) and _squash(value.quote) in haystack

    for name in ("company", "amount", "currency", "stage"):
        value = getattr(result, name)
        if value is not None and not supported(value):
            result.rejected.append(name)
            setattr(result, name, None)
    kept = [v for v in result.investors if supported(v)]
    if len(kept) != len(result.investors):
        result.rejected.append("investors")
    result.investors = kept
    return result
