# Security

## Data classification

| Data | Sensitivity | Storage |
|---|---|---|
| Provider API keys | Secret | AES-256-GCM ciphertext, IV, auth tag, key version |
| Passwords | Secret | scrypt hash only |
| Session tokens | Secret | SHA-256 digest only; raw token in HttpOnly cookie |
| Gateway tokens | Secret | SHA-256 digest and a short hint only |
| Quota/credit/usage data | Private | PostgreSQL, scoped by `userId` |
| Audit metadata | Internal | Redacted JSON; no credentials or payloads |
| Exports | Private | Generated per request; authenticated; `no-store` |

## Authentication

- Email + password. Minimum 10 characters (no composition rules; length is
  preferred over forced character classes).
- scrypt with N=16384, r=8, p=1, 64-byte output, 16-byte random salt. Parameters
  are encoded in the stored hash so they can be upgraded.
- Login uses a constant-work dummy verification for unknown emails to reduce
  timing-based account enumeration.
- Generic "Email or password is incorrect" response for unknown user and wrong
  password.
- Login/registration are rate-limited per IP (and per email for login).
- `ALLOW_REGISTRATION=false` disables public registration.

## Sessions

- 256-bit random token (`base64url`), never stored in plaintext.
- SHA-256 digest with a unique index; lookup is constant-time at the database
  layer.
- 30-day expiry; `lastUsedAt` is touched at most every five minutes.
- HttpOnly, SameSite=Lax, `Secure` when `SESSION_COOKIE_SECURE=true`, path `/`.
- Sign-out deletes the session row. Password change can revoke every other
  session.
- Deleting a user cascades sessions.

## Usage gateway tokens

- Separate 256-bit `ttg_…` bearer token, independent of sessions and provider
  keys; revocable without signing out.
- Only a SHA-256 digest and a masked hint are stored. Plaintext is returned once
  at creation.
- The gateway resolves the token to its owner, then requires an owned, active,
  live connection with a stored provider key. It forwards to a fixed upstream
  host per provider; client-supplied URLs, auth headers, cookies, and host
  headers are never forwarded.
- Bodies are capped at 10 MB. Inference requests are never retried, and
  upstream errors are passed through without exposing provider keys.
- Gateway token issue/revoke are same-origin session mutations and are audited
  without token material.

## CSRF and request integrity

Every mutation requires:

1. A valid session cookie.
2. `Sec-Fetch-Site` not equal to `cross-site`.
3. If an `Origin` header is present, its host must match the request host or
   `APP_URL`.

JSON bodies must use `Content-Type: application/json`. API responses set
`Cache-Control: no-store` and are never cached by the service worker.

## Provider credentials

- Encrypted with AES-256-GCM before insert; a fresh 96-bit IV per secret.
- Ciphertext, IV, and tag are separate columns. The key version is stored with
  the envelope for rotation.
- Only the trailing four characters are exposed as a hint.
- Decryption happens in the web/worker process immediately before an adapter
  call. Plaintext never enters job payloads, audit metadata, logs, API
  responses, or the browser.
- Replacing a credential clears sync state and errors, then requires a new
  successful refresh.
- Keys should be read-only/scoped where the provider supports it.

### Key rotation

`CREDENTIAL_ENCRYPTION_KEY_VERSION` selects the active envelope version. The
current implementation supports one active key version. A safe rotation is:

1. Stop refreshes (pause accounts or stop workers).
2. Decrypt each account with the old key using a short migration script.
3. Re-encrypt with the new key and increment the version.
4. Update `CREDENTIAL_ENCRYPTION_KEY` and
   `CREDENTIAL_ENCRYPTION_KEY_VERSION`, restart, verify a refresh.
5. Retain the old key offline only until every envelope is migrated.

A missing/wrong key fails closed with an internal error; it never writes
plaintext as a fallback.

## Provider integration boundaries

- Read-only GET requests only.
- No browser scraping, DOM parsing, session-cookie import, or browser automation.
- No paid inference calls to measure quota.
- Experimental routes are opt-in via `ENABLE_EXPERIMENTAL_ADAPTERS`.
- HTTP client enforces a timeout, a 2 MiB response cap, bounded retries, and
  does not retry 401/403.
- Response shapes are validated by Zod before persistence.
- Providers are isolated: one failure cannot block another account.

## Multi-tenant isolation

Every account query includes `userId` from the session, either through
`providerAccount.findFirst({ where: { id, userId } })` or a relation filter.
Snapshots are only reachable through an owned account. Detail pages return 404
for another user's account ID. Export is scoped to the session user.

## Audit trail

Events record: registration, login, logout, provider connect/update/remove,
credential replacement, manual snapshot, refresh queued/completed/failed,
settings changes, exports, and retention purges.

Metadata is recursively redacted: any key matching
`token|secret|password|credential|authorization|api-key|cookie` becomes
`[redacted]`, strings are truncated, arrays and depth are capped. Raw provider
responses are never stored in audit events.

## Logging

- Sanitization strips bearer tokens, API keys, and long random strings before
  logging unexpected errors.
- Adapter error messages are generic and contain status codes, not payloads.
- Job rows store only a sanitized error code plus a short message on the account.
- Production deployments should ship logs to a retention-controlled sink.

## Retention and deletion

- Configurable per-user quota/credit, usage, and audit windows.
- Worker purge runs every six hours under a PostgreSQL advisory lock.
- Expired sessions and terminal refresh jobs older than 30 days are deleted.
- Disconnecting a provider cascades snapshots, credits, usage, and jobs.
- Export includes no credential material and no session data.

## Rate limiting

In-process token buckets protect:

| Action | Limit |
|---|---|
| Registration | 5 / hour / IP |
| Login | 10 / 15 min / IP + email |
| Refresh | 30 / hour / user + account |
| Manual snapshots | 120 / hour / user |
| Credential replacement | 20 / hour / user |
| Password change | 5 / hour / user |

This is per-instance only. For multi-instance deployments, add a shared edge
limiter (e.g., proxy or Redis-backed) and set trusted proxy headers correctly.
`RATE_LIMIT_DISABLED` exists only for isolated test environments and must never
be enabled in production.

## Transport and headers

- HTTPS is required in production (`SESSION_COOKIE_SECURE=true`).
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` disables camera, microphone, and geolocation.
- `X-Powered-By` is disabled.

**Not yet implemented:** a strict Content-Security-Policy. Next.js injects
runtime scripts; add a nonce-based CSP at the reverse proxy or via middleware
before exposing the app to hostile content. This is recorded as a deployment
hardening step, not silently claimed.

## Known security limitations

- No MFA or WebAuthn yet.
- No email verification or password-reset flow; provisioning is manual.
- No per-device session inventory UI (revoke-all is available).
- The app does not defend against a compromised server host: an attacker with
  the encryption key and database can decrypt credentials.
- Provider alpha routes may change behavior; the app fails closed on parse
  errors but cannot guarantee vendor intent.

## Reporting a vulnerability

Email the repository owner privately. Do not open a public issue containing
credentials, session cookies, or personal account data.
