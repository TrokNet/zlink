import hashlib
import json
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi.testclient import TestClient

from app.callbacks import MAX_BODY_BYTES, Settings, receive_event
from app.main import create_app


class CallbackTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings = Settings(
            app_key="0123456789abcdef",
            encryption_key="abcdef0123456789",
            verification_token="test-token-not-a-real-credential",
            database_path=Path(self.directory.name) / "events.sqlite3",
        )
        self.client = self.enterContext(TestClient(create_app(self.settings)))

    def signed_params(self, timestamp=None):
        timestamp = str(timestamp if timestamp is not None else int(time.time() * 1000))
        nonce = "test1234"
        sign = hashlib.md5(
            (self.settings.verification_token + timestamp + nonce).encode(),
            usedforsecurity=False,
        ).hexdigest()
        return {"sign": sign, "timestamp": timestamp, "nonce": nonce}

    def encrypt(self, plaintext):
        raw = plaintext.encode("utf-8")
        raw += b"\x00" * (-len(raw) % 16)
        encryptor = Cipher(
            algorithms.AES(self.settings.app_key.encode()),
            modes.CBC(self.settings.encryption_key.encode()),
        ).encryptor()
        return (encryptor.update(raw) + encryptor.finalize()).hex()

    def event(self, request_id="event-123"):
        return {
            "requestId": request_id,
            "eventCode": "test.event",
            "encryptData": self.encrypt(json.dumps({"name": "José", "test": True})),
        }

    def rows(self):
        connection = sqlite3.connect(self.settings.database_path)
        try:
            return connection.execute(
                "SELECT request_id, event_code, payload_json FROM events"
            ).fetchall()
        finally:
            connection.close()

    def test_url_challenge_returns_exact_plaintext_in_official_envelope(self):
        plaintext = "challenge-123456"
        params = self.signed_params() | {"echo": self.encrypt(plaintext)}
        response = self.client.get("/webhooks/zlink", params=params)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "code": "ZCOP0000", "message": "Operation successful",
            "data": plaintext,
        })

    def test_valid_event_is_decrypted_and_committed_before_acknowledgement(self):
        response = self.client.post(
            "/webhooks/zlink", params=self.signed_params(), json=self.event()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["code"], "ZCOP0000")
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:2], ("event-123", "test.event"))
        self.assertEqual(json.loads(rows[0][2]), {"name": "José", "test": True})

    def test_duplicates_are_acknowledged_once_persisted(self):
        for _ in range(2):
            response = self.client.post(
                "/webhooks/zlink", params=self.signed_params(), json=self.event()
            )
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.rows()), 1)

    def test_concurrent_duplicates_have_one_database_row(self):
        body = json.dumps(self.event()).encode()
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: receive_event(self.settings, body), range(12)))
        self.assertEqual(len(self.rows()), 1)

    def test_bad_signature_is_rejected_without_storage(self):
        params = self.signed_params() | {"sign": "0" * 32}
        response = self.client.post("/webhooks/zlink", params=params, json=self.event())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.rows(), [])

    def test_old_and_future_timestamps_are_rejected(self):
        for offset in (-360_000, 360_000):
            with self.subTest(offset=offset):
                params = self.signed_params(int(time.time() * 1000) + offset)
                response = self.client.post("/webhooks/zlink", params=params, json=self.event())
                self.assertEqual(response.status_code, 401)

    def test_malformed_ciphertext_and_decrypted_json_are_rejected(self):
        for encrypted in ("zz", "00", self.encrypt("not JSON")):
            response = self.client.post(
                "/webhooks/zlink", params=self.signed_params(),
                json=self.event() | {"encryptData": encrypted},
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.rows(), [])

    def test_invalid_envelopes_are_rejected(self):
        for value in ([], {}, self.event() | {"requestId": 123}):
            response = self.client.post(
                "/webhooks/zlink", params=self.signed_params(), json=value
            )
            self.assertEqual(response.status_code, 400)

    def test_oversized_body_is_rejected(self):
        response = self.client.post(
            "/webhooks/zlink", params=self.signed_params(),
            content=b"x" * (MAX_BODY_BYTES + 1),
        )
        self.assertEqual(response.status_code, 413)

    def test_storage_failure_is_not_acknowledged_as_success(self):
        with patch("app.callbacks.connect_database", side_effect=sqlite3.OperationalError()):
            response = self.client.post(
                "/webhooks/zlink", params=self.signed_params(), json=self.event()
            )
        self.assertEqual(response.status_code, 503)

    def test_unsigned_request_is_rejected(self):
        self.assertEqual(self.client.post("/webhooks/zlink", json=self.event()).status_code, 422)

    def test_existing_routes_and_no_public_event_listing(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        self.assertEqual(self.client.get("/docs").status_code, 200)
        # Event data is never available without viewer authentication.
        self.assertNotEqual(self.client.get("/api/events").status_code, 200)


if __name__ == "__main__":
    unittest.main()
