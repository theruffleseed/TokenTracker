# TokenTracker

Mobile-first dashboard for remaining AI subscription quota, credit balances, and
reset countdowns. Built for **OpenCode Go**, **TokenHarbor**, **River AI**,
**Command Code**, **Qoder**, and **Yeta**, with a provider-adapter architecture that accepts manual
snapshots wherever a vendor has no supported quota API.

![tests](https://img.shields.io/badge/tests-unit%20%2B%20integration%20%2B%20e2e-2ea44f)
![stack](https://img.shields.io/badge/Next.js-15-black)
![db](https://img.shields.io/badge/PostgreSQL-16-336791)

## What it does

- Keeps the dashboard to the essentials: provider name plus either three
  quota-used bars (5-hour, weekly, monthly) or the credits left in dollars.
  Countdowns, freshness labels, and full history live on the provider detail
  page.
- Displays 5-hour, weekly, monthly, and custom windows **only when the provider
  supplies them**. Providers with both quota and credits show both.
- For probe-only providers, inline forms record data directly from the
  dashboard: **Add weekly usage** captures TokenHarbor's separate paid-model and
  free-model weekly windows, and **Add balance** records a wallet or allowance
  amount. Cards keep one-tap **Update usage** / **Update balance** links, flag
  data that is 7 days old, and prefill the current values. Full manual entry
  stays on the provider detail page.
- TokenHarbor's official billing CSV can be imported on the provider detail
  page. It updates the wallet balance from the latest running balance; Office
  Pass weekly usage is not in that export, so those percentages remain manual.
- An optional **usage gateway** proxies OpenAI- and Anthropic-compatible traffic
  for TokenHarbor and River. Requests routed through it are recorded as token
  usage, priced from public list rates, and applied as **Estimated** balance and
  weekly-window snapshots. Traffic sent directly to the vendor is not counted.
- Progress bars encode **consumption**, not remaining allowance: the fill grows
  left to right from green through yellow/orange to red, and turns black at 100%
  used.
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

Only OpenCode Go, Command Code, and Qoder expose quota meters today, and none is
a documented public API. OpenCode Go and Command Code use community-observed
routes; Qoder is read from the official CLI `/usage` panel after a one-time
`qodercli login`. Yeta exposes its prepaid USD balance through the
OpenAI-compatible billing endpoints on its New API gateway. All four are
disabled by default. TokenHarbor and River AI have **no** documented balance
API, so they are validated live but tracked manually or through the usage
gateway. Full evidence, endpoint shapes, and open verification gaps are in
[`docs/provider-capability-matrix.md`](docs/provider-capability-matrix.md).

The gateway is not a vendor meter. It sees only requests whose base URL points
at TokenTracker, prices them from published list rates, and labels the result
**Estimated**. See [`docs/usage-gateway.md`](docs/usage-gateway.md).

TokenTracker never calls paid inference endpoints to measure quota. Draft
read-only API requests for TokenHarbor and River are in
[`docs/vendor-api-requests.md`](docs/vendor-api-requests.md); they have not been
sent.

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
River AI, choose **Manual tracking**. For OpenCode Go, Command Code, and Yeta,
use a live key once `ENABLE_EXPERIMENTAL_ADAPTERS=true`. For Qoder, run
`qodercli login` once on the host (the CLI panel reader also needs `python3` and
`pexpect`), then add Qoder as a live connection; no key is stored and
plan/add-on credits refresh on schedule.

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

- No real provider keys were available during development. The four experimental
  adapters (OpenCode Go, Command Code, Qoder, Yeta) are contract-tested against
  synthetic fixtures, not account-tested. Qoder drives the official CLI `/usage`
  TUI, which can change between CLI releases. Yeta reads OpenAI-compatible
  billing routes exposed by its gateway; these are not documented by Yeta.
  Free Qoder accounts report 0/0 plan credits. All fail closed with diagnostics
  rather than guessing.
- Web Push notifications and background sync are not implemented.
- Rate limiting is in-process; scale-out needs an edge/shared limiter.
- Usage history ingestion exists in the schema and adapter contract, but none of
  the six providers exposes a per-record history API today. The gateway fills
  this gap only for traffic routed through it; direct vendor traffic is
  invisible, and list-price estimates can differ from the invoice.
- Capacitor requires pointing the wrapper at a deployed HTTPS instance; there is
  no offline-first bundled app.

## Documentation

- [Provider capability matrix](docs/provider-capability-matrix.md)
- [Usage gateway](docs/usage-gateway.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Implementation checklist](docs/implementation-checklist.md)

## License

MIT © 2026 theruffleseed
