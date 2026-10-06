"""Geocoding through the public Nominatim service, limited to the Nairobi area.

The usage policy allows one request a second and asks for cached results, so every
answer, including "nothing found", is written to a cache file and reused.
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import USER_AGENT

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# West, south, east, north: Nairobi county and its immediate surroundings.
NAIROBI_BOX = (36.60, -1.50, 37.15, -1.10)
# Result kinds that are a street or a district, not a building.
_AREA_CATEGORIES = {"highway", "boundary", "landuse", "railway", "natural", "waterway"}
_POINT_PLACE_TYPES = {"house", "building"}


@dataclass(frozen=True)
class Place:
    lon: float
    lat: float
    # "address" when the match is a building or named premise, "area" otherwise.
    level: str
    matched: str


def in_nairobi(lon: float, lat: float) -> bool:
    west, south, east, north = NAIROBI_BOX
    return west <= lon <= east and south <= lat <= north


def classify(category: str, kind: str) -> str:
    if category in _AREA_CATEGORIES:
        return "area"
    if category == "place" and kind not in _POINT_PLACE_TYPES:
        return "area"
    return "address"


class Geocoder:
    def __init__(self, cache_path: Path, client: httpx.Client | None = None, delay: float = 1.1) -> None:
        self.cache_path = cache_path
        self.client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
        self.delay = delay
        self.requests = 0
        self._last = 0.0
        self._cache: dict[str, dict | None] = (
            json.loads(cache_path.read_text()) if cache_path.is_file() else {}
        )

    def lookup(self, query: str) -> Place | None:
        if query not in self._cache:
            self._cache[query] = self._fetch(query)
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self._cache, indent=1, ensure_ascii=False, sort_keys=True))
        hit = self._cache[query]
        return Place(**hit) if hit else None

    def _fetch(self, query: str) -> dict | None:
        wait = self._last + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        west, south, east, north = NAIROBI_BOX
        response = self.client.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "ke",
                "viewbox": f"{west},{north},{east},{south}",
                "bounded": 1,
            },
        )
        self._last = time.monotonic()
        self.requests += 1
        response.raise_for_status()
        results = response.json()
        if not results:
            return None
        top = results[0]
        lon, lat = float(top["lon"]), float(top["lat"])
        if not in_nairobi(lon, lat):
            return None
        return {
            "lon": lon,
            "lat": lat,
            "level": classify(top.get("category", ""), top.get("type", "")),
            "matched": top.get("display_name", ""),
        }
