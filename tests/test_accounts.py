from unittest.mock import patch
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.accounts import User
import unittest
from tests import test_viewer


class AccountTests(unittest.TestCase):
    setUpClass = test_viewer.ViewerTests.__dict__["setUpClass"]
    setUp = test_viewer.ViewerTests.setUp
    login = test_viewer.ViewerTests.login
    def create_reader(self):
        self.login()
        response = self.client.post('/api/users', json={
            'username':'reader', 'display_name':'Event reader',
            'password':'reader-password', 'role':'reader', 'permissions':['events.read'],
        })
        self.assertEqual(response.status_code,201)
        return response.json()

    def test_admin_can_create_user_without_exposing_hash(self):
        user=self.create_reader()
        self.assertNotIn('password_hash',user)
        self.assertEqual(user['permissions'],['events.read'])
        self.assertEqual(self.client.post('/api/users',json={
            'username':'reader','display_name':'Duplicate','password':'another-password'
        }).status_code,409)

    def test_reader_cannot_manage_users_or_execute_integration(self):
        self.create_reader()
        self.client.post('/api/logout')
        self.assertEqual(self.client.post('/api/login',json={'username':'reader','password':'reader-password'}).status_code,200)
        self.assertEqual(self.client.get('/api/events').status_code,200)
        self.assertEqual(self.client.get('/api/users').status_code,403)
        self.assertEqual(self.client.get('/api/integration/catalog').status_code,403)
        self.assertEqual(self.client.post('/api/users',json={'username':'rogue','display_name':'X','password':'password123','role':'admin'}).status_code,403)

    def test_account_disable_and_permissions_revoke_existing_sessions(self):
        user=self.create_reader()
        self.client.post('/api/logout')
        self.client.post('/api/login',json={'username':'reader','password':'reader-password'})
        with Session(self.client.app.state.accounts_engine) as db,db.begin():
            db.get(User,user['id']).active=False
        self.assertEqual(self.client.get('/api/events').status_code,401)

    def test_admin_cannot_lock_out_self(self):
        self.login()
        me=self.client.get('/api/session').json()
        response=self.client.patch('/api/users/'+str(me['id']),json={
            'display_name':'Admin','role':'reader','permissions':['events.read'],'active':False
        })
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.client.get('/api/users').status_code,200)

    def test_password_reset_revokes_old_sessions(self):
        user=self.create_reader()
        response=self.client.patch('/api/users/'+str(user['id']),json={
            'display_name':'Reader','role':'reader','permissions':['events.read'],'active':True,
            'password':'new-reader-password',
        })
        self.assertEqual(response.status_code,200)
        self.client.post('/api/logout')
        self.assertEqual(self.client.post('/api/login',json={'username':'reader','password':'reader-password'}).status_code,401)
        self.assertEqual(self.client.post('/api/login',json={'username':'reader','password':'new-reader-password'}).status_code,200)

    def test_integration_catalog_has_all_schemas_and_never_exposes_app_credentials(self):
        from app.integration import CATALOG
        from jsonschema import Draft7Validator
        self.login()
        response=self.client.get('/api/integration/catalog')
        self.assertEqual(response.status_code,200)
        catalog=response.json()
        self.assertEqual(len(catalog['operations']),31)
        self.assertEqual(len(catalog['guides']),21)
        for op in catalog['operations']:
            Draft7Validator.check_schema(op['schema'])
            if op['kind']=='connection':
                self.assertEqual(op['schema']['properties'],{})
                self.assertIsNone(op['example'])
        for op in CATALOG['operations']:
            if op['example'] is not None:
                data={'body':op['example']}
                if 'path' in op['schema']['properties']:
                    data['path']={key:'id123' for key in op['schema']['properties']['path']['properties']}
                self.assertTrue(Draft7Validator(op['schema']).is_valid(data),op['title'])

    def test_mutation_requires_confirmation_and_invalid_input_never_calls_upstream(self):
        from app.integration import OPERATIONS
        self.login()
        operation=next(op for op in OPERATIONS.values() if op['title']=='Create Department')
        with patch.object(self.client.app.state.zlink_client,'execute') as execute:
            url='/api/integration/execute/'+operation['id']
            self.assertEqual(self.client.post(url,json={'inputs':{}}).status_code,409)
            self.assertEqual(self.client.post(url,json={'inputs':{},'confirmed':True}).status_code,422)
            execute.assert_not_called()

    def test_query_is_allowlisted_and_records_only_metadata(self):
        from app.integration import OPERATIONS
        self.login()
        operation=next(op for op in OPERATIONS.values() if op['title']=='Query Person Information (Paginated)')
        with patch.object(self.client.app.state.zlink_client,'execute',return_value=(200,{'code':'ZCOP0000','data':{'private':'never store'}})) as execute:
            response=self.client.post('/api/integration/execute/'+operation['id'],json={'inputs':{'body':{'pageNumber':1,'pageSize':10}}})
            self.assertEqual(response.status_code,200)
            execute.assert_called_once()
        history=self.client.get('/api/integration/history').json()
        self.assertEqual(len(history['items']),1)
        self.assertNotIn('private',str(history))
        self.assertEqual(self.client.post('/api/integration/execute/https://evil.invalid',json={}).status_code,404)

    def test_legacy_bootstrap_hash_is_upgraded_after_login(self):
        import hashlib
        with Session(self.client.app.state.accounts_engine) as db,db.begin():
            user=db.scalar(select(User).where(User.username=='tester'))
            salt='00'*16
            user.password_hash='600000$'+salt+'$'+hashlib.pbkdf2_hmac('sha256',b'test-password',bytes.fromhex(salt),600000).hex()
        self.login()
        with Session(self.client.app.state.accounts_engine) as db:
            self.assertTrue(db.scalar(select(User).where(User.username=='tester')).password_hash.startswith('$argon2'))
