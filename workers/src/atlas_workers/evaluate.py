"""Accuracy harness: run an extractor over the labelled set and score each field.

A field counts as correct when the extracted value equals the label after light
normalisation, including when both are absent. The report is what gets pasted
into a pull request that changes a prompt, a model or a rule.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .extract import FIELDS, Document, ExtractionResult, Extractor, verify


@dataclass(frozen=True)
class LabelledItem:
    id: str
    document: Document
    is_funding_announcement: bool
    expected: dict


def load_labelled(path: Path) -> list[LabelledItem]:
    items = []
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        try:
            items.append(
                LabelledItem(
                    id=row["id"],
                    document=Document(row["url"], row["title"], row["text"]),
                    is_funding_announcement=row["is_funding_announcement"],
                    expected=row.get("expected", {}),
                )
            )
        except KeyError as missing:
            raise ValueError(f"{path}:{number} is missing {missing}") from None
    return items


def _name(text: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text).casefold()).strip()


def field_correct(name: str, result: ExtractionResult, expected: dict) -> bool:
    want = expected.get(name)
    if name == "investors":
        return {_name(v.value) for v in result.investors} == {_name(v) for v in want or []}
    got = getattr(result, name)
    if want is None or got is None:
        return want is None and got is None
    if name == "amount":
        # Reported amounts are rounded, so allow half a percent.
        return abs(float(got.value) - float(want)) <= 0.005 * abs(float(want))
    return _name(got.value) == _name(want)


@dataclass
class Report:
    extractor: str
    items: int = 0
    detection_correct: int = 0
    # Per field: [correct, scored]. Fields are scored on real announcements only.
    fields: dict[str, list[int]] = field(default_factory=lambda: {f: [0, 0] for f in FIELDS})
    rejected_quotes: int = 0
    failures: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        ratio = lambda c, n: round(c / n, 4) if n else None
        return {
            "extractor": self.extractor,
            "items": self.items,
            "detection_accuracy": ratio(self.detection_correct, self.items),
            "field_accuracy": {f: ratio(c, n) for f, (c, n) in self.fields.items()},
            "rejected_quotes": self.rejected_quotes,
        }

    def as_text(self) -> str:
        def row(label: str, correct: int, total: int) -> str:
            share = f"{correct / total:.1%}" if total else "n/a"
            return f"{label:<26}{correct:>4} / {total:<4} {share:>7}"

        lines = [f"Extractor: {self.extractor}", f"Labelled items: {self.items}", ""]
        lines.append(row("is funding announcement", self.detection_correct, self.items))
        lines += [row(name, c, n) for name, (c, n) in self.fields.items()]
        lines.append(f"\nValues dropped for an unsupported quote: {self.rejected_quotes}")
        return "\n".join(lines)


def evaluate(extractor: Extractor, items: list[LabelledItem]) -> Report:
    report = Report(extractor=extractor.name)
    for item in items:
        result = verify(extractor.extract(item.document), item.document)
        report.items += 1
        report.rejected_quotes += len(result.rejected)
        report.detection_correct += result.is_funding_announcement == item.is_funding_announcement
        if not item.is_funding_announcement:
            continue
        for name in FIELDS:
            ok = field_correct(name, result, item.expected)
            report.fields[name][0] += ok
            report.fields[name][1] += 1
            if not ok:
                report.failures.append(f"{item.id}: {name}")
    return report
