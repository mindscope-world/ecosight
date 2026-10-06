"""Raw document store: every fetched document is kept unchanged, addressed by its hash.

Bytes go to a directory (an S3-compatible bucket later, behind the same two methods);
the raw_document table records which URL produced which content and when.
"""

import hashlib
from dataclasses import dataclass
from pathlib import Path

import psycopg


@dataclass(frozen=True)
class StoredDocument:
    id: str
    url: str
    content_hash: str
    storage_key: str
    is_new: bool


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def write(self, key: str, content: bytes) -> None:
        path = self.root / key
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write then rename, so a crash never leaves a half-written document under its hash.
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(content)
        tmp.replace(path)

    def read(self, key: str) -> bytes:
        return (self.root / key).read_bytes()


class RawStore:
    def __init__(self, conn: psycopg.Connection, storage: LocalStorage) -> None:
        self.conn = conn
        self.storage = storage

    def put(self, url: str, content: bytes) -> StoredDocument:
        """Store a document. The same content at the same URL is stored once."""
        digest = hashlib.sha256(content).hexdigest()
        key = f"{digest[:2]}/{digest}"
        self.storage.write(key, content)
        with self.conn.cursor() as cur:
            cur.execute(
                """
                insert into raw_document (url, content_hash, storage_key)
                values (%s, %s, %s)
                on conflict (url, content_hash) do nothing
                returning id
                """,
                (url, digest, key),
            )
            row = cur.fetchone()
            is_new = row is not None
            if row is None:
                cur.execute(
                    "select id from raw_document where url = %s and content_hash = %s",
                    (url, digest),
                )
                row = cur.fetchone()
        self.conn.commit()
        return StoredDocument(str(row[0]), url, digest, key, is_new)

    def get(self, document_id: str) -> bytes:
        with self.conn.cursor() as cur:
            cur.execute("select storage_key from raw_document where id = %s", (document_id,))
            row = cur.fetchone()
        if row is None:
            raise KeyError(document_id)
        return self.storage.read(row[0])
