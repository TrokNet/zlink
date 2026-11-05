# Zlink integration console

The catalog covers the 52 official API articles available on November 5, 2026:
31 outbound HTTP operations and 21 developer/callback guides. The inventory
comes from the public Help Center linked by the developer portal.

## Coverage

- Organization: departments, people, resignation and paginated search.
- Credentials: face quality, registration, cards and biometric deletion.
- Access control: time slots, access levels, doors and access records.
- Attendance: punch events, punch record queries and manual punch creation.
- Authentication: server-side tenant token acquisition and refresh.
- Callbacks: existing encrypted event receiver and event explorer.
- Developer setup and event guides: direct links to each official article.

The console provides a translated operation menu and JSON Schema forms using
React JSON Schema Form with Ant Design, AJV validation, official examples,
response JSON, HTTP status, execution duration and a 50-entry metadata history.
Nested arrays use add/remove controls. Face image fields accept an explicit
image selection or pasted Base64; data is sent only on execution. Facial
credential registration includes the required `data:image/...;base64,` prefix;
facial quality detection sends plain Base64 without it.

Source parameter names, event codes and response payloads are preserved verbatim.
Labels, navigation, validation, date formats and library controls support English
and Spanish. The language choice is stored in `zlink.language` in localStorage.
No authentication tokens or personal response payloads are stored there.

## Runtime configuration

Set `ZLINK_APP_SECRET` in the private Debian `.env`, in addition to the existing
`ZLINK_APP_KEY`. The HTTP host is fixed to `https://zlink-open.minervaiot.com`.
The caller selects an operation ID, never an arbitrary destination URL.

Tenant tokens are cached in server memory and refreshed before expiry. Tokens
and AppSecret are never included in catalog, connection-check or audit responses.
Upstream permissions, application enablement and IP allowlists still apply.

`api.read` is required for documented read operations (including POST searches
and face-quality analysis); `api.write` is required for mutations. Every mutation
requires explicit confirmation in the interface and a confirmation flag checked
on the backend. Requests are not automatically retried because a timed-out write
may already have succeeded upstream. A user must inspect the result before retrying.

History stores actor ID, operation ID, HTTP status, vendor code, duration and UTC
time. It does not store request bodies, response bodies, biometrics or tokens.
Users see their own history; users with `users.manage` may see all history.

Requests are limited to 1 MiB, responses to 4 MiB, and uploads to 750 KB so Base64
fits inside the request limit. HTTP timeouts are explicit. Network failures are
shown to the user without logging credentials.

## Catalog generation and source differences

`scripts/build_api_catalog.py .local/reference` builds the committed
`app/api_catalog.json` from cached official articles. Source copies remain ignored
by Git; each catalog entry keeps its official source URL. No guessed endpoints
are included. Regenerate and review the catalog when the vendor changes its API.

The official examples for updating time slots, creating access levels and manual
punch creation use numbers where some parameter tables say strings. Those fields
accept either representation. The vendor remains authoritative about runtime
validation. Official examples contain example IDs and dates; loading an example
never executes it, and users must replace example values with their own data.

The 21 guide articles describe portal configuration or incoming callbacks rather
than callable resources. They are linked as guides, not fabricated API actions.

## Account migration

SQLAlchemy creates only the new `viewer_users`, `viewer_profiles` and
`viewer_api_audit` tables;
the existing `events` table is preserved. On the first start, the existing viewer
account is imported once as administrator. Its PBKDF2 hash is upgraded to Argon2
on successful login using pwdlib. Subsequent account management uses the database,
not environment credential updates. Keep the `.local/` database backed up.

Sessions use itsdangerous, Secure/HttpOnly/SameSite cookies and an eight-hour
lifetime. Every API request checks current account activity, session version
and permissions. Changes revoke prior sessions. Self-lockout and removal of the
last active administrator are rejected by the backend under a serialized write.
There is no public registration endpoint or destructive account-deletion action.

## Verification

Backend tests cover authentication, authorization, migration, session invalidation,
input schemas, mutation confirmation, endpoint allowlisting and metadata-only
auditing. Outbound writes are mocked in automated tests. Translation tests check
key parity, plurals, interpolation and hardcoded visible JSX.

Access profiles define reusable permission sets. The built-in administrator,
event-reader and per-user custom profiles are protected. Editing a custom profile
updates its assigned users and invalidates their existing sessions; a profile
cannot be deleted while users are assigned to it.

Read-only live queries can be used for deployment verification. Mutations require
deliberate manual testing using the authenticated console and real parameters.
