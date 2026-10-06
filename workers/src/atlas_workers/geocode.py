"""Geocoding through the public Nominatim service: addresses in the Nairobi area, and city centres anywhere.

The usage policy allows one request a second and asks for cached results, so every
answer, including "nothing found", is written to a cache file and reused.
"""

import json
import re
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


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


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
        """A place within the Nairobi area. Addresses elsewhere are not looked up yet."""
        if query not in self._cache:
            self._store(query, self._fetch(query))
        hit = self._cache[query]
        return Place(**hit) if hit else None

    def city(self, name: str, country: str) -> Place | None:
        """The centre of a city anywhere in the world, for placing records at city level."""
        key = f"city:{name},{country.upper()}"
        if key not in self._cache:
            top = self._request(
                {"q": name, "countrycodes": country.lower(), "featureType": "settlement"}
            )
            hit = None
            # The result must be the place asked for, not the nearest thing with a similar name.
            if top and _squash(name.split()[0]) in _squash(top.get("display_name", "")):
                hit = {
                    "lon": float(top["lon"]),
                    "lat": float(top["lat"]),
                    "level": "area",
                    "matched": top.get("display_name", ""),
                }
            self._store(key, hit)
        hit = self._cache[key]
        return Place(**hit) if hit else None

    def _store(self, key: str, value: dict | None) -> None:
        self._cache[key] = value
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self._cache, indent=1, ensure_ascii=False, sort_keys=True))

    def _request(self, params: dict) -> dict | None:
        """One search, at most one a second. The top result, or None."""
        wait = self._last + self.delay - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        # Names are asked for in English, so "Vienna" is recognised in a reply that would say "Wien".
        response = self.client.get(
            NOMINATIM_URL, params={"format": "jsonv2", "limit": 1, "accept-language": "en", **params}
        )
        self._last = time.monotonic()
        self.requests += 1
        response.raise_for_status()
        results = response.json()
        return results[0] if results else None

    def _fetch(self, query: str) -> dict | None:
        west, south, east, north = NAIROBI_BOX
        top = self._request(
            {"q": query, "countrycodes": "ke", "viewbox": f"{west},{north},{east},{south}", "bounded": 1}
        )
        if not top:
            return None
        lon, lat = float(top["lon"]), float(top["lat"])
        if not in_nairobi(lon, lat):
            return None
        return {
            "lon": lon,
            "lat": lat,
            "level": classify(top.get("category", ""), top.get("type", "")),
            "matched": top.get("display_name", ""),
        }
