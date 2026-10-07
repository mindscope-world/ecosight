"""Give rounds reported in another currency a US dollar amount, so they count in dollar totals.

Rates are the European Central Bank's reference rates, read through the free
Frankfurter service. A round dated to a day uses that day's rate; one dated only
to a month or a year uses the average over that period, since nothing says when
in it the money moved. The original amount and currency are always kept, and the
rate used is stored beside the dollar figure with a note of where it came from.
"""

import calendar
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx

from .config import USER_AGENT

RATES_URL = "https://api.frankfurter.dev/v1"
SOURCE_URL = "https://frankfurter.dev"
# Marks the dollar figures this module wrote, so it can redo them and leave the rest alone.
FIELD = "amount_usd"


def period(day: date, precision: str | None, today: date | None = None) -> tuple[date, date]:
    """The days a round's date stands for: itself, its month, or its year, up to today."""
    today = today or date.today()
    if precision == "year":
        start, end = date(day.year, 1, 1), date(day.year, 12, 31)
    elif precision == "month":
        start, end = day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])
    else:
        start = end = day
    return start, min(end, today)


class Rates:
    """US dollars per unit of a currency, averaged over a period. Answers are cached on disk."""

    def __init__(self, cache_path: Path, client: httpx.Client | None = None) -> None:
        self.cache_path = cache_path
        self.client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
        self._cache: dict[str, float | None] = json.loads(cache_path.read_text()) if cache_path.is_file() else {}

    def to_usd(self, currency: str, start: date, end: date) -> float | None:
        """The rate, or None when the service does not cover the currency or the period."""
        key = f"{currency}:{start}:{end}"
        if key not in self._cache:
            self._cache[key] = self._fetch(currency, start, end)
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self._cache, indent=1, sort_keys=True))
        return self._cache[key]

    def _fetch(self, currency: str, start: date, end: date) -> float | None:
        # A range is asked for even for one day: it answers with the last business day before a weekend.
        span = f"{start}..{end}" if start != end else f"{start}"
        response = self.client.get(f"{RATES_URL}/{span}", params={"base": currency, "symbols": "USD"})
        if response.status_code in (404, 422):
            return None
        response.raise_for_status()
        rates = response.json().get("rates", {})
        if "USD" in rates:
            return float(rates["USD"])
        daily = [float(day["USD"]) for day in rates.values() if "USD" in day]
        return sum(daily) / len(daily) if daily else None


@dataclass
class Conversion:
    round_id: str
    organisation: str
    amount: float
    currency: str
    start: date
    end: date
    rate: float | None

    @property
    def usd(self) -> float | None:
        return round(self.amount * self.rate, 2) if self.rate is not None else None

    @property
    def basis(self) -> str:
        when = f"on {self.start}" if self.start == self.end else f"averaged over {self.start} to {self.end}"
        return (
            f"Converted from {self.currency} {self.amount:,.0f} at {self.rate:.4f} US dollars to one {self.currency}, "
            f"the European Central Bank reference rate {when}."
        )


def plan(conn, rates: Rates, today: date | None = None) -> list[Conversion]:
    """Every published round in another currency that has no dollar figure, or one this module wrote."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select r.id, g.name, r.amount_original::float8, r.currency, r.announced_on, r.announced_precision
            from funding_round r join organisation g on g.id = r.organisation_id
            where r.status = 'published' and r.amount_original is not null and r.currency <> 'USD'
              and r.announced_on is not null
              and (r.amount_usd is null or exists (
                select 1 from field_source s
                where s.record_type = 'funding_round' and s.record_id = r.id and s.field = %s))
            order by g.name, r.announced_on
            """,
            (FIELD,),
        )
        rows = cur.fetchall()
    conversions = []
    for round_id, name, amount, currency, announced_on, precision in rows:
        start, end = period(announced_on, precision, today)
        conversions.append(Conversion(str(round_id), name, amount, currency, start, end, rates.to_usd(currency, start, end)))
    return conversions


def summarise(conversions: list[Conversion]) -> str:
    if not conversions:
        return "No published round in another currency is waiting for a dollar figure."
    lines = []
    for item in conversions:
        result = f"USD {item.usd:,.0f} at {item.rate:.4f}" if item.rate is not None else "no rate available; left as it is"
        lines.append(f"  {item.organisation}: {item.currency} {item.amount:,.0f} ({item.start} to {item.end}) -> {result}")
    done = sum(item.rate is not None for item in conversions)
    return f"{len(conversions)} round(s) in another currency, {done} converted\n" + "\n".join(lines)


def apply(conn, conversions: list[Conversion], checked_on: str) -> None:
    with conn.transaction(), conn.cursor() as cur:
        for item in conversions:
            if item.rate is None:
                continue
            cur.execute("update funding_round set amount_usd = %s, fx_rate = %s where id = %s", (item.usd, item.rate, item.round_id))
            cur.execute(
                "delete from field_source where record_type = 'funding_round' and record_id = %s and field = %s",
                (item.round_id, FIELD),
            )
            cur.execute(
                "insert into field_source (record_type, record_id, field, source_url, method, quote, verified_at) "
                "values ('funding_round', %s, %s, %s, 'manual', %s, %s)",
                (item.round_id, FIELD, SOURCE_URL, item.basis, checked_on),
            )
