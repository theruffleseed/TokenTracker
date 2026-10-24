# TokenTracker

Mobile-first dashboard for remaining AI subscription quota, credit balances, and
reset countdowns. Built for **OpenCode Go**, **TokenHarbor**, **River AI**, and
**Command Code**, with a provider-adapter architecture that accepts manual
snapshots wherever a vendor has no supported quota API.

![tests](https://img.shields.io/badge/tests-unit%20%2B%20integration%20%2B%20e2e-2ea44f)
![stack](https://img.shields.io/badge/Next.js-15-black)
![db](https://img.shields.io/badge/PostgreSQL-16-336791)

## What it does

- Shows every connected provider on one overview, sorted by lowest remaining
  quota.
- Displays 5-hour, weekly, monthly, and custom windows **only when the provider
  supplies them**.
- Counts down to each reset live, and shows the absolute reset time in the
  user's timezone.
- Keeps wallet balance, promotional credit, included allowance, tokens,
  requests, and percentages as **separate units**. Nothing is silently
  converted or combined.
- Labels every observation as **Live**, **Manual**, **Cached**, or **Estimated**,
  and flags stale, failed, and never-synced connections.
- Runs scheduled refreshes in a separate PostgreSQL-backed worker with
  single-flight job guarantees.
- Encrypts provider credentials with AES-256-GCM and never returns them to the
  browser.
- Supports PWA install and is configured for an eventual Capacitor Android
  wrapper.

### Honest sourcing

Only OpenCode Go and Command Code expose per-window quota meters today, and both
are community-observed routes rather than documented public APIs. They are
disabled by default. TokenHarbor and River AI have **no** documented balance API,
so they are validated live but tracked manually. Full evidence, endpoint shapes,
and open verification gaps are in
[`docs/provider-capability-matrix.md`](docs/provider-capability-matrix.md).

TokenTracker never calls paid inference endpoints to measure quota.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript strict mode
- Tailwind CSS, accessible hand-built components, no UI framework lock-in
- PostgreSQL 16 + Prisma 6 (UUIDs, fixed-point decimals, partial unique index)
- Route handlers for the authenticated JSON API
- Separate Node worker with `FOR UPDATE SKIP LOCKED` job claiming
- Zod runtime validation at every trust boundary
- Vitest unit + integration tests, Playwright mobile E2E
- PWA manifest/service worker; Capacitor config for Android

More detail: [`docs/architecture.md`](docs/architecture.md).

## Quickstart

Requirements: Node.js 20.9+ (22+ recommended), Docker.

```bash
git clone git@github.com:theruffleseed/TokenTracker.git
cd TokenTracker
npm install

# 1. Environment
cp .env.example .env.local
npm run keys:generate   # paste AUTH_SECRET and CREDENTIAL_ENCRYPTION_KEY
ln -sf .env.local .env  # Prisma CLI reads .env

# 2. Database
docker compose up -d
npm run db:migrate

# 3. Run
npm run dev             # http://localhost:3000
npm run worker          # second terminal: scheduled refreshes
```

Create an account at `/register`, then choose a provider. For TokenHarbor and
River AI, choose **Manual tracking**; for OpenCode Go and Command Code you can
use a live key once `ENABLE_EXPERIMENTAL_ADAPTERS=true`.

No demo accounts or fake balances are seeded. `npm run db:seed` with
`SEED_EMAIL`/`SEED_PASSWORD` only provisions an empty user.

### Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | ≥32-byte session material |
| `CREDENTIAL_ENCRYPTION_KEY` | Yes | Base64 32-byte AES-256-GCM key |
| `CREDENTIAL_ENCRYPTION_KEY_VERSION` | No | Envelope key version, default `1` |
| `APP_URL` | Yes | Canonical origin, used for same-origin checks |
| `SESSION_COOKIE_SECURE` | No | `true` behind HTTPS |
| `ALLOW_REGISTRATION` | No | Set `false` for a private instance |
| `ENABLE_EXPERIMENTAL_ADAPTERS` | No | Enables alpha quota routes (default false) |
| `REFRESH_DEFAULT_INTERVAL_MINUTES` | No | Default 30 |
| `WORKER_CONCURRENCY` | No | Parallel refresh lanes, default 2 |
| `INLINE_REFRESH` | No | Run manual refresh in the web request; default true |
| `RATE_LIMIT_DISABLED` | No | Test environments only |

See [`.env.example`](.env.example) for the full list.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build (typecheck + lint) |
| `npm start` | Production server |
| `npm run worker` | Long-running refresh worker |
| `npm run worker:once` | Drain due jobs once (cron-friendly) |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:deploy` | Apply migrations in production |
| `npm run db:seed` | Optional empty-user provisioning |
| `npm test` | Unit tests |
| `npm run test:integration` | PostgreSQL integration tests (uses `TEST_DATABASE_URL`; `docker compose` creates `tokentracker_test`) |
| `npm run test:e2e` | Playwright mobile E2E (builds and starts the app) |
| `npm run typecheck` | Strict TypeScript |
| `npm run lint` | ESLint |

## Architecture at a glance

```
Browser (PWA) ── cookies ──> Next.js route handlers ──> PostgreSQL
                                    │                      ▲
                                    │                      │
                              adapter registry        queue tables
                                    │                      ▲
                          read-only provider APIs        │
                                                    worker loop
```

- **Provider adapters** return a typed result envelope. Missing metrics are
  `null`, never zero. Authentication, rate limits, timeouts, malformed payloads,
  and outages map to a fixed error taxonomy.
- **Refresh jobs** are deduplicated per account by a partial unique index on
  `PENDING | RUNNING`. Workers claim with `SKIP LOCKED`. Transient failures retry
  with exponential backoff (max 3 attempts); credential failures stop and mark
  the account **Needs attention**.
- **Snapshots are historical.** Every successful refresh appends observations;
  the dashboard derives the latest value per window/scope without destroying
  history. Retention is configurable per user.
- **Manual data is first-class** but always labeled, never blended with live
  data.

## Security summary

- Passwords: scrypt (N=16384, r=8, p=1) with per-password salt.
- Sessions: 256-bit random token, SHA-256 hash stored, HttpOnly/SameSite=Lax
  cookie, 30-day expiry, server-side revocation.
- Credentials: AES-256-GCM, fresh IV, auth tag, versioned key, no plaintext in
  logs, jobs, or audit metadata.
- CSRF: same-origin + `Sec-Fetch-Site` checks on every mutation.
- Rate limiting on login, registration, refresh, credential changes, and manual
  entry.
- Redacted audit trail for account and connection events.

Details, threat model, and limits: [`docs/security.md`](docs/security.md).

## Known limitations

- No real provider keys were available during development. The two experimental
  quota parsers are contract-tested against synthetic fixtures, not
  account-tested. They fail closed with diagnostics if the payload changes.
- Web Push notifications and background sync are not implemented.
- Rate limiting is in-process; scale-out needs an edge/shared limiter.
- Usage history ingestion exists in the schema and adapter contract, but none of
  the four providers exposes a per-record history API today.
- Capacitor requires pointing the wrapper at a deployed HTTPS instance; there is
  no offline-first bundled app.

## Documentation

- [Provider capability matrix](docs/provider-capability-matrix.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Implementation checklist](docs/implementation-checklist.md)

## License

MIT © 2026 theruffleseed
