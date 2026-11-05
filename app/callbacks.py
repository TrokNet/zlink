"""ZKBio Zlink callback protocol and durable event inbox."""

import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from collections.abc import Iterator

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi import HTTPException

MAX_BODY_BYTES = 1024 * 1024
MAX_CLOCK_SKEW_MS = 300_000


@dataclass(frozen=True)
class Settings:
    app_key: str = field(repr=False)
    encryption_key: str = field(repr=False)
    verification_token: str = field(repr=False)
    database_path: Path = Path(".local/events.sqlite3")

    def __post_init__(self) -> None:
        if len(self.app_key.encode("utf-8")) not in (16, 24, 32):
            raise ValueError("ZLINK_APP_KEY must contain 16, 24 or 32 UTF-8 bytes")
        if len(self.encryption_key.encode("utf-8")) != 16:
            raise ValueError("ZLINK_ENCRYPTION_KEY must contain 16 UTF-8 bytes")
        if not self.verification_token:
            raise ValueError("ZLINK_VERIFICATION_TOKEN is required")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            app_key=os.environ.get("ZLINK_APP_KEY", ""),
            encryption_key=os.environ.get("ZLINK_ENCRYPTION_KEY", ""),
            verification_token=os.environ.get("ZLINK_VERIFICATION_TOKEN", ""),
            database_path=Path(os.environ.get("ZLINK_DATABASE_PATH", ".local/events.sqlite3")),
        )


def verify_request(settings: Settings, sign: str, timestamp: str, nonce: str) -> None:
    if not re.fullmatch(r"[0-9]{1,20}", timestamp):
        raise HTTPException(401, "Invalid callback authentication")
    if abs(int(time.time() * 1000) - int(timestamp)) > MAX_CLOCK_SKEW_MS:
        raise HTTPException(401, "Expired callback timestamp")
    if not nonce or len(nonce) > 128 or not re.fullmatch(r"[0-9a-f]{32}", sign):
        raise HTTPException(401, "Invalid callback authentication")
    factor = (settings.verification_token + timestamp + nonce).encode("utf-8")
    expected = hashlib.md5(factor, usedforsecurity=False).hexdigest()
    if not hmac.compare_digest(expected, sign):
        raise HTTPException(401, "Invalid callback authentication")


def decrypt(settings: Settings, ciphertext: str) -> str:
    # Official protocol: hexadecimal ciphertext, AES/CBC/NoPadding.
    # Do not apply PKCS7 unpadding: the URL challenge must round-trip exactly.
    if not ciphertext or not re.fullmatch(r"[0-9a-fA-F]+", ciphertext):
        raise HTTPException(400, "Invalid encrypted content")
    if len(ciphertext) % 32:
        raise HTTPException(400, "Invalid encrypted content")
    cipher = Cipher(
        algorithms.AES(settings.app_key.encode("utf-8")),
        modes.CBC(settings.encryption_key.encode("utf-8")),
    )
    decryptor = cipher.decryptor()
    try:
        plaintext = decryptor.update(bytes.fromhex(ciphertext)) + decryptor.finalize()
        return plaintext.decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid encrypted content") from None


@contextmanager
def connect_database(settings: Settings) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(settings.database_path, timeout=5)
    try:
        connection.execute("PRAGMA synchronous=FULL")
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(settings: Settings) -> None:
    parent = settings.database_path.parent
    if not parent.exists():
        parent.mkdir(mode=0o700, parents=True)
    with connect_database(settings) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS events (
                request_id TEXT PRIMARY KEY,
                event_code TEXT NOT NULL,
                encrypted_data TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                received_at TEXT NOT NULL
            )"""
        )
        connection.execute("CREATE INDEX IF NOT EXISTS events_received_at_idx ON events(received_at DESC, request_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS events_code_received_idx ON events(event_code, received_at DESC)")
    if os.name == "posix":
        settings.database_path.chmod(0o600)


def receive_event(settings: Settings, body: bytes) -> None:
    try:
        envelope = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON body") from None
    if not isinstance(envelope, dict):
        raise HTTPException(400, "Invalid event envelope")
    for name in ("requestId", "eventCode", "encryptData"):
        if not isinstance(envelope.get(name), str) or not envelope[name].strip():
            raise HTTPException(400, "Missing or invalid event fields")
    if len(envelope["requestId"]) > 256 or len(envelope["eventCode"]) > 256:
        raise HTTPException(400, "Event identifier too long")
    plaintext = decrypt(settings, envelope["encryptData"])
    try:
        # JSON whitespace and zero-filled AES blocks are safe to strip here;
        # unlike GET echo, this field must decode to a JSON event payload.
        payload = json.loads(plaintext.rstrip("\x00 \t\r\n"))
    except ValueError:
        raise HTTPException(400, "Decrypted event is not valid JSON") from None
    if not isinstance(payload, (dict, list)):
        raise HTTPException(400, "Decrypted event must be a JSON object or array")
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    try:
        with connect_database(settings) as connection:
            # A unique constraint makes deduplication atomic, including across
            # simultaneous deliveries. Acknowledge only after durable commit.
            connection.execute(
                """INSERT INTO events
                   (request_id, event_code, encrypted_data, payload_json, received_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(request_id) DO NOTHING""",
                (
                    envelope["requestId"], envelope["eventCode"],
                    envelope["encryptData"], serialized,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
    except sqlite3.Error:
        raise HTTPException(503, "Event storage unavailable; retry delivery") from None
