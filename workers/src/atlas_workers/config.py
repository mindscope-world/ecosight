"""Settings from the environment, with the repo-root .env as a fallback for local runs."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv(REPO_ROOT / ".env")


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def test_database_url() -> str:
    """The database tests may write to: the separate test database when one is set."""
    return os.environ.get("TEST_DATABASE_URL") or database_url()


def raw_store_dir() -> Path:
    return Path(os.environ.get("RAW_STORE_DIR", REPO_ROOT / "data" / "raw"))


# Identifies our requests to site owners and to Nominatim. Set CRAWLER_USER_AGENT
# to a string with a working contact address before anything runs on a schedule.
USER_AGENT = os.environ.get("CRAWLER_USER_AGENT", "ecoSight/0.1 (startup ecosystem map; research import)")


def geocode_cache() -> Path:
    return Path(os.environ.get("GEOCODE_CACHE", REPO_ROOT / "data" / "geocode-cache.json"))


# Extraction model on Groq, called through LangChain. Groq has a free tier.
GROQ_MODEL = os.environ.get("GROQ_MODEL") or "llama-3.3-70b-versatile"


def groq_api_key() -> str:
    key = os.environ.get("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. Create a key at https://console.groq.com/keys "
            "and add it to .env at the repo root."
        )
    return key
