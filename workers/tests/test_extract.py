from pathlib import Path

import pytest
from langchain_core.language_models import FakeListChatModel

from atlas_workers.evaluate import evaluate, field_correct, load_labelled
from atlas_workers.extract import Document, ExtractionResult, Value, verify
from atlas_workers.extract.llm import LlmExtractor, groq_model, parse_response
from atlas_workers.extract.rules import RuleExtractor, parse_amount

EXAMPLES = Path(__file__).resolve().parents[2] / "eval" / "labelled.example.jsonl"
DOC = Document(
    "https://example.org/a",
    "Sample Pay raises $2.5 million seed round",
    "Sample Pay has raised $2.5 million in a seed round led by Example Ventures.",
)


def test_rules_read_the_common_headline():
    result = RuleExtractor().extract(DOC)
    assert result.is_funding_announcement
    assert (result.company.value, result.amount.value, result.currency.value) == ("Sample Pay", 2_500_000, "USD")
    assert result.stage.value == "seed"
    assert [v.value for v in result.investors] == ["Example Ventures"]


def test_rules_do_not_invent_a_round():
    result = RuleExtractor().extract(Document("u", "Five things we learned this week", "Seed funding slowed."))
    assert not result.is_funding_announcement
    assert result.amount is None


@pytest.mark.parametrize(
    "title, company, investors",
    [
        ("Egyptian fintech unicorn Sample Pay secures $76.5m deal", "Sample Pay", []),
        ("Nairobi-based Sample Pay raises $1m", "Sample Pay", []),
        ("Crypto accelerator Example Fund invests $500,000 in Kenyan fintech Sample Pay", "Sample Pay", ["Crypto accelerator Example Fund"]),
        ("58 African tech startups raise $583m in funding in Q3", None, []),
        ("Why Sample Money's $7bn IPO doesn't include its fintech business", None, []),
    ],
)
def test_rules_on_headline_shapes(title, company, investors):
    result = RuleExtractor().extract(Document("u", title, ""))
    assert (result.company.value if result.company else None) == company
    assert result.is_funding_announcement is (company is not None)
    assert [v.value for v in result.investors] == investors


@pytest.mark.parametrize(
    "number, scale, expected",
    [("2.5", "million", 2_500_000), ("40", "m", 40_000_000), ("750", "k", 750_000), ("1,200,000", None, 1_200_000)],
)
def test_parse_amount(number, scale, expected):
    assert parse_amount(number, scale) == expected


def test_verify_drops_values_the_text_does_not_support():
    result = ExtractionResult(
        is_funding_announcement=True,
        company=Value("Sample Pay", "Sample  Pay"),  # spacing and case may differ
        stage=Value("series b", "a Series B round"),
        investors=[Value("Example Ventures", "Example Ventures"), Value("Made Up Capital", "Made Up Capital")],
    )
    verify(result, DOC)
    assert result.company is not None
    assert result.stage is None
    assert [v.value for v in result.investors] == ["Example Ventures"]
    assert result.rejected == ["stage", "investors"]


def test_llm_reply_is_parsed_and_malformed_parts_left_out():
    reply = """{"is_funding_announcement": true, "fields": {
        "company": {"value": "Sample Pay", "quote": "Sample Pay"},
        "amount": {"value": "lots", "quote": "$2.5 million"},
        "currency": {"value": "usd", "quote": "$2.5 million"},
        "investors": [{"value": "Example Ventures", "quote": "led by Example Ventures"}, "Loose String"]}}"""
    result = parse_response(reply)
    assert result.company.value == "Sample Pay"
    assert result.amount is None
    assert result.currency.value == "USD"
    assert [v.value for v in result.investors] == ["Example Ventures"]
    assert parse_response("not json").rejected == ["response"]


def test_llm_extractor_runs_on_any_langchain_chat_model():
    reply = '```json\n{"is_funding_announcement": true, "fields": {"stage": {"value": "Seed", "quote": "seed round"}}}\n```'
    model = FakeListChatModel(responses=[reply])
    extractor = LlmExtractor(model=model, model_name="demo")
    result = extractor.extract(DOC)
    assert result.is_funding_announcement
    assert result.stage.value == "seed"
    assert extractor.name == "llm:demo:v2"


def test_groq_model_needs_a_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="GROQ_API_KEY is not set"):
        LlmExtractor()


def test_groq_model_is_configured_for_json(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    model = groq_model()
    assert model.model_name == "openai/gpt-oss-120b"
    assert model.temperature < 0.001
    assert model.model_kwargs == {"response_format": {"type": "json_object"}}


def test_field_scoring():
    result = ExtractionResult(
        is_funding_announcement=True,
        amount=Value(2_499_000.0, "x"),
        investors=[Value("Example Ventures", "x")],
    )
    assert field_correct("amount", result, {"amount": 2_500_000})
    assert not field_correct("amount", result, {"amount": 3_000_000})
    assert field_correct("investors", result, {"investors": ["example ventures"]})
    assert not field_correct("investors", result, {"investors": ["Example Ventures", "Other"]})
    assert field_correct("stage", result, {})  # absent on both sides
    # A label may accept every name a report uses for the company.
    assert field_correct("company", result, {"company": ["Sample Pay Limited", "Sample Pay"]})
    assert not field_correct("company", result, {"company": ["Other Pay", "Another"]})
    assert not field_correct("company", result, {"company": "Sample Pay"})


def test_harness_scores_the_example_set():
    items = load_labelled(EXAMPLES)
    report = evaluate(RuleExtractor(), items)
    assert report.items == 4
    assert report.detection_correct == 4
    assert all(total == 3 for _, total in report.fields.values())
    assert report.fields["amount"] == [3, 3]
    assert "amount" in report.as_text()
    assert report.as_dict()["field_accuracy"]["currency"] == 1.0
