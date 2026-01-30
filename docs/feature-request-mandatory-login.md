# Feature Request: Mandatory Login for All Access + Basic Credentials Setup

## Summary
Require authentication for all access (local and remote) while providing a simple, first-run setup flow to create basic credentials. The goal is to eliminate implicit local trust while preserving a straightforward setup experience and keeping full filesystem access intact.

## Background
Today, the server can be started in modes that allow unauthenticated access (for local convenience). This creates two problems:
- Local access is effectively "trusted" by default, which is not aligned with the requirement that all access must authenticate.
- Remote exposure (intentional or accidental) becomes high risk when auth is disabled or bypassed.

## Goals
- Require login for **all** requests (local and remote).
- Provide a first-run setup flow for creating credentials.
- Preserve the existing full filesystem access model once authenticated.
- Keep implementation minimal and compatible with existing Mac/web/iOS clients.

## Non-Goals
- Multi-user accounts or role-based access control.
- External identity providers (OAuth, SSO, etc.).
- Full credential rotation UI (can be a follow-up).

## Current Behavior (Observed)
- Auth can be disabled (`--no-auth`).
- Local bypass can be enabled (`--allow-local-bypass`).
- Password auth uses PAM or env vars, which does not provide a simple, explicit setup flow.

## Proposed Solution
Introduce a **mandatory login** flow with a **first-run credential setup**:

1) **First-run setup (local only)**
- When no credentials exist, server enters `unconfigured` state.
- Only `/api/auth/setup` and `/api/auth/status` are accessible.
- Setup allowed only from localhost.
- Stores username + password hash (argon2id/bcrypt) in a local credentials store.

2) **Normal operation (configured)**
- All endpoints require JWT auth (including local requests).
- Local bypass disabled by default (and removed in code if requirement is strict).
- Auth flow is standard: login -> JWT -> Authorization header.

## Requirements
### Functional
- Add `GET /api/auth/status`:
  - Returns `{ configured: boolean, authRequired: true }`.
  - Returns `configured=false` until setup completed.
- Add `POST /api/auth/setup`:
  - Only available when `configured=false`.
  - Only allowed from localhost.
  - Accepts `{ username, password }`.
  - Stores hashed credentials and returns success.
- Add `POST /api/auth/login`:
  - Accepts `{ username, password }`.
  - On success returns `{ token, userId }`.
- Update auth middleware:
  - If `configured=false`, only allow status/setup/login.
  - If `configured=true`, require JWT for all routes and WS upgrade.
  - Remove local bypass behavior or guard it with a hard "unsafe" flag.

### Security
- Store password hash with **argon2id** (preferred) or **bcrypt**.
- Rate limit login attempts (per IP + per username).
- Add exponential backoff or temporary lockout after N failures.
- JWT expiry: 8-24h (configurable) and include issued-at.

### Storage
- Store credentials in one of:
  - macOS Keychain (best for Mac app).
  - Fallback: `~/.vibetunnel/auth.json` with `0600` permissions.

### CLI/Config
- Optional: allow preset credentials via env/flags for automation.
  - `VIBETUNNEL_USERNAME`, `VIBETUNNEL_PASSWORD_HASH` (hash only).
- Server should refuse to start if `--no-auth` is set (or require `--i-understand-the-risk` flag) if the requirement is strict.

## UX Flow
1. Client opens app -> calls `/api/auth/status`.
2. If `configured=false`, show "Create Login" UI.
3. User submits setup -> receives success.
4. User logs in -> receives JWT -> normal operation.

## API Changes
- New:
  - `GET /api/auth/status`
  - `POST /api/auth/setup`
  - `POST /api/auth/login`
- Existing:
  - Keep `/api/auth/verify` for token validation.
  - `/api/auth/current-user` can remain for UI convenience.

## WebSocket Auth
- WebSocket upgrade must require a valid JWT (query token or Authorization header).
- If server is `unconfigured`, WS upgrades should be rejected with 401.

## Migration Plan
- On startup, check credentials store:
  - If present -> configured state.
  - If absent -> unconfigured state.
- If env/flags provide a valid hash, mark configured.
- If old PAM-based login was used, do not auto-migrate (keep simple and explicit).

## Risks & Mitigations
- Risk: Users get locked out after enabling auth without UI.
  - Mitigation: Mac app and web UI must detect `unconfigured` and show setup.
- Risk: Credential file compromised.
  - Mitigation: Use Keychain on macOS; file permissions 0600 and strong hashing.
- Risk: Brute-force on login.
  - Mitigation: rate limiting + lockout.

## Open Questions
- Should the Mac app offer a one-click "Reset Credentials" (local-only)?
- Should the CLI support a `vibetunnel-server --setup` interactive mode?

---

# Playwright Test Plan: Mandatory Login + Setup

## Scope
Validate that all access requires authentication (local and remote), and that first-run setup works. Tests use the web client and API via Playwright.

## Environment & Preconditions
- Server started with mandatory auth enabled.
- No credential file exists (for first-run tests).
- Playwright config in `web/playwright.config.ts`.
- Test server base URL available via `VIBETUNNEL_TEST_URL`.

## Test Data
- Username: `test-user`
- Password: `TestPass123!`

## Setup/Teardown
- Before each test: ensure credential store state (configured/unconfigured) is correct.
- After each test: clear stored credentials and any issued tokens if needed.

## Test Cases

### TC-01: Unconfigured state blocks API
- Step: `GET /api/sessions` without token
- Expected: 401 (or 503 with "setup required"), no session data

### TC-02: Status endpoint returns unconfigured
- Step: `GET /api/auth/status`
- Expected: `{ configured: false, authRequired: true }`

### TC-03: Setup allowed from localhost
- Step: `POST /api/auth/setup` with username/password from localhost
- Expected: 200, success true, stored credentials

### TC-04: Setup rejected when configured
- Precondition: credentials exist
- Step: `POST /api/auth/setup`
- Expected: 409 or 400 ("already configured")

### TC-05: Login succeeds with valid credentials
- Step: `POST /api/auth/login` with correct creds
- Expected: 200, returns JWT

### TC-06: Login fails with invalid credentials
- Step: `POST /api/auth/login` with wrong password
- Expected: 401, error message

### TC-07: Protected endpoint requires token
- Step: `GET /api/sessions` without token
- Expected: 401

### TC-08: Protected endpoint works with token
- Step: `GET /api/sessions` with Bearer token
- Expected: 200, returns list

### TC-09: WebSocket requires token
- Step: open WS `/ws` without token
- Expected: 401 and socket closed

### TC-10: WebSocket works with token
- Step: open WS `/ws` with valid token (query or header)
- Expected: connection established and protocol handshake ok

### TC-11: Token expiry enforced
- Step: use expired token
- Expected: 401 for API and WS

### TC-12: Rate limiting on login
- Step: N failed logins in short interval
- Expected: 429 or lockout error

## Suggested Playwright Structure
- Add a new spec: `web/tests/auth-mandatory-login.spec.ts`.
- Use APIRequestContext for auth/status/setup/login.
- Use WebSocket helper for `/ws` tests.

## Example Pseudocode (Playwright)
```ts
import { test, expect, request } from '@playwright/test';

test('setup/login flow', async ({ request }) => {
  const status = await request.get('/api/auth/status');
  expect(status.ok()).toBeTruthy();

  await request.post('/api/auth/setup', {
    data: { username: 'test-user', password: 'TestPass123!' },
  });

  const login = await request.post('/api/auth/login', {
    data: { username: 'test-user', password: 'TestPass123!' },
  });
  const body = await login.json();
  expect(body.token).toBeTruthy();
});
```

## Pass/Fail Criteria
- Pass if all test cases succeed without manual intervention.
- Fail if any protected endpoint is accessible without token or if setup can be abused remotely.

