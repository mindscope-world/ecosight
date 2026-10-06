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


def raw_store_dir() -> Path:
    return Path(os.environ.get("RAW_STORE_DIR", REPO_ROOT / "data" / "raw"))


# Identifies the crawler to site owners, with a way to reach us.
USER_AGENT = os.environ.get(
    "CRAWLER_USER_AGENT", "CapitalAtlasBot/0.1 (+https://github.com/capital-atlas; ecosystem map)"
)

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
