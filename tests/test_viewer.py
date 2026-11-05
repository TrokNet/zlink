import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from contextlib import closing
from pathlib import Path

from fastapi.testclient import TestClient

from app.callbacks import Settings
from app.main import create_app
from app.viewer import COOKIE, ViewerSettings, _attempts, hash_password


class ViewerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.viewer = ViewerSettings('tester', hash_password('test-password'), 'test-session-secret-' * 3)

    def setUp(self):
        _attempts.clear()
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings = Settings('0123456789abcdef', 'abcdef0123456789', 'test-token', Path(self.directory.name) / 'events.db')
        self.client = self.enterContext(TestClient(create_app(self.settings, self.viewer), base_url='https://testserver'))
        now = datetime.now(timezone.utc)
        with closing(sqlite3.connect(self.settings.database_path)) as db, db:
            for index in range(32):
                db.execute('INSERT INTO events VALUES (?,?,?,?,?)', (
                    f'event-{index:02}', 'door.open' if index % 2 else 'user.created', 'abcd',
                    json.dumps({'name':'José' if index == 0 else 'Test','number':index}, ensure_ascii=False),
                    (now - timedelta(hours=index)).isoformat(),
                ))

    def login(self):
        result = self.client.post('/api/login', json={'username':'tester','password':'test-password'})
        self.assertEqual(result.status_code, 200)
        return result

    def test_all_data_routes_require_authentication_and_disable_cache(self):
        for path in ('/api/events','/api/events-summary','/api/events/event-00'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_login_uses_secure_httponly_cookie_and_logout_removes_it(self):
        response = self.login()
        cookie = response.headers['set-cookie']
        for flag in ('Secure','HttpOnly','SameSite=strict','Path=/api'):
            self.assertIn(flag, cookie)
        self.assertEqual(self.client.get('/api/session').json()['username'], 'tester')
        self.client.post('/api/logout')
        self.assertEqual(self.client.get('/api/events').status_code, 401)

    def test_tampered_session_is_rejected(self):
        self.login()
        token = self.client.cookies.get(COOKIE)
        self.client.cookies.clear()
        self.client.cookies.set(COOKIE, token[:-1] + ('0' if token[-1]!='0' else '1'),path='/api')
        self.assertEqual(self.client.get('/api/events').status_code, 401)

    def test_wrong_password_is_rejected_and_rate_limited(self):
        for _ in range(5):
            response = self.client.post('/api/login', json={'username':'tester','password':'wrong'})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.post('/api/login', json={'username':'tester','password':'wrong'}).status_code, 429)

    def test_cross_origin_login_is_rejected(self):
        response = self.client.post('/api/login', headers={'Origin':'https://other.example'},json={'username':'tester','password':'test-password'})
        self.assertEqual(response.status_code, 403)

    def test_pagination_search_sorting_and_detail(self):
        self.login()
        result = self.client.get('/api/events').json()
        self.assertEqual(result['total'],32)
        self.assertEqual(len(result['items']),25)
        self.assertEqual(result['items'][0]['request_id'],'event-00')
        self.assertNotIn('payload',result['items'][0])
        self.assertEqual(self.client.get('/api/events?page=2').json()['items'][0]['request_id'],'event-25')
        self.assertEqual(self.client.get('/api/events?order=asc').json()['items'][0]['request_id'],'event-31')
        self.assertEqual(self.client.get('/api/events',params={'q':'José'}).json()['total'],1)
        self.assertEqual(self.client.get('/api/events',params={'event_code':'door.open'}).json()['total'],16)
        self.assertEqual(self.client.get('/api/events',params={'q':"' OR 1=1 --"}).json()['total'],0)
        self.assertEqual(self.client.get('/api/events',params={'q':'%'}).json()['total'],0)
        detail = self.client.get('/api/events/event-00').json()
        self.assertEqual(detail['payload']['name'],'José')
        self.assertEqual(self.client.get('/api/events/not-found').status_code,404)

    def test_dates_validation_and_summary(self):
        self.login()
        since = (datetime.now(timezone.utc)-timedelta(hours=2,minutes=1)).isoformat()
        self.assertEqual(self.client.get('/api/events',params={'since':since}).json()['total'],3)
        self.assertEqual(self.client.get('/api/events?page_size=1000').status_code,422)
        self.assertEqual(self.client.get('/api/events?since=2026-01-01T00:00:00').status_code,422)
        summary = self.client.get('/api/events-summary').json()
        self.assertEqual(summary['total'],32)
        self.assertEqual(len(summary['event_codes']),2)
        self.assertIsNotNone(summary['last_received_at'])


if __name__ == '__main__':
    unittest.main()
