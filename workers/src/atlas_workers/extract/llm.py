"""Model-backed extractor, built on LangChain chat models.

The default model runs on Groq. Any other LangChain chat model can be passed in,
so changing provider is a change of constructor argument, not of this code.
"""

import json
import re

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from .. import config
from . import RESULT_SCHEMA, STAGES, Document, ExtractionResult, Value

PROMPT_VERSION = "v1"

SYSTEM_PROMPT = f"""You extract facts about startup funding rounds from news text.
Return JSON only, matching this schema:
{json.dumps(RESULT_SCHEMA)}

Rules:
- is_funding_announcement is true only if the text reports that one named company raised money.
  Market summaries about many companies, launches, hires and opinion pieces are false.
- company: the company that received the money, without descriptions such as "Kenyan fintech".
- amount: the full number in the stated currency with thousands and millions written out:
  2500000 for "$2.5 million", 76500000 for "$76.5m", 500000 for "$500k". Never 2.5 or 76.5.
- currency: the ISO 4217 code, for example USD or KES.
- stage: one of {", ".join(STAGES)}.
- investors: every named investor in the round.
- Every value needs a quote: the exact words copied from the text that support it.
- Leave a field out when the text does not state it. Never guess."""


def _value(raw: object, number: bool = False) -> Value | None:
    if not isinstance(raw, dict) or "value" not in raw or not isinstance(raw.get("quote"), str):
        return None
    value = raw["value"]
    if number:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return Value(float(value), raw["quote"])
    return Value(str(value).strip(), raw["quote"]) if str(value).strip() else None


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


def parse_response(content: str) -> ExtractionResult:
    """Turn a model reply into a result. Anything malformed is left out, not repaired."""
    content = _FENCE.sub("", content.strip())
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return ExtractionResult(is_funding_announcement=False, rejected=["response"])
    if not isinstance(data, dict):
        return ExtractionResult(is_funding_announcement=False, rejected=["response"])
    fields = data.get("fields") if isinstance(data.get("fields"), dict) else {}
    investors = fields.get("investors") if isinstance(fields.get("investors"), list) else []
    stage = _value(fields.get("stage"))
    if stage is not None:
        stage = Value(str(stage.value).lower(), stage.quote)
    currency = _value(fields.get("currency"))
    if currency is not None:
        currency = Value(str(currency.value).upper(), currency.quote)
    return ExtractionResult(
        is_funding_announcement=data.get("is_funding_announcement") is True,
        company=_value(fields.get("company")),
        amount=_value(fields.get("amount"), number=True),
        currency=currency,
        stage=stage,
        investors=[v for v in map(_value, investors) if v is not None],
    )


def groq_model() -> BaseChatModel:
    from langchain_groq import ChatGroq

    return ChatGroq(
        model=config.GROQ_MODEL,
        api_key=config.groq_api_key(),
        temperature=0,
        # The free tier is rate limited; retries wait out a 429.
        max_retries=5,
        model_kwargs={"response_format": {"type": "json_object"}},
    )


class LlmExtractor:
    def __init__(self, model: BaseChatModel | None = None, model_name: str | None = None) -> None:
        self.model = model or groq_model()
        self.name = f"llm:{model_name or config.GROQ_MODEL}:{PROMPT_VERSION}"

    def extract(self, document: Document) -> ExtractionResult:
        reply = self.model.invoke(
            [
                SystemMessage(SYSTEM_PROMPT),
                # Long articles are cut: the round is reported in the opening paragraphs.
                HumanMessage(document.full_text[:6000]),
            ]
        )
        return parse_response(reply.text)
